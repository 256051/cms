"""Start an isolated, localhost-only n8n/CMS preview. No production configuration or data is used."""
import argparse
import copy
import datetime as dt
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from integration import Client

LOCAL = ROOT / ".local/n8n-demo"
STATE = LOCAL / "state.json"
COMPOSE = ["docker", "compose", "-p", "cms-n8n-demo", "-f", str(ROOT / "deploy/n8n/compose.demo.yaml")]


def command(args, env=None):
    result = subprocess.run(args, cwd=ROOT, env=env, capture_output=True, text=True, encoding="utf-8", errors="replace",
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    if result.returncode:
        raise RuntimeError((result.stdout + result.stderr)[-2500:])
    return result.stdout


def wait(url):
    for _ in range(120):
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(0.5)
    raise RuntimeError("启动超时，请检查演示容器：" + url)


class N8n:
    def __init__(self, url):
        self.url = url
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def call(self, path, data=None):
        request = urllib.request.Request(self.url + "/rest/" + path,
            data=None if data is None else json.dumps(data).encode(),
            headers={"Content-Type": "application/json", "Origin": self.url})
        try:
            with self.opener.open(request, timeout=30) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as error:
            # Do not echo request bodies or credentials when setup fails.
            raise RuntimeError(f"n8n {path} 返回 HTTP {error.code}") from None
        return payload.get("data", payload)


def save(state):
    LOCAL.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["start", "stop", "status", "verify"], nargs="?", default="start")
    args = parser.parse_args()
    if args.action == "stop":
        if not STATE.exists():
            raise RuntimeError("没有本脚本创建的演示记录，未停止任何服务。")
        command(COMPOSE + ["stop"])
        print("演示容器已停止，演示数据保留。")
        return
    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {
        "cmsUrl": "http://127.0.0.1:" + os.environ.get("CMS_DEMO_PORT", "13000"),
        "n8nUrl": "http://127.0.0.1:" + os.environ.get("N8N_DEMO_PORT", "15678"),
        "cmsAccount": {"username": "n8ndemo", "password": "Demo!" + secrets.token_hex(16)},
        "n8nAccount": {"email": "demo@cms.example", "password": "Demo!" + secrets.token_hex(16)},
    }
    if args.action == "status":
        print(json.dumps({k: v for k, v in state.items() if k.endswith("Url") or k.endswith("Id")}, ensure_ascii=False, indent=2))
        return
    if args.action == "start":
        if not STATE.exists() and command(COMPOSE + ["ps", "-a", "-q"]).strip():
            raise RuntimeError("演示项目名已被使用；没有本地创建记录，拒绝覆盖。")
        save(state)
        env = dict(os.environ, Setup__Username=state["cmsAccount"]["username"], Setup__Password=state["cmsAccount"]["password"])
        command(COMPOSE + ["run", "--rm", "--no-deps", "-e", "Setup__Username", "-e", "Setup__Password", "api", "--initialize"], env)
        command(COMPOSE + ["up", "-d", "--no-build", "api", "web", "n8n"])
        wait(state["cmsUrl"] + "/admin/login")
        wait(state["n8nUrl"] + "/healthz/readiness")
    admin = Client(state["cmsUrl"])
    owner = admin.login(**state["cmsAccount"])
    if args.action == "verify":
        drafts = admin.call("admin/contents?kind=post&q=n8n")
        matches = [item for item in drafts["items"] if item["title"].startswith("n8n 演示")]
        if not matches:
            raise RuntimeError("还没有演示草稿，请先在 n8n 中点击 Execute workflow。")
        article = admin.call("admin/contents/" + matches[0]["id"])
        assert not article["published"] and "模拟 AI" in article["html"] and "参考资料" in article["html"]
        Client(state["cmsUrl"]).call("public/contents/" + article["slug"], expected=404)
        state.update(previewUrl=state["cmsUrl"] + "/admin/preview/" + article["id"], editUrl=state["cmsUrl"] + "/admin/posts/" + article["id"])
        save(state)
        print("PASS: n8n 已通过真实 CMS 接口保存草稿，未发布。")
        print(state["previewUrl"])
        return
    n8n = N8n(state["n8nUrl"])
    settings = n8n.call("settings")
    if settings.get("userManagement", {}).get("showSetupOnFirstLoad"):
        n8n.call("owner/setup", dict(state["n8nAccount"], firstName="CMS", lastName="Demo"))
    else:
        n8n.call("login", {"emailOrLdapLoginId": state["n8nAccount"]["email"], "password": state["n8nAccount"]["password"]})
    if not state.get("credentialId"):
        issued = admin.call("admin/access-tokens", "POST", dict(name="n8n 本地演示", userId=owner["id"], scopes=["content:write", "ai:generate"],
            expiresAt=(dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=7)).isoformat()))
        credential = n8n.call("credentials", {"name": "CMS 演示 · 仅草稿与 AI", "type": "httpHeaderAuth", "data": {"name": "Authorization", "value": "Bearer " + issued["secret"]}})
        state["credentialId"] = credential["id"]
        save(state)
    workflow = json.loads((ROOT / "workflows/n8n/cms-draft.json").read_text(encoding="utf-8"))
    for node in workflow["nodes"]:
        if node.get("credentials"):
            node["credentials"] = {"httpHeaderAuth": {"id": state["credentialId"], "name": "CMS 演示 · 仅草稿与 AI"}}
    production = copy.deepcopy(workflow)
    production["name"] = "正式模板 · 使用 CMS 数据库 AI 配置"
    for node in production["nodes"]:
        if node["name"] == "主题与资料":
            values = json.loads(node["parameters"]["jsonOutput"])
            values.update(cmsUrl="http://api:8080", cmsDisplayUrl=state["cmsUrl"])
            node["parameters"]["jsonOutput"] = json.dumps(values, ensure_ascii=False, indent=2)
    if not state.get("productionWorkflowId"):
        created = n8n.call("workflows", production)
        state["productionWorkflowId"] = created["id"]
        state["productionWorkflowUrl"] = state["n8nUrl"] + "/workflow/" + created["id"]
        save(state)
    workflow["name"] = "演示 · 整理资料到 CMS 草稿（模拟 AI）"
    for node in workflow["nodes"]:
        if node["name"] == "主题与资料":
            values = json.loads(node["parameters"]["jsonOutput"])
            values.update(cmsUrl="http://api:8080", cmsDisplayUrl=state["cmsUrl"], title="n8n 演示：从资料到 CMS 草稿")
            node["parameters"]["jsonOutput"] = json.dumps(values, ensure_ascii=False, indent=2)
        if node["name"] == "AI 生成文章":
            node["type"] = "n8n-nodes-base.code"; node["typeVersion"] = 2; node.pop("credentials", None)
            node["notesInFlow"] = True; node["notes"] = "模拟 AI：用固定排版模板返回文章，不调用外部模型。"
            node["parameters"] = {"jsCode": """const input = $input.first().json;
const escape = value => String(value).replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));
const html = '<p><strong>演示说明：本文由模拟 AI 的固定排版模板生成，未调用真实模型。</strong></p>' +
  '<h2>从资料开始</h2><p>本次自动化先整理并去重了 ' + input.sourceCount + ' 条资料，然后准备一篇待审核的 CMS 草稿。</p>' +
  input.materials.map(s => '<h2>' + escape(s.title) + '</h2><p>' + escape(s.text) + '</p>').join('') +
  '<h2>下一步由编辑审核</h2><p>n8n 使用访问令牌把内容保存为草稿。编辑可以检查正文与来源，修改后再决定是否发布。</p>';
return [{json: {code:'OK', data: {html, text:'模拟 AI 演示：资料整理、文章排版与 CMS 草稿保存。内容仅供查看流程效果。', tagIds:[]}}}];"""}
        if node["name"] == "使用说明":
            node["parameters"]["content"] = "## 演示：点击 Execute workflow 看效果\n\n真实执行：资料整理 → 模拟 AI 文章 → 保存 CMS 草稿 → 返回预览链接。\n\n黄色说明节点使用固定模板，未调用真实模型。其余节点和 CMS 保存接口均实际运行。\n\n双击「主题与资料」可修改主题与资料；每次执行会创建一篇新的未发布草稿。\n\n要用真实模型，请先在 CMS 配置 AI，再打开另一条「正式模板」工作流。"
    if not state.get("demoWorkflowId"):
        created = n8n.call("workflows", workflow)
        state["demoWorkflowId"] = created["id"]
        state["demoWorkflowUrl"] = state["n8nUrl"] + "/workflow/" + created["id"]
        save(state)
    print("演示已就绪：" + state["demoWorkflowUrl"])
    print("CMS：" + state["cmsUrl"])
    print("本地演示账号保存在：" + str(STATE))


if __name__ == "__main__":
    main()
