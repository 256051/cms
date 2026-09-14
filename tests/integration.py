"""HTTP acceptance suite. Uses only the Python standard library; targets a fresh test database."""
import concurrent.futures
import http.cookiejar
import json
import urllib.error
import urllib.request
import uuid
import base64
import time
import os
import subprocess
from pathlib import Path
from themes import check_themes
from menus import check_menus


class Client:
    def __init__(self, base, headers=None):
        self.base = base
        self.headers = headers or {}
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.token = None

    def call(self, path, method="GET", data=None, expected=200, csrf=True, raw=None, content_type=None):
        headers = dict(self.headers)
        if method != "GET" and csrf:
            if not self.token:
                self.token = self.call("auth/csrf")["token"]
            headers["X-CSRF-TOKEN"] = self.token
        body = raw if raw is not None else json.dumps(data).encode() if data is not None else None
        if body is not None:
            headers["Content-Type"] = content_type or "application/json"
        url = self.base + (path if path.startswith("/") else "/api/v1/" + path)
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            response = self.opener.open(request, timeout=30)
        except urllib.error.HTTPError as error:
            response = error
        payload = response.read()
        self.response_headers = response.headers
        assert response.code == expected, f"{method} {path}: expected {expected}, got {response.code}: {payload[:500]!r}"
        if response.headers.get_content_type() != "application/json":
            return payload
        result = json.loads(payload)
        if path.startswith("/openapi"):
            return result
        if "traceId" in result:
            assert result["traceId"]
            return result.get("data") if expected < 400 else result
        return result

    def captcha(self):
        challenge = self.call("auth/captcha")
        answer = subprocess.run(["node", str(Path(__file__).with_name("captcha.cjs"))], input=challenge["image"], capture_output=True, text=True, check=True, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0).stdout
        return dict(captchaId=challenge["id"], captchaCode=answer)

    def login(self, username, password, expected=200):
        user = self.call("auth/login", "POST", dict(username=username, password=password, **self.captcha()), expected=expected)
        self.token = None
        return user

    def upload(self, name, content, expected=200):
        boundary = "cms" + uuid.uuid4().hex
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode() + content + f"\r\n--{boundary}--\r\n".encode())
        return self.call("admin/assets", "POST", raw=body, content_type="multipart/form-data; boundary=" + boundary, expected=expected)


