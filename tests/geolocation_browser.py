"""Run browser checks against a disposable local database and built Next.js output; never use the daily site."""
import json
import os
import secrets
import socket
import subprocess
import uuid

os.environ.setdefault("CMS_TEST_CONFIGURATION", "Release")
import run_matrix as matrix
from integration import Client


def main(spec="geolocation.spec.ts", isolated_build=False):
    # The default local Next.js build rewrites API requests to 5080; refuse to touch an existing listener.
    api_port = matrix.port() if isolated_build else 5080
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", api_port))
    password = "GeoBrowser!" + secrets.token_hex(18)
    web_port = matrix.port()
    env = dict(os.environ, Database__Type="Sqlite", Database__ConnectionString="Data Source=" + str(matrix.LOCAL / "browser.db"),
        Setup__Username="geobrowser", Setup__Password=password, ASPNETCORE_ENVIRONMENT="Development",
        Urls=f"http://127.0.0.1:{api_port}", Security__KeyPath=str(matrix.LOCAL / "keys"), Storage__Path=str(matrix.LOCAL / "uploads"),
        Consul__Enabled="false", API_INTERNAL_URL=f"http://127.0.0.1:{api_port}", SITE_URL=f"http://127.0.0.1:{web_port}",
        Maintenance__BackupPath=str(matrix.LOCAL / "backups"), Maintenance__BackupIntervalHours="0", Maintenance__TrafficRetentionDays="0")
    matrix.command(["dotnet", str(matrix.CHECKS), "--create-v7"], env)
    matrix.command(["dotnet", str(matrix.API), "--initialize"], env)
    credentials = matrix.LOCAL / "credentials.json"
    credentials.write_text(json.dumps(dict(username="geobrowser", password=password)), encoding="utf-8")
    env.update(CMS_TEST_BASE_URL=env["SITE_URL"], CMS_TEST_CREDENTIALS_PATH=str(credentials), CMS_TEST_ARTIFACTS=str(matrix.ARTIFACTS))
    if isolated_build:
        env["CMS_TEST_DIST_DIR"] = ".next-test-" + matrix.RUN
        generated_paths = [matrix.ROOT / "web/tsconfig.json", matrix.ROOT / "web/next-env.d.ts"]
        originals = {path: path.read_bytes() for path in generated_paths}
        try:
            build = subprocess.run(["node", "node_modules/next/dist/bin/next", "build"], cwd=matrix.ROOT / "web", env=env,
                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180, creationflags=matrix.CREATION)
            (matrix.ARTIFACTS / "build.log").write_text(build.stdout + build.stderr, encoding="utf-8")
            if build.returncode:
                raise RuntimeError(build.stdout + build.stderr)
        finally:
            for path, original in originals.items():
                path.write_bytes(original)
    with (matrix.ARTIFACTS / "api.log").open("w", encoding="utf-8") as api_log, (matrix.ARTIFACTS / "web.log").open("w", encoding="utf-8") as web_log:
        api = matrix.start(env, api_log)
        web = None
        try:
            visitor = Client(env["Urls"], {"User-Agent": "Mozilla/5.0", "X-Forwarded-For": "114.114.114.114"})
            visitor.call("public/visits", "POST", dict(id=uuid.uuid4().hex, path="/", referrer="", campaign="geo-browser"))
            visitor.headers["X-Forwarded-For"] = "240e:3b7:3272:d8d0:db09:c067:8d59:539e"
            visitor.call("public/visits", "POST", dict(id=uuid.uuid4().hex, path="/", referrer="", campaign="geo-browser"))
            web = subprocess.Popen(["node", "node_modules/next/dist/bin/next", "start", "-p", str(web_port), "--hostname", "127.0.0.1"],
                cwd=matrix.ROOT / "web", env=env, stdout=web_log, stderr=web_log, creationflags=matrix.CREATION)
            matrix.wait_http(env["SITE_URL"] + "/admin/login", web)
            result = subprocess.run(["node", "node_modules/@playwright/test/cli.js", "test", spec],
                cwd=matrix.ROOT / "web", env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=300, creationflags=matrix.CREATION)
            (matrix.ARTIFACTS / "browser.log").write_text(result.stdout + result.stderr, encoding="utf-8")
            if result.returncode:
                raise RuntimeError(result.stdout + result.stderr)
            print("PASS: browser", spec)
        finally:
            if web:
                matrix.stop(web)
            matrix.stop(api)
    print("RESULTS:", matrix.ARTIFACTS)


if __name__ == "__main__":
    main()
