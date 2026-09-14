"""Run the same acceptance suite against four isolated databases and test backup/restart/Consul.
Usage: python tests/run_matrix.py [Sqlite|PostgreSQL|MySql|SqlServer|all]
Only containers carrying this run's explicit names are removed. No existing database is used.
"""
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import uuid
from integration import Client, suite
from site_settings import check_settings

ROOT = Path(__file__).resolve().parents[1]
RUN = uuid.uuid4().hex[:10]
ARTIFACTS = ROOT / "artifacts" / RUN
ARTIFACTS.mkdir(parents=True)
LOCAL = ROOT / ".local" / RUN
LOCAL.mkdir(parents=True)
API = ROOT / "src/Cms.Api/bin/Debug/net10.0/Cms.Api.dll"
CHECKS = ROOT / "tests/Cms.Checks/bin/Debug/net10.0/Cms.Checks.dll"
CREATION = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def command(args, env=None, timeout=180):
    result = subprocess.run(args, env=env, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout, creationflags=CREATION)
    if result.returncode:
        raise RuntimeError((result.stdout + result.stderr)[-5000:])
    return result.stdout.strip()


def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def wait_http(url, process=None, seconds=60):
    for _ in range(seconds * 2):
        if process and process.poll() is not None:
            raise RuntimeError("API exited; inspect the per-database log.")
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except Exception:
            pass
        time.sleep(.5)
    raise RuntimeError("Readiness timed out: " + url)


def start(env, log):
    process = subprocess.Popen(["dotnet", str(API)], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=CREATION)
    wait_http(env["Urls"] + "/health/ready", process)
    return process


def stop(process):
    if process.poll() is None:
        process.terminate()
        process.wait(timeout=20)


def database(kind, password, owned):
    if kind == "Sqlite":
        return "Data Source=" + str(LOCAL / "cms.db")
    name = "cms-test-" + kind.lower() + "-" + RUN
    ports = {"PostgreSQL": 5432, "MySql": 3306, "SqlServer": 1433}
    host_port = port()
    args = ["docker", "run", "-d", "--name", name, "--label", "cms.test.run=" + RUN, "-p", f"127.0.0.1:{host_port}:{ports[kind]}"]
    if kind == "PostgreSQL":
        args += ["-e", "POSTGRES_USER=cms", "-e", "POSTGRES_PASSWORD=" + password, "-e", "POSTGRES_DB=cms", "postgres:17-alpine"]
    elif kind == "MySql":
        args += ["-e", "MYSQL_ROOT_PASSWORD=" + password, "-e", "MYSQL_DATABASE=cms", "mysql:8.4", "--character-set-server=utf8mb4", "--collation-server=utf8mb4_bin"]
    else:
        args += ["-e", "ACCEPT_EULA=Y", "-e", "MSSQL_SA_PASSWORD=" + password, "-e", "MSSQL_PID=Developer", "mcr.microsoft.com/mssql/server:2022-latest"]
    command(args)
    owned.append(name)
    for _ in range(120):
        try:
            if kind == "PostgreSQL":
                command(["docker", "exec", name, "pg_isready", "-U", "cms"])
            elif kind == "MySql":
                command(["docker", "exec", "-e", "MYSQL_PWD=" + password, name, "mysql", "-uroot", "-e", "SELECT 1"])
            else:
                command(["docker", "exec", "-e", "SQLCMDPASSWORD=" + password, name, "/opt/mssql-tools18/bin/sqlcmd", "-S", "localhost", "-U", "sa", "-C", "-Q", "SELECT 1", "-b"])
            break
        except RuntimeError:
            time.sleep(1)
    else:
        raise RuntimeError("Database startup failed: " + kind)
    if kind == "PostgreSQL": return f"Host=127.0.0.1;Port={host_port};Database=cms;Username=cms;Password={password}"
    if kind == "MySql": return f"Server=127.0.0.1;Port={host_port};Database=cms;User ID=root;Password={password};Character Set=utf8mb4"
    command(["docker", "exec", "-e", "SQLCMDPASSWORD=" + password, name, "/opt/mssql-tools18/bin/sqlcmd", "-S", "localhost", "-U", "sa", "-C", "-Q", "CREATE DATABASE cms", "-b"])
    return f"Server=127.0.0.1,{host_port};Database=cms;User ID=sa;Password={password};Encrypt=True;TrustServerCertificate=True"


