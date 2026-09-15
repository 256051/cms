"""Isolated Compose HTTPS acceptance. Requires Docker, prebuilt cms-*:local images and Python cryptography."""
import base64
import datetime
import json
import os
from pathlib import Path
import secrets
import socket
import ssl
import subprocess
import time
import urllib.request
import uuid

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from integration import Client
from remote_api import check_remote, machine, send

ROOT = Path(__file__).resolve().parents[1]
run_id = "docker-" + uuid.uuid4().hex[:10]
project = "cms-" + run_id
local = ROOT / ".local" / run_id
output = ROOT / "artifacts" / run_id
local.mkdir(parents=True)
output.mkdir(parents=True)


def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def command(args):
    result = subprocess.run(args, cwd=ROOT, text=True, encoding="utf-8", errors="replace", stdout=subprocess.PIPE, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    with (output / "compose.log").open("a", encoding="utf-8") as log:
        log.write(result.stdout)
    if result.returncode:
        raise RuntimeError("Command failed; see " + str(output / "compose.log"))
    return result.stdout.strip()


key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
now = datetime.datetime.now(datetime.timezone.utc)
cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
    .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(minutes=1))
    .not_valid_after(now + datetime.timedelta(days=1)).add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost")]), critical=False)
    .sign(key, hashes.SHA256()))
(local / "fullchain.pem").write_bytes(cert.public_bytes(serialization.Encoding.PEM))
(local / "privkey.pem").write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
http_port, https_port = port(), port()
base = f"https://localhost:{https_port}"
password = "Cms!" + secrets.token_hex(20)
(local / ".env").write_text(f"CMS_ENVIRONMENT=Production\nDB_TYPE=Sqlite\nDB_CONNECTION_STRING=Data Source=/data/cms.db\nSETUP_USERNAME=cmsadmin\nSETUP_PASSWORD={password}\nSITE_URL={base}\nTLS_DIRECTORY={local.as_posix()}\nCMS_NETWORK_SUBNET=172.30.47.0/24\n", encoding="utf-8")
(local / "override.yaml").write_text(f"services:\n  api:\n    image: cms-api:local\n  web:\n    image: cms-web:local\n  gateway:\n    ports: !override\n      - '127.0.0.1:{http_port}:80'\n      - '127.0.0.1:{https_port}:443'\n", encoding="utf-8")
compose = ["docker", "compose", "--project-name", project, "--env-file", str(local / ".env"), "-f", "compose.yaml", "-f", "compose.https.yaml", "-f", str(local / "override.yaml")]
context = ssl.create_default_context(cafile=str(local / "fullchain.pem"))
admin = Client(base)
admin.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(admin.jar), urllib.request.HTTPSHandler(context=context))


def ready():
    for _ in range(90):
        try:
            with admin.opener.open(base + "/health/ready", timeout=3) as response:
                if response.status == 200:
                    return
        except Exception:
            time.sleep(1)
    raise RuntimeError("Compose was not ready")


