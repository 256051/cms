"""Login acceptance against a newly created isolated SQLite database; never uses the preview database."""
import concurrent.futures
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import time
import uuid
from integration import Client

ROOT = Path(__file__).resolve().parents[1]
run = "login-" + uuid.uuid4().hex[:10]
local, output = ROOT / ".local" / run, ROOT / "artifacts" / run
local.mkdir(parents=True); output.mkdir(parents=True)
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0)); port = sock.getsockname()[1]
base = f"http://127.0.0.1:{port}"
password = "Login!" + secrets.token_hex(20)
env = dict(os.environ, Database__Type="Sqlite", Database__ConnectionString="Data Source=" + str(local / "test.db"), Security__KeyPath=str(local / "keys"), Storage__Path=str(local / "uploads"), ASPNETCORE_ENVIRONMENT="Development", Urls=base, Setup__Username="cmsadmin", Setup__Password=password)
api = ["dotnet", str(ROOT / "src/Cms.Api/bin/Debug/net10.0/Cms.Api.dll")]
flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
checks = []
def passed(message):
    checks.append(message); print("PASS:", message, flush=True)

# Loopback is the trusted proxy in this isolated host; simulated client IPs exercise the independent buckets.
def client(ip): return Client(base, {"X-Forwarded-For": f"192.0.2.{ip}"})
with (output / "api.log").open("w", encoding="utf-8") as log:
    subprocess.run(api + ["--initialize"], env=env, cwd=ROOT, stdout=log, stderr=log, check=True, creationflags=flags)
    process = subprocess.Popen(api, env=env, cwd=ROOT, stdout=log, stderr=log, creationflags=flags)
    try:
        for _ in range(60):
            try: Client(base).call("/health/ready"); break
            except Exception: time.sleep(.25)
        admin = client(1); owner = admin.login("cmsadmin", password)
        assert owner == dict(id=owner["id"], username="cmsadmin", displayName="管理员", role="Admin", enabled=True)
        assert admin.call("auth/me") == owner
        schema = admin.call("/openapi/v1.json")
        schema["servers"] = [{"url":"/"}]
        (ROOT / "docs/openapi.json").write_text(json.dumps(schema, ensure_ascii=False, indent=2), encoding="utf-8")
        guest = client(2)
        challenge = guest.call("auth/captcha")
        assert set(challenge) == {"id", "image", "expiresInSeconds"} and challenge["expiresInSeconds"] == 180
        assert "no-store" in guest.response_headers.get("Cache-Control")
        cookie = guest.response_headers.get("Set-Cookie")
        assert "httponly" in cookie.lower() and "samesite=strict" in cookie.lower()
        guest.call("auth/login", "POST", dict(username="cmsadmin", password=password), expected=400)
        code = guest.captcha()
        guest.call("auth/login", "POST", dict(username="cmsadmin", password=password, **code), csrf=False, expected=400)
        guest.call("auth/login", "POST", dict(username="cmsadmin", password=password, **code))
        guest.token = None
        passed("no plaintext answer, no-store, HttpOnly browser binding and CSRF required")

        reader = client(3); code = reader.captcha()
        other = client(4)
        assert other.call("auth/login", "POST", dict(username="cmsadmin", password=password, **code), expected=400)["code"] == "CAPTCHA_INVALID"
        assert reader.call("auth/login", "POST", dict(username="cmsadmin", password=password, **{**code, "captchaCode":"000000"}), expected=400)["code"] == "CAPTCHA_INVALID"
        reader.call("auth/login", "POST", dict(username="cmsadmin", password=password, **code), expected=400)
        old = reader.captcha(); fresh = reader.captcha()
        reader.call("auth/login", "POST", dict(username="cmsadmin", password=password, **old), expected=400)
        reader.call("auth/login", "POST", dict(username="cmsadmin", password=password, **fresh))
        passed("cross-browser copy rejected, wrong answers consume challenges, refresh replaces old image")

        user_input = dict(username="disabled", displayName="停用测试", role="Editor", enabled=False, password=password)
        created = admin.call("admin/users", "POST", user_input)
        expected_user = dict(id=created["id"], username="disabled", displayName="停用测试", role="Editor", enabled=False)
        assert created == expected_user
        user_input["displayName"] = "编辑账号 🎉"
        expected_user["displayName"] = user_input["displayName"]
        assert admin.call("admin/users/" + created["id"], "PUT", user_input) == expected_user
        assert sorted(admin.call("admin/users"), key=lambda user: user["id"]) == sorted([owner, expected_user], key=lambda user: user["id"])
        passed("login, current user, create, update and list expose exactly five safe fields with correct record, role and enabled values")
        for i, username in enumerate(("missing", "disabled", "cmsadmin"), start=5):
            response = client(i).login(username, "incorrect-password", expected=401)
            assert response["code"] == "INVALID_CREDENTIALS" and response["message"] == "账号或密码错误。"
        passed("uniform credential errors for missing, disabled and existing accounts")

        # Start from a successful login; captcha errors above must not themselves lock an account.
        client(10).login("cmsadmin", password)
        for i in range(5): client(11 + i).login(" CMSADMIN ", "incorrect-password", expected=401)
        blocked = client(16)
        assert blocked.login("cmsadmin", password, expected=429)["code"] == "LOGIN_LOCKED"
        assert 880 <= int(blocked.response_headers["Retry-After"]) <= 900
        passed("5 failures lock normalized account across client IPs, correct password cannot bypass cooldown")

        limited = client(20)
        for _ in range(10): limited.call("auth/login", "POST", {}, expected=400)
        assert limited.call("auth/login", "POST", {}, expected=429)["code"] == "RATE_LIMITED"
        assert int(limited.response_headers["Retry-After"]) > 0
        client(21).call("auth/login", "POST", {}, expected=400)
        images = client(22)
        for _ in range(30): images.call("auth/captcha")
        assert images.call("auth/captcha", expected=429)["code"] == "RATE_LIMITED"
        passed("independent IP login and challenge limits return HTTP 429 and Retry-After")

        # All calls below share a real challenge/browser, but keep separate CSRF cookies.
        single = client(23); code = single.captcha()
        clones = [client(24 + i) for i in range(8)]
        for clone in clones:
            for cookie in single.jar: clone.jar.set_cookie(cookie)
            clone.token = clone.call("auth/csrf")["token"]
        def use(clone):
            try: return clone.call("auth/login", "POST", dict(username="missing-race", password=password, **code), expected=401)["code"]
            except AssertionError as error:
                assert "got 400" in str(error) and "CAPTCHA_INVALID" in str(error); return "CAPTCHA_INVALID"
        with concurrent.futures.ThreadPoolExecutor(8) as pool: results = list(pool.map(use, clones))
        assert results.count("INVALID_CREDENTIALS") == 1 and results.count("CAPTCHA_INVALID") == 7
        passed("simultaneous replay reaches password verification only once")
        (output / "results.json").write_text(json.dumps({"status":"passed", "checks":checks}, ensure_ascii=False, indent=2), encoding="utf-8")
        print("RESULTS:", output / "results.json", flush=True)
    finally:
        process.terminate(); process.wait(timeout=20)