def restore_copy(kind, password, env):
    """Restore into a new database/file; the original is never overwritten."""
    if kind == "Sqlite":
        backup = LOCAL / "restored.db"
        shutil.copy2(LOCAL / "cms.db", backup)
        connection = "Data Source=" + str(backup)
    else:
        name = "cms-test-" + kind.lower() + "-" + RUN
        if kind == "PostgreSQL":
            prefix = ["docker", "exec", "-e", "PGPASSWORD=" + password, name]
            command(prefix + ["pg_dump", "-U", "cms", "-d", "cms", "-Fc", "-f", "/tmp/cms.dump"])
            command(prefix + ["createdb", "-U", "cms", "cmsrestore"])
            command(prefix + ["pg_restore", "-U", "cms", "-d", "cmsrestore", "/tmp/cms.dump"])
        elif kind == "MySql":
            prefix = ["docker", "exec", "-e", "MYSQL_PWD=" + password, name]
            command(prefix + ["sh", "-c", "mysqldump -uroot --single-transaction --no-tablespaces cms > /tmp/cms.sql"])
            command(prefix + ["mysql", "-uroot", "-e", "CREATE DATABASE cmsrestore CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"])
            command(prefix + ["sh", "-c", "mysql -uroot cmsrestore < /tmp/cms.sql"])
        else:
            prefix = ["docker", "exec", "-e", "SQLCMDPASSWORD=" + password, name, "/opt/mssql-tools18/bin/sqlcmd", "-S", "localhost", "-U", "sa", "-C", "-b", "-Q"]
            command(prefix + ["BACKUP DATABASE cms TO DISK='/var/opt/mssql/data/cms-test.bak' WITH INIT"])
            command(prefix + ["RESTORE DATABASE cmsrestore FROM DISK='/var/opt/mssql/data/cms-test.bak' WITH MOVE 'cms' TO '/var/opt/mssql/data/cmsrestore.mdf', MOVE 'cms_log' TO '/var/opt/mssql/data/cmsrestore_log.ldf'"])
        connection = env["Database__ConnectionString"].replace("Database=cms;", "Database=cmsrestore;")
    restored = LOCAL / kind / "restored"
    shutil.copytree(LOCAL / kind / "keys", restored / "keys")
    shutil.copytree(LOCAL / kind / "uploads", restored / "uploads")
    return dict(env, Database__ConnectionString=connection, Security__KeyPath=str(restored / "keys"), Storage__Path=str(restored / "uploads"))


def empty_database(kind, password, env, suffix):
    assert suffix in ("cmsv2", "cmsv3", "cmsv4", "cmsfresh")
    if kind == "Sqlite":
        connection = "Data Source=" + str(LOCAL / (suffix + ".db"))
    else:
        name = "cms-test-" + kind.lower() + "-" + RUN
        if kind == "PostgreSQL":
            command(["docker", "exec", "-e", "PGPASSWORD=" + password, name, "createdb", "-U", "cms", suffix])
        elif kind == "MySql":
            command(["docker", "exec", "-e", "MYSQL_PWD=" + password, name, "mysql", "-uroot", "-e", "CREATE DATABASE " + suffix + " CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"])
        else:
            command(["docker", "exec", "-e", "SQLCMDPASSWORD=" + password, name, "/opt/mssql-tools18/bin/sqlcmd", "-S", "localhost", "-U", "sa", "-C", "-b", "-Q", "CREATE DATABASE " + suffix])
        connection = env["Database__ConnectionString"].replace("Database=cms;", "Database=" + suffix + ";")
    return dict(env, Database__ConnectionString=connection)


def check_consul(env, password, owned, log):
    import base64
    name = "cms-test-consul-" + RUN
    consul_port = port()
    command(["docker", "run", "-d", "--name", name, "--label", "cms.test.run=" + RUN, "-p", f"127.0.0.1:{consul_port}:8500", "hashicorp/consul:1.21", "agent", "-dev", "-client=0.0.0.0"])
    owned.append(name)
    base = f"http://127.0.0.1:{consul_port}"
    wait_http(base + "/v1/status/leader")
    config = json.dumps({"Database":{"Type":"unsupported","ConnectionString":"invalid"},"Storage":{"MaxBytes":32}}).encode()
    urllib.request.urlopen(urllib.request.Request(base + "/v1/kv/cms/config", data=config, method="PUT")).close()
    consul_env = dict(env, Consul__Enabled="true", Consul__Address=base, Consul__Key="cms/config")
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII=")
    process = start(consul_env, log)
    try:
        client = Client(env["Urls"]); client.login("cmsadmin", password)
        client.upload("proof.png", png, expected=413)
    finally:
        stop(process)
    process = start(dict(consul_env, Storage__MaxBytes="128"), log)
    try:
        client = Client(env["Urls"]); client.login("cmsadmin", password)
        uploaded = client.upload("proof.png", png)
        client.call("admin/assets/" + uploaded["id"], "DELETE")
    finally:
        stop(process)
    result = subprocess.run(["dotnet", str(API), "--migrate"], env=dict(consul_env, Consul__Address="http://127.0.0.1:1"), cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30, creationflags=CREATION)
    assert result.returncode != 0, "Consul failure must stop startup"