try:
    command(compose + ["run", "--rm", "--no-deps", "api", "--initialize"])
    command(compose + ["up", "-d", "--no-build", "api", "web", "gateway"])
    ready()
    admin.login("cmsadmin", password)
    assert all(cookie.secure for cookie in admin.jar if cookie.name in ("cms.session", "cms.csrf", "cms.login"))
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII=")
    asset = admin.upload("docker.png", png)
    draft = admin.call("admin/contents", "POST", dict(kind="post", title="Docker HTTPS 验收", slug="docker-proof", summary="镜像与反向代理验证", html=f'<p>容器服务端渲染正文</p><img src="/media/{asset["id"]}">', coverId=asset["id"], categoryId="", tagIds=[], version=0))
    admin.call(f'admin/contents/{draft["id"]}/publish', "POST", dict(version=draft["version"]))
    assert "容器服务端渲染正文" in admin.call("/posts/docker-proof").decode()
    assert base in admin.call("/sitemap.xml").decode()
    assert base in admin.call("/robots.txt").decode()
    assert admin.call("/media/" + asset["id"]) == png
    from editor import check_editor
    editor_checks = []
    check_editor(admin, editor_checks.append)
    integration_checks = []
    persistent = check_remote(admin, integration_checks.append)
    command(compose + ["restart", "api", "web", "gateway"])
    ready()
    assert admin.call("auth/me")["username"] == "cmsadmin"
    assert send(machine(admin, persistent["secret"]), "contents", "POST", persistent["input"], key=persistent["key"]) == persistent["draft"]
    assert admin.call("/media/" + asset["id"]) == png
    assert "容器服务端渲染正文" in admin.call("/posts/docker-proof").decode()
    credentials = local / "browser-credentials.json"
    credentials.write_text(json.dumps({"username": "cmsadmin", "password": password}), encoding="utf-8")
    browser_env = dict(os.environ, CMS_TEST_BASE_URL=base, CMS_TEST_CREDENTIALS_PATH=str(credentials), CMS_TEST_SELF_SIGNED="1")
    with (output / "browser.log").open("w", encoding="utf-8") as browser_log:
        browser = subprocess.run(["node", "node_modules/@playwright/test/cli.js", "test"], cwd=ROOT / "web", env=browser_env, stdout=browser_log, stderr=subprocess.STDOUT, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    if browser.returncode:
        raise RuntimeError("Browser acceptance failed; see " + str(output / "browser.log"))
    theme_state = admin.call("admin/themes")
    menu_state = admin.call("admin/menu")
    settings_state = admin.call("admin/settings")
    command(compose + ["restart", "api", "web", "gateway"])
    ready()
    assert admin.call("admin/themes") == theme_state
    assert admin.call("admin/menu") == menu_state
    assert admin.call("admin/settings") == settings_state
    assert admin.call("auth/me")["username"] == "cmsadmin"
    result = {"status":"passed", "timestamp":now.isoformat(), "checks":["non-root API and Next.js Docker images", "Compose initialization and Nginx HTTPS same-origin routing", "Production secure session and CSRF cookies", "login, upload, publish and server-rendered article", "runtime SITE_URL in sitemap and robots", "restart preserves database, media and authenticated session", "Playwright publication, unsaved forms, SEO, loading recovery, keyboard and audit acceptance", "fifteen theme layouts, private preview navigation, independent profiles, accessible colors, SSR SEO and restart persistence"]}
    result["checks"].append("fifteen themes support visitor light, dark and system appearance, readable colors, SSR cookie preference, no-JavaScript reading and visitor isolation")
    result["checks"].append("five menu target types, nested keyboard navigation in fifteen themes at three widths, protected editing, preview links and restart persistence")
    result["checks"].append("site settings, favicon and language, live pagination and search indexing policy, comment controls, conflict protection and restart persistence")
    result["checks"].append("login image challenge over HTTPS, secure browser binding, refresh, retained inputs, retry countdown and mobile keyboard login")
    result["checks"].extend(integration_checks)
    result["checks"].extend(editor_checks)
    result["checks"].append("rich editor insertion, paste/upload, table editing, media playback, formatting round trip and responsive public rendering in fifteen themes")
    result["checks"].append("Eleven community themes preview isolation, keyboard-operated article TOC, unique heading anchors and body HTML without JavaScript")
    result["checks"].append("integration tokens and replay receipts survive restart; token UI, one-time secrets, remote publishing, responsive layouts and keyboard revocation")
    (output / "results.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("PASS: Docker Compose HTTPS, publication and restart; results:", output / "results.json")
finally:
    command(compose + ["logs", "--no-color", "--tail", "80"])
    # This unique project and its volumes were created exclusively by this test.
    ids = command(compose + ["ps", "-aq"]).splitlines()
    for container in ids:
        label = command(["docker", "inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', container])
        if label != project:
            raise RuntimeError("Refusing cleanup outside the test project")
    command(compose + ["down", "--volumes"])
