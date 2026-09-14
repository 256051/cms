"""Scoped automation acceptance; reusable against each isolated database and HTTPS deployment."""
import base64
import concurrent.futures
import datetime as dt
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
import urllib.request
import uuid
from integration import Client


def machine(admin, secret=None):
    client = Client(admin.base, {"Authorization": "Bearer " + secret} if secret else {})
    tls = [urllib.request.HTTPSHandler(context=handler._context) for handler in admin.opener.handlers if isinstance(handler, urllib.request.HTTPSHandler)]
    client.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(client.jar), *tls)
    return client


def send(client, path, method="GET", data=None, key=None, expected=200, **kwargs):
    if key is None: client.headers.pop("Idempotency-Key", None)
    else: client.headers["Idempotency-Key"] = key
    return client.call("integration/" + path, method, data, expected=expected, csrf=False, **kwargs)


def check_remote(admin, passed):
    suffix = uuid.uuid4().hex[:10]
    owner = admin.call("auth/me")
    expires = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=2)).isoformat()
    scopes = ["content:read", "content:write", "content:publish", "asset:upload"]
    def issue(permissions=scopes, **overrides):
        return admin.call("admin/access-tokens", "POST", dict(name="Agent " + suffix, userId=owner["id"], scopes=permissions, expiresAt=expires, **overrides))
    token_input = dict(name="Agent " + suffix, userId=owner["id"], scopes=scopes, expiresAt=expires)
    guest = machine(admin)
    guest.call("admin/access-tokens", expected=401)
    send(admin, "contents", expected=401)  # A valid admin cookie alone cannot authenticate integration calls.
    send(guest, "contents", expected=401)
    admin.call("admin/access-tokens", "POST", token_input, csrf=False, expected=400)
    for change in ({"scopes":["users:write"]}, {"scopes":[]}, {"name":"<script>alert(1)</script>"}, {"expiresAt":"2000-01-01T00:00:00Z"}, {"expiresAt":"2099-01-01T00:00:00Z"}):
        admin.call("admin/access-tokens", "POST", dict(token_input, **change), expected=400)
    full = issue(); agent = machine(admin, full["secret"])
    admin.headers["Authorization"] = "Bearer " + full["secret"]
    admin.call("admin/access-tokens", "POST", token_input, csrf=False, expected=400)
    admin.headers.pop("Authorization")
    assert len(full["secret"]) == 101
    assert "secretHash" not in json.dumps(full)
    for path in ("admin/users", "admin/settings", "admin/access-tokens", "auth/me"):
        agent.call(path, expected=401)
    agent.call("admin/settings", "PUT", {}, csrf=False, expected=401)
    send(machine(admin, full["secret"][:-1] + ("a" if full["secret"][-1] != "a" else "b")), "contents", expected=401)
    assert not list(agent.jar)
    passed("cookie and bearer identities are isolated; token administration requires admin and CSRF; invalid scopes, expiry and secrets rejected")

    readonly = issue(["content:read"]); reader = machine(admin, readonly["secret"])
    draft_input = dict(kind="post", title="远程发布 🎉", slug="agent-" + suffix, summary="API 内容", html='<p>远程正文</p><script>alert(1)</script>', coverId="", categoryId="", tagIds=[], version=0)
    send(reader, "contents", "POST", draft_input, key="readonly-" + suffix, expected=403)
    send(agent, "contents", "POST", draft_input, expected=400)
    send(agent, "contents", "POST", draft_input, key="short", expected=400)
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII=")
    def upload(key, content=png, name="agent.png"):
        boundary = uuid.uuid4().hex
        raw = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\nContent-Type: application/octet-stream\r\n\r\n'.encode() + content + f'\r\n--{boundary}--\r\n'.encode())
        return send(agent, "assets", "POST", key=key, raw=raw, content_type="multipart/form-data; boundary=" + boundary, expected=400 if name.endswith(".html") else 200)
    upload("invalid-file-" + suffix, b"<script>x</script>", "bad.html")
    asset = upload("upload-" + suffix)
    assert upload("upload-" + suffix) == asset
    draft_input.update(html=draft_input["html"] + f'<img src="/media/{asset["id"]}">', coverId=asset["id"])
    key = "draft-" + suffix
    draft = send(agent, "contents", "POST", draft_input, key=key)
    assert not draft["published"] and "<script" not in draft["html"]
    admin.call("public/contents/" + draft["slug"], expected=404)
    assert send(agent, "contents", "POST", draft_input, key=key) == draft
    assert send(agent, "contents", "POST", dict(draft_input, title="不同内容"), key=key, expected=409)["code"] == "IDEMPOTENCY_CONFLICT"
    assert send(reader, "contents/" + draft["id"]) == draft
    assert isinstance(send(reader, "taxonomy"), list)
    passed("safe uploads and drafts are retryable across multipart boundaries; malicious HTML is sanitized and drafts stay private")

    publish_input = dict(version=draft["version"])
    writer_only = issue(["content:write"])
    send(machine(admin, writer_only["secret"]), "contents/" + draft["id"] + "/publish", "POST", publish_input, key="forbidden-publish", expected=403)
    publication = send(agent, "contents/" + draft["id"] + "/publish", "POST", publish_input, key="publish-" + suffix)
    assert publication["path"] == "/posts/" + draft["slug"]
    assert send(agent, "contents/" + draft["id"] + "/publish", "POST", publish_input, key="publish-" + suffix) == publication
    assert "远程正文" in admin.call("public/contents/" + draft["slug"])["html"]
    edited_input = dict(draft_input, version=publication["content"]["version"], title="下一版草稿")
    edited = send(agent, "contents/" + draft["id"], "PUT", edited_input, key="edit-" + suffix)
    assert admin.call("public/contents/" + draft["slug"])["title"] == draft["title"]
    send(agent, "contents/" + draft["id"], "PUT", edited_input, key="stale-" + suffix, expected=409)
    send(agent, "contents/" + draft["id"] + "/publish", "POST", publish_input, key="stale-publish-" + suffix, expected=409)
    assert send(agent, "contents/" + draft["id"], "PUT", edited_input, key="edit-" + suffix) == edited
    passed("publish permission is separate; publishing returns the reading path; draft isolation and optimistic versions survive retries")

    concurrent_input = dict(draft_input, slug="concurrent-" + suffix)
    def repeat(_): return send(machine(admin, full["secret"]), "contents", "POST", concurrent_input, key="parallel-" + suffix)
    with concurrent.futures.ThreadPoolExecutor(6) as pool: copies = list(pool.map(repeat, range(6)))
    assert all(copy == copies[0] for copy in copies)
    assert send(agent, "contents?q=API")["total"] >= 2
    events = admin.call("admin/audit")["items"]
    assert sum(event["action"] == "content.save" and event["targetId"] == copies[0]["id"] for event in events) == 1
    assert any(event["tokenId"] == full["token"]["id"] and event["tokenName"] == full["token"]["name"] and event["targetId"] == draft["id"] for event in events)
    metadata = admin.call("admin/access-tokens")
    assert full["secret"] not in json.dumps(metadata) and "secretHash" not in json.dumps(metadata)
    assert any(item["id"] == full["token"]["id"] and item["lastUsedAt"] for item in metadata["items"])
    passed("concurrent retries create one article and one audit entry; audit identifies token and account; metadata never exposes secrets")

    editor_password = "Api!" + secrets.token_hex(12)
    member_input = dict(username="agent-" + suffix, displayName="自动化关联账号", role="Editor", enabled=True, password=editor_password)
    member = admin.call("admin/users", "POST", member_input)
    editor = machine(admin); editor.login(member_input["username"], editor_password)
    editor.call("admin/access-tokens", expected=403)
    member_token = admin.call("admin/access-tokens", "POST", dict(token_input, userId=member["id"]))
    member_agent = machine(admin, member_token["secret"]); send(member_agent, "taxonomy")
    admin.call("admin/users/" + member["id"], "PUT", dict(member_input, enabled=False))
    send(member_agent, "taxonomy", expected=401)
    admin.call("admin/access-tokens/" + full["token"]["id"] + "/revoke", "POST")
    send(agent, "contents", "POST", draft_input, key=key, expected=401)
    passed("editors cannot manage tokens; account disabling and token revocation immediately block calls including cached retries")

    limited_token = issue(["content:read"]); limited = machine(admin, limited_token["secret"])
    # A concurrent burst stays inside one window even with slower TLS handshakes.
    with concurrent.futures.ThreadPoolExecutor(12) as pool:
        list(pool.map(lambda _: send(machine(admin, limited_token["secret"]), "taxonomy"), range(60)))
    assert send(limited, "taxonomy", expected=429)["code"] == "RATE_LIMITED"
    assert int(limited.response_headers["Retry-After"]) > 0
    send(reader, "taxonomy")
    passed("per-token rate limits return 429 and Retry-After without blocking other tokens")
    persistent = issue()
    persistent_input = dict(draft_input, kind="page", slug="persistent-" + suffix)
    persistent_key = "persistent-" + suffix
    persistent_draft = send(machine(admin, persistent["secret"]), "contents", "POST", persistent_input, key=persistent_key)
    return dict(secret=persistent["secret"], input=persistent_input, key=persistent_key, draft=persistent_draft)


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    run = "integration-" + uuid.uuid4().hex[:10]
    local, output = root / ".local" / run, root / "artifacts" / run
    local.mkdir(parents=True); output.mkdir(parents=True)
    with socket.socket() as sock: sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]
    password = "Agent!" + secrets.token_hex(20)
    base = f"http://127.0.0.1:{port}"
    env = dict(os.environ, Database__Type="Sqlite", Database__ConnectionString="Data Source=" + str(local / "test.db"), Setup__Username="cmsadmin", Setup__Password=password, Security__KeyPath=str(local / "keys"), Storage__Path=str(local / "uploads"), ASPNETCORE_ENVIRONMENT="Development", Consul__Enabled="false", Urls=base)
    api = ["dotnet", str(root / "src/Cms.Api/bin" / os.environ.get("CMS_TEST_CONFIGURATION", "Debug") / "net10.0/Cms.Api.dll")]
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    checks = []
    def passed(message): checks.append(message); print("PASS:", message, flush=True)
    with (output / "api.log").open("w", encoding="utf-8") as log:
        subprocess.run(api + ["--initialize"], env=env, cwd=root, stdout=log, stderr=log, check=True, creationflags=flags)
        process = subprocess.Popen(api, env=env, cwd=root, stdout=log, stderr=log, creationflags=flags)
        try:
            for _ in range(60):
                try: Client(base).call("/health/ready"); break
                except Exception: time.sleep(.25)
            admin = Client(base); admin.login("cmsadmin", password)
            schema = admin.call("/openapi/v1.json"); schema["servers"] = [{"url":"/"}]
            (root / "docs/openapi.json").write_text(json.dumps(schema, ensure_ascii=False, indent=2), encoding="utf-8")
            persistent = check_remote(admin, passed)
            article = local / "example.html"
            article.write_text("<p>脚本发布正文</p>", encoding="utf-8")
            command = [sys.executable, str(root / "scripts/publish-article.py"), "--title", "脚本发布验收", "--slug", run, "--html", str(article), "--request-id", run, "--publish"]
            script_env = dict(os.environ, CMS_URL=base, CMS_ACCESS_TOKEN=persistent["secret"], PYTHONIOENCODING="utf-8")
            first = subprocess.run(command, env=script_env, capture_output=True, text=True, encoding="utf-8", check=True, creationflags=flags)
            second = subprocess.run(command, env=script_env, capture_output=True, text=True, encoding="utf-8", check=True, creationflags=flags)
            assert json.loads(first.stdout) == json.loads(second.stdout)
            assert "脚本发布正文" in admin.call("public/contents/" + run)["html"]
            passed("documented publishing script publishes real HTML and safely replays the same request without duplicates")
            process.terminate(); process.wait(timeout=20)
            process = subprocess.Popen(api, env=dict(env, ASPNETCORE_ENVIRONMENT="Production"), cwd=root, stdout=log, stderr=log, creationflags=flags)
            for _ in range(60):
                try: Client(base).call("/health/ready"); break
                except Exception: time.sleep(.25)
            send(machine(Client(base), persistent["secret"]), "taxonomy", expected=401)
            passed("Production rejects access tokens sent over plain HTTP")
            (output / "results.json").write_text(json.dumps({"status":"passed", "checks":checks}, ensure_ascii=False, indent=2), encoding="utf-8")
            print("RESULTS:", output / "results.json", flush=True)
        finally:
            process.terminate(); process.wait(timeout=20)