def suite(base, username, password, output=None):
    admin, guest = Client(base), Client(base)
    checks = []
    def passed(name):
        checks.append(name)
        print("PASS:", name, flush=True)

    guest.call("admin/contents", expected=401)
    guest.call("auth/login", "POST", {}, expected=400, csrf=False)
    guest.login(username, "incorrect", expected=401)
    owner = admin.login(username, password)
    assert "passwordHash" not in owner
    admin.call("admin/users/" + owner["id"], "DELETE", expected=409)
    owner_edit = dict(username=owner["username"], displayName=owner["displayName"], role="Admin", enabled=False, password=None)
    admin.call("admin/users/" + owner["id"], "PUT", owner_edit, expected=409)
    admin.call("admin/users/" + owner["id"], "PUT", dict(owner_edit, role="Editor", enabled=True), expected=409)
    admin.call("admin/settings", "PUT", dict(title="CSRF", description="", logoId="", keywords=""), csrf=False, expected=400)
    passed("authentication, CSRF and last administrator")

    editor_input = dict(username="editor", displayName="内容编辑", role="Editor", enabled=True, password="Editor!StrongPassword123")
    editor_user = admin.call("admin/users", "POST", editor_input)
    editor = Client(base)
    editor.login(editor_input["username"], editor_input["password"])
    editor.call("admin/users", expected=403)
    editor.call("admin/settings", "PUT", dict(title="越权", description="", logoId="", keywords=""), expected=403)
    admin.call("admin/users", "POST", editor_input, expected=409)
    passed("role permissions and duplicate accounts")
    check_themes(admin, editor, guest, passed)
    from editor import check_editor
    check_editor(admin, passed)

    category = admin.call("admin/taxonomy", "POST", dict(kind="category", name="技术与生活", slug="thinking"))
    tag = admin.call("admin/taxonomy", "POST", dict(kind="tag", name="C#", slug="csharp"))
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII=")
    asset = admin.upload("cover.png", png)
    admin.upload("attack.html", b"<script>alert(1)</script>", expected=400)
    admin.upload("fake.png", b"not an image", expected=400)
    admin.upload("huge.pdf", b"%PDF-" + b"x" * (10_485_760 + 1), expected=413)
    guest.call("/media/" + asset["id"], expected=404)
    passed("file signatures, size limit and private assets")

    body = "测试中文与 emoji 🎉 " * 2200
    draft = dict(kind="post", slug="first-post", title="第一篇文章 中文 🎉", summary="公开摘要", html=f'<h2>正文标题</h2><p>{body}</p><script>alert(1)</script><img src="/media/{asset["id"]}" onerror="alert(1)"><a href="javascript:alert(1)">链接</a><table><tbody><tr><td>表格</td></tr></tbody></table>', coverId=asset["id"], categoryId=category["id"], tagIds=[tag["id"]], version=0)
    created = editor.call("admin/contents", "POST", draft)
    assert "<script" not in created["html"] and "onerror" not in created["html"] and "javascript:" not in created["html"]
    assert "🎉" in created["html"] and len(created["html"]) > 20_000
    guest.call("public/contents/first-post", expected=404)
    assert guest.call("public/contents")["total"] == 0
    admin.call("admin/contents", "POST", draft, expected=409)
    admin.call("admin/assets/" + asset["id"], "DELETE", expected=409)
    admin.call("admin/taxonomy/" + category["id"], "DELETE", expected=409)
    published = editor.call(f'admin/contents/{created["id"]}/publish', "POST", dict(version=created["version"]))
    public = guest.call("public/contents/first-post")
    assert public["title"] == draft["title"]
    assert guest.call("/media/" + asset["id"]) == png
    passed("long Unicode content, HTML sanitization, draft isolation and publication")

    update = dict(draft, title="未发布的新标题", html="<p>未发布的新正文</p>", coverId="", categoryId="", tagIds=[], version=published["version"])
    saved = editor.call("admin/contents/" + created["id"], "PUT", update)
    assert guest.call("public/contents/first-post")["title"] == draft["title"]
    assert guest.call("public/contents?q=" + urllib.parse.quote("未发布"))["total"] == 0
    assert guest.call("public/contents?categoryId=" + category["id"])["total"] == 1
    assert guest.call("public/contents?tagId=" + tag["id"])["total"] == 1
    editor.call("admin/contents/" + created["id"], "PUT", update, expected=409)
    admin.call("admin/assets/" + asset["id"], "DELETE", expected=409)
    passed("published snapshot isolation, archive predicates and stale-version conflict")

    c2 = Client(base); c2.login(username, password)
    c2.token = c2.call("auth/csrf")["token"]
    editor.token = editor.call("auth/csrf")["token"]
    conflict_input = dict(update, version=saved["version"])
    def edit(client):
        try:
            client.call("admin/contents/" + created["id"], "PUT", conflict_input)
            return "saved"
        except AssertionError as e:
            assert "got 409" in str(e), str(e)
            return "conflict"
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        result = list(pool.map(edit, [editor, c2]))
    assert sorted(result) == ["conflict", "saved"]
    passed("simultaneous edits preserve one successful version")

    comment = guest.call("public/comments", "POST", dict(contentId=created["id"], author="读者", body="<script>这里只是纯文本</script>"))
    assert guest.call("public/comments?contentId=" + created["id"])["total"] == 0
    editor.call("admin/comments/" + comment["id"], "PUT", dict(approved=True))
    assert guest.call("public/comments?contentId=" + created["id"])["total"] == 1
    assert guest.call("public/comments?contentId=" + created["id"])["items"][0]["createdAt"].endswith("Z")
    editor.call("admin/comments/" + comment["id"], "PUT", dict(approved=False))
    for _ in range(4):
        guest.call("public/comments", "POST", dict(contentId=created["id"], author="读者", body="限流验证"))
    guest.call("public/comments", "POST", dict(contentId=created["id"], author="读者", body="超额"), expected=429)
    passed("comment moderation and rate limits")

    latest = editor.call("admin/contents/" + created["id"])
    hidden = editor.call(f'admin/contents/{created["id"]}/unpublish', "POST", dict(version=latest["version"]))
    guest.call("public/contents/first-post", expected=404)
    guest.call("/media/" + asset["id"], expected=404)
    assert all(x["id"] != created["id"] for x in guest.call("public/sitemap"))
    editor.call(f'admin/contents/{created["id"]}/publish', "POST", dict(version=hidden["version"]))
    assert guest.call("public/contents/first-post")["title"] == update["title"]
    admin.call("admin/assets/" + asset["id"], "DELETE")
    passed("unpublish removes content, media and sitemap; republish updates references")

    page_doc = admin.call("admin/contents", "POST", dict(draft, kind="page", slug="about", title="关于本站", html="<p>关于我们</p>", coverId="", tagIds=[], categoryId=""))
    admin.call(f'admin/contents/{page_doc["id"]}/publish', "POST", dict(version=page_doc["version"]))
    admin.call("admin/menu", "POST", dict(label="关于", url="/pages/about", sort=2))
    admin.call("admin/menu", "POST", dict(label="文章", url="/", sort=1))
    admin.call("admin/menu", "POST", dict(label="恶意", url="javascript:alert(1)", sort=0), expected=400)
    admin.call("admin/settings", "PUT", dict(title="CMS 验收站", description="测试配置已持久化", logoId="", keywords="内容,测试"))
    assert guest.call("public/settings")["title"] == "CMS 验收站"
    assert [x["sort"] for x in guest.call("public/menu")] == [1, 2]
    assert guest.call("public/contents?kind=page")["total"] == 1
    passed("independent pages, safe sorted menu and site settings")
    check_menus(admin, editor, guest, passed)

    retained = admin.upload("persisted.png", png)
    admin.call("admin/settings", "PUT", dict(admin.call("admin/settings"), logoId=retained["id"]))
    assert guest.call("/media/" + retained["id"]) == png

    for i in range(4): admin.call("admin/contents", "POST", dict(draft, slug=f"draft-{i}", title=f"草稿 {i}", html="<p>draft</p>", coverId="", categoryId="", tagIds=[]))
    first = guest.call("public/contents?pageSize=1&page=1")
    assert first["pageSize"] == 1 and first["total"] == 1
    assert guest.call("public/contents?page=999")["items"] == []
    for i in range(3):
        more = admin.call("admin/contents", "POST", dict(draft, slug=f"public-{i}", title=f"已发布 {i}", html="<p>public</p>", coverId="", categoryId="", tagIds=[]))
        admin.call(f'admin/contents/{more["id"]}/publish', "POST", dict(version=more["version"]))
    time.sleep(1.1)
    current = admin.call("admin/contents/" + created["id"])
    admin.call(f'admin/contents/{created["id"]}/publish', "POST", dict(version=current["version"]))
    p1 = guest.call("public/contents?pageSize=2&page=1")
    p2 = guest.call("public/contents?pageSize=2&page=2")
    assert p1["items"][0]["id"] == created["id"]
    assert p1["total"] == p2["total"] == 4
    assert len({x["id"] for x in p1["items"] + p2["items"]}) == 4
    assert admin.call("admin/audit")["total"] > 10
    passed("stable pagination, counts and audit")

    editor_input["enabled"] = False
    editor_input["password"] = None
    admin.call("admin/users/" + editor_user["id"], "PUT", editor_input)
    editor.call("auth/me", expected=401)
    passed("disabled accounts revoke existing sessions")

    # Every supported write family retains a safe object identity, including deletion.
    removed_term = admin.call("admin/taxonomy", "POST", dict(kind="tag", name="将删除的标签", slug="audit-delete"))
    admin.call("admin/taxonomy/" + removed_term["id"], "DELETE")
    removed_menu = admin.call("admin/menu", "POST", dict(label="将删除的菜单", url="/", sort=9))
    admin.call("admin/menu/" + removed_menu["id"], "DELETE")
    removed_doc = admin.call("admin/contents", "POST", dict(draft, slug="audit-delete", title="将删除的文章", html="<p>private-body-do-not-audit</p>", coverId="", categoryId="", tagIds=[]))
    admin.call("admin/contents/" + removed_doc["id"], "DELETE", dict(version=removed_doc["version"]))
    admin.call("admin/comments/" + comment["id"], "DELETE")
    admin.call("admin/users/" + editor_user["id"], "DELETE")
    audit = admin.call("admin/audit"); records = list(audit["items"])
    for page in range(2, (audit["total"] + audit["pageSize"] - 1) // audit["pageSize"] + 1):
        records.extend(admin.call(f"admin/audit?page={page}")["items"])
    current_records = [r for r in records if r["id"] != "11111111111111111111111111111111"]
    assert all(r["targetType"] and r["targetId"] and r["targetName"] for r in current_records)
    assert any(r["action"] == "content.delete" and r["targetId"] == removed_doc["id"] and r["targetName"] == "将删除的文章" for r in records)
    assert any(r["action"] == "asset.delete" and r["targetId"] == asset["id"] and r["targetName"] == "cover.png" for r in records)
    assert any(r["action"] == "user.delete" and r["targetId"] == editor_user["id"] for r in records)
    serialized = json.dumps(records, ensure_ascii=False)
    assert password not in serialized and "private-body-do-not-audit" not in serialized and "passwordHash" not in serialized
    passed("audit object identity survives deletion and excludes credentials and content")

    schema = admin.call("/openapi/v1.json")
    assert "/api/v1/admin/contents" in schema["paths"]
    if output:
        output.write_text(json.dumps(schema, ensure_ascii=False, indent=2), encoding="utf-8")
    passed("authenticated OpenAPI contract")
    return checks