def main():
    kinds = ["Sqlite", "PostgreSQL", "MySql", "SqlServer"] if len(sys.argv) < 2 or sys.argv[1] == "all" else [sys.argv[1]]
    results = {}
    owned = []
    try:
        for kind in kinds:
            print("DATABASE:", kind, flush=True)
            password = "Cms!" + secrets.token_hex(20)
            connection = database(kind, password, owned)
            env = dict(os.environ, Database__Type=kind, Database__ConnectionString=connection, Setup__Username="cmsadmin", Setup__Password=password, ASPNETCORE_ENVIRONMENT="Development", Urls=f"http://127.0.0.1:{port()}", Security__KeyPath=str(LOCAL / kind / "keys"), Storage__Path=str(LOCAL / kind / "uploads"), Consul__Enabled="false")
            (LOCAL / kind).mkdir(parents=True)
            command(["dotnet", str(CHECKS), "--create-v1"], env)
            with (ARTIFACTS / (kind + "-pre-upgrade.log")).open("w", encoding="utf-8") as log:
                old_process = subprocess.Popen(["dotnet", str(API)], cwd=ROOT, env=env, stdout=log, stderr=log, creationflags=CREATION)
                try:
                    wait_http(env["Urls"] + "/health/live", old_process)
                    Client(env["Urls"]).call("/health/ready", expected=503)
                    command(["dotnet", str(CHECKS), "--verify-v1"], env)
                finally:
                    stop(old_process)
            command(["dotnet", str(API), "--migrate"], env)
            command(["dotnet", str(API), "--migrate"], env)
            command(["dotnet", str(CHECKS), "--verify-upgrade"], env)
            init = command(["dotnet", str(API), "--initialize"], env)
            (ARTIFACTS / (kind + "-init.log")).write_text(init, encoding="utf-8")
            with (ARTIFACTS / (kind + ".log")).open("w", encoding="utf-8") as log:
                process = start(env, log)
                try:
                    checks = suite(env["Urls"], "cmsadmin", password, ROOT / "docs/openapi.json")
                    checks.append("explicit repeatable v1 through v5 migration preserves historical audit and content; normal startup does not migrate")
                    session = Client(env["Urls"])
                    session.login("cmsadmin", password)
                    stop(process)
                    process = start(env, log)
                    session.call("admin/users", "POST", dict(username="settings-editor", displayName="设置验收编辑", role="Editor", enabled=True, password="Settings!StrongPassword123"))
                    settings_editor = Client(env["Urls"]); settings_editor.login("settings-editor", "Settings!StrongPassword123")
                    check_settings(session, settings_editor, Client(env["Urls"]), checks.append)
                    original_settings = session.call("admin/settings")
                    logo_id = session.call("public/settings")["logoId"]
                    original_asset = session.call("/media/" + logo_id)
                    original_theme = session.call("admin/themes")
                    original_menu = session.call("admin/menu")
                finally:
                    stop(process)
                command(["dotnet", str(CHECKS)], env)
                checks.append("database transaction rollback, audit rollback and unique index")
                changed_env = dict(env, Setup__Password="DifferentPassword!12345")
                command(["dotnet", str(API), "--initialize"], changed_env)
                command(["dotnet", str(API), "--migrate"], env)
                process = start(env, log)
                try:
                    client = session
                    assert client.call("auth/me")["username"] == "cmsadmin"
                    assert client.call("public/settings")["title"] == "CMS 验收站"
                    assert client.call("admin/contents")["total"] > 0
                    assert client.call("/media/" + logo_id) == original_asset
                    assert client.call("admin/themes") == original_theme
                    assert client.call("admin/menu") == original_menu
                    assert client.call("admin/settings") == original_settings
                finally:
                    stop(process)
                checks.append("idempotent initialization, explicit migration and restart persistence")
                restore_env = restore_copy(kind, password, env)
                process = start(restore_env, log)
                try:
                    assert session.call("public/settings")["title"] == "CMS 验收站"
                    assert session.call("auth/me")["username"] == "cmsadmin"
                    assert session.call("/media/" + logo_id) == original_asset
                    assert session.call("admin/themes") == original_theme
                    assert session.call("admin/menu") == original_menu
                    assert session.call("admin/settings") == original_settings
                finally:
                    stop(process)
                checks.append("backup restored into a separate database with media and authentication keys")
                v2 = empty_database(kind, password, env, "cmsv2")
                command(["dotnet", str(CHECKS), "--create-v2"], v2)
                process = subprocess.Popen(["dotnet", str(API)], env=v2, cwd=ROOT, stdout=log, stderr=log, creationflags=CREATION)
                try:
                    wait_http(v2["Urls"] + "/health/live", process)
                    Client(v2["Urls"]).call("/health/ready", expected=503)
                    command(["dotnet", str(CHECKS), "--verify-v2"], v2)
                finally:
                    stop(process)
                command(["dotnet", str(API), "--migrate"], v2)
                command(["dotnet", str(API), "--migrate"], v2)
                command(["dotnet", str(CHECKS), "--verify-v2-upgrade"], v2)
                fresh = empty_database(kind, password, env, "cmsfresh")
                command(["dotnet", str(API), "--initialize"], fresh)
                command(["dotnet", str(API), "--initialize"], fresh)
                process = start(fresh, log)
                try:
                    first = Client(fresh["Urls"]); first.login("cmsadmin", password)
                    assert first.call("public/theme")["themeId"] == "classic"
                    assert len(first.call("admin/users")) == 1
                finally:
                    stop(process)
                checks.append("v2 through v5 preserves site metadata; fresh v5 initialization is repeatable with classic defaults")
                v3 = empty_database(kind, password, env, "cmsv3")
                command(["dotnet", str(CHECKS), "--create-v3"], v3)
                process = subprocess.Popen(["dotnet", str(API)], env=v3, cwd=ROOT, stdout=log, stderr=log, creationflags=CREATION)
                try:
                    wait_http(v3["Urls"] + "/health/live", process)
                    Client(v3["Urls"]).call("/health/ready", expected=503)
                    command(["dotnet", str(CHECKS), "--verify-v3"], v3)
                finally:
                    stop(process)
                command(["dotnet", str(API), "--migrate"], v3)
                command(["dotnet", str(API), "--migrate"], v3)
                command(["dotnet", str(CHECKS), "--verify-v3-upgrade"], v3)
                checks.append("v3 through v5 preserves old links and active theme; repeated upgrade and normal startup verified")
                v4 = empty_database(kind, password, env, "cmsv4")
                command(["dotnet", str(CHECKS), "--create-v4"], v4)
                process = subprocess.Popen(["dotnet", str(API)], env=v4, cwd=ROOT, stdout=log, stderr=log, creationflags=CREATION)
                try:
                    wait_http(v4["Urls"] + "/health/live", process)
                    Client(v4["Urls"]).call("/health/ready", expected=503)
                    command(["dotnet", str(CHECKS), "--verify-v4"], v4)
                finally:
                    stop(process)
                command(["dotnet", str(API), "--migrate"], v4)
                command(["dotnet", str(API), "--migrate"], v4)
                command(["dotnet", str(CHECKS), "--verify-v4-upgrade"], v4)
                checks.append("v4 to v5 preserves identity, menu and theme, initializes settings defaults and supports repeated explicit upgrade")
                if kind == "Sqlite":
                    check_consul(env, password, owned, log)
                    checks.append("Consul overrides local config, environment overrides Consul, unavailable Consul fails startup")
                results[kind] = {"status": "passed", "checks": checks}
                print("COMPLETED:", kind, len(checks), "groups", flush=True)
            (ARTIFACTS / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        print("RESULTS:", ARTIFACTS / "results.json", flush=True)
    finally:
        for name in owned:
            label = command(["docker", "inspect", "--format", '{{index .Config.Labels "cms.test.run"}}', name])
            if label == RUN:
                command(["docker", "rm", "-f", name])


if __name__ == "__main__":
    main()
