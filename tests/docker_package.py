"""Verify a real release archive in an isolated SQLite HTTPS Compose project."""
import argparse
import base64
import datetime
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import ssl
import subprocess
import tarfile
import time
import urllib.request
import uuid
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from integration import Client


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    archive = parser.parse_args().archive.resolve()
    with archive.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    assert Path(str(archive) + ".sha256").read_text().split()[0] == digest
    root = Path(__file__).resolve().parents[1]
    run_id = "package-" + uuid.uuid4().hex[:10]
    local, output = root / ".local" / run_id, root / "artifacts" / run_id
    local.mkdir(); output.mkdir()
    with tarfile.open(archive) as source:
        source.extractall(local / "unpacked", filter="data")
    bundle, = (local / "unpacked").iterdir()
    for line in (bundle / "SHA256SUMS").read_text().splitlines():
        expected, name = line.split("  ", 1)
        with (bundle / name).open("rb") as stream:
            assert hashlib.file_digest(stream, "sha256").hexdigest() == expected, name
    manifest = json.loads((bundle / "release.json").read_text())
    assert manifest["database"] == "Sqlite"
    assert {item["service"] for item in manifest["images"]} == {"api", "web", "gateway"}
    assert not (bundle / ".env").exists()
    assert not list(bundle.rglob("*.db")) and not list(bundle.rglob("*.pem"))

    def command(args):
        process = subprocess.run(args, cwd=bundle, capture_output=True, text=True, encoding="utf-8", errors="replace",
                                 creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        with (output / "docker.log").open("a", encoding="utf-8") as log:
            log.write(process.stdout + process.stderr)
        if process.returncode:
            raise RuntimeError("Command failed; inspect " + str(output / "docker.log"))
        return process.stdout.strip()

    command(["docker", "load", "--input", str(bundle / "images.tar")])
    for item in manifest["images"]:
        image = json.loads(command(["docker", "image", "inspect", item["tag"]]))[0]
        assert image["Id"] == item["id"]
        assert image["Os"] + "/" + image["Architecture"] == manifest["platform"]
    web_image = next(item["tag"] for item in manifest["images"] if item["service"] == "web")
    rewrites = json.loads(command(["docker", "run", "--rm", "--network", "none", "--entrypoint", "node", web_image, "-e",
                                   'console.log(JSON.stringify(require("./.next/routes-manifest.json").rewrites.afterFiles))']))
    for prefix in ["api", "media"]:
        route = next(item for item in rewrites if item["source"] == f"/{prefix}/:path*")
        assert route["destination"] == f"http://api:8080/{prefix}/:path*", route
    def port():
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            return sock.getsockname()[1]
    http, https = port(), port()
    base = f"https://localhost:{https}"
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    now = datetime.datetime.now(datetime.timezone.utc)
    certificate = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key())
                   .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(minutes=1))
                   .not_valid_after(now + datetime.timedelta(days=1)).add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost")]), critical=False).sign(key, hashes.SHA256()))
    tls = local / "tls"; tls.mkdir()
    (tls / "fullchain.pem").write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    (tls / "privkey.pem").write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    password = "Package!" + secrets.token_hex(16)
    env = (bundle / ".env.example").read_text().splitlines()
    overrides = {"SETUP_USERNAME": "cmsadmin", "SETUP_PASSWORD": password, "SITE_URL": base,
                 "TLS_DIRECTORY": tls.as_posix(), "CMS_NETWORK_SUBNET": "172.30.48.0/24"}
    env_path = local / ".env"
    env_path.write_text("\n".join(key + "=" + overrides[key] if (key := line.partition("=")[0]) in overrides else line for line in env) + "\n")
    override = local / "ports.yaml"
    override.write_text(f"services:\n  gateway:\n    ports: !override\n      - '127.0.0.1:{http}:80'\n      - '127.0.0.1:{https}:443'\n")
    compose = ["docker", "compose", "-p", "cms-" + run_id, "--env-file", str(env_path), "-f", "compose.yaml", "-f", "compose.https.yaml", "-f", str(override)]
    admin = Client(base)
    admin.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(admin.jar), urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=str(tls / "fullchain.pem"))))
    def ready():
        for _ in range(90):
            try:
                with admin.opener.open(base + "/health/ready", timeout=3) as response:
                    if response.status == 200: return
            except Exception: time.sleep(1)
        raise RuntimeError("Packaged site failed readiness")
    try:
        command(compose + ["config", "--quiet"])
        command(compose + ["run", "--rm", "--no-deps", "api", "--initialize"])
        command(compose + ["run", "--rm", "--no-deps", "api", "--initialize"])
        env_path.write_text(env_path.read_text().replace("SETUP_USERNAME=cmsadmin", "SETUP_USERNAME=").replace("SETUP_PASSWORD=" + password, "SETUP_PASSWORD="))
        command(compose + ["up", "-d", "--no-build", "api", "web", "gateway"])
        ready()
        assert sorted(command(compose + ["ps", "--services", "--status", "running"]).splitlines()) == ["api", "gateway", "web"]
        admin.login("cmsadmin", password)
        assert all(cookie.secure for cookie in admin.jar if cookie.name in ("cms.session", "cms.csrf", "cms.login"))
        png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII=")
        asset = admin.upload("package.png", png)
        draft = admin.call("admin/contents", "POST", dict(kind="post", title="离线部署包验收", slug="package-proof", summary="包内镜像发布测试", html=f'<p>SQLite 离线发布正文</p><img src="/media/{asset["id"]}">', coverId=asset["id"], categoryId="", tagIds=[], version=0))
        admin.call(f'admin/contents/{draft["id"]}/publish', "POST", dict(version=draft["version"]))
        # Reach Next.js directly so the gateway cannot bypass broken web rewrites.
        for path, status, expected in [("/api/v1/auth/me", 401, None), ("/media/" + asset["id"], 200, png)]:
            probe = json.loads(command(compose + ["exec", "-T", "web", "node", "-e",
                'fetch(' + json.dumps("http://127.0.0.1:3000" + path) + ', {signal: AbortSignal.timeout(10000)})'
                '.then(async r => console.log(JSON.stringify({status:r.status,body:Buffer.from(await r.arrayBuffer()).toString("base64")})))'
                '.catch(e => {console.error(e);process.exit(1)})']))
            assert probe["status"] == status, (path, probe)
            if expected is not None:
                assert base64.b64decode(probe["body"]) == expected
        themes = admin.call("admin/themes")
        assert len(themes["themes"]) == 15
        cactus = next(item for item in themes["themes"] if item["id"] == "cactus")
        admin.call("admin/themes/active", "PUT", dict(themeId="cactus", options=cactus["defaults"], version=themes["version"]))
        for theme in themes["themes"]:
            assert admin.call(theme["thumbnail"]).startswith(b"\x89PNG")
        assert "SQLite 离线发布正文" in admin.call("/posts/package-proof").decode()
        assert base in admin.call("/sitemap.xml").decode()
        command(compose + ["restart", "api", "web", "gateway"])
        ready()
        assert admin.call("auth/me")["username"] == "cmsadmin"
        assert admin.call("admin/contents")["total"] == 1
        assert admin.call("public/theme")["themeId"] == "cactus"
        assert admin.call("/media/" + asset["id"]) == png
        assert "SQLite 离线发布正文" in admin.call("/posts/package-proof").decode()
        checks = ["Archive and all bundled file checksums", "Three loaded Linux images match manifest IDs", "Compiled API and media rewrites target the Compose API service", "Direct Next.js API and media proxy requests", "SQLite initialization and repeat initialization", "Blanked setup credentials and three-service startup", "HTTPS captcha login, Secure cookies and CSRF", "Image upload and publication with server-rendered body", "Fifteen theme thumbnails and Cactus activation", "Configured domain in sitemap", "Restart preserves SQLite content, attachments, theme and authenticated session"]
        (output / "results.json").write_text(json.dumps({"status": "passed", "archive": archive.name, "testedArchiveSha256": digest, "platform": manifest["platform"], "sourceRevision": manifest["sourceRevision"], "checks": checks}, ensure_ascii=False, indent=2), encoding="utf-8")
        print("PASS: offline package, SQLite HTTPS and restart; results:", output / "results.json")
    finally:
        for container in command(compose + ["ps", "-aq"]).splitlines():
            owner = command(["docker", "inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', container])
            assert owner == "cms-" + run_id
        command(compose + ["logs", "--no-color", "--tail", "60"])
        command(compose + ["down", "--volumes"])


if __name__ == "__main__":
    main()
