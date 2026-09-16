"""Run traffic acceptance on isolated databases: python tests/traffic_acceptance.py [Sqlite|all]."""
import json
import os
import secrets
import sys
os.environ.setdefault("CMS_TEST_CONFIGURATION", "Release")
import run_matrix as matrix
from integration import Client
from traffic import check_traffic


def main():
    kinds = ["Sqlite", "PostgreSQL", "MySql", "SqlServer"] if "all" in sys.argv else [sys.argv[1] if len(sys.argv) > 1 else "Sqlite"]
    owned, results = [], {}
    try:
        for kind in kinds:
            print("DATABASE:", kind, flush=True)
            password = "Traffic!" + secrets.token_hex(18)
            env = dict(os.environ, Database__Type=kind, Database__ConnectionString=matrix.database(kind, password, owned),
                Setup__Username="trafficadmin", Setup__Password=password, ASPNETCORE_ENVIRONMENT="Development",
                Urls=f"http://127.0.0.1:{matrix.port()}", Security__KeyPath=str(matrix.LOCAL / kind / "keys"),
                Storage__Path=str(matrix.LOCAL / kind / "uploads"), Consul__Enabled="false")
            matrix.command(["dotnet", str(matrix.CHECKS), "--create-v6"], env)
            with (matrix.ARTIFACTS / (kind + "-startup-upgrade.log")).open("w", encoding="utf-8") as log:
                process = matrix.start(env, log)
                matrix.stop(process)
            matrix.command(["dotnet", str(matrix.API), "--migrate"], env)
            matrix.command(["dotnet", str(matrix.API), "--migrate"], env)
            matrix.command(["dotnet", str(matrix.CHECKS), "--verify-v6-upgrade"], env)
            matrix.command(["dotnet", str(matrix.API), "--initialize"], env)
            checks = []
            with (matrix.ARTIFACTS / (kind + "-traffic.log")).open("w", encoding="utf-8") as log:
                process = matrix.start(env, log)
                try:
                    admin = Client(env["Urls"]); admin.login("trafficadmin", password)
                    editor_password = "Editor!" + secrets.token_hex(18)
                    admin.call("admin/users", "POST", dict(username="trafficeditor", displayName="统计权限验收", role="Editor", enabled=True, password=editor_password))
                    editor = Client(env["Urls"]); editor.login("trafficeditor", editor_password)
                    persistent = check_traffic(admin, editor, checks.append)
                    (matrix.ROOT / "docs/openapi.json").write_text(json.dumps(admin.call("/openapi/v1.json"), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                finally:
                    matrix.stop(process)
                process = matrix.start(env, log)
                try:
                    assert admin.call("public/contents/" + persistent["article"]["slug"])["views"] == 3
                    assert admin.call("admin/traffic")["totalViews"] == persistent["report"]["totalViews"]
                    assert admin.call("admin/leads?status=following")["items"][0]["notes"] == "已约演示"
                    lead = persistent["lead"]
                    admin.call(f"admin/leads/{lead['id']}?version={lead['version']}", "DELETE")
                    assert admin.call("admin/leads")["total"] == 0
                    checks.append("automatic startup upgrades v6 to v7 before readiness; repeated migration preserves editorial state; visitor, traffic and inquiry survive restart; private lead deletion")
                finally:
                    matrix.stop(process)
            results[kind] = checks
            print("PASS:", kind, flush=True)
    finally:
        for name in owned:
            matrix.command(["docker", "rm", "-f", name])
        (matrix.ARTIFACTS / "traffic-results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        print("RESULTS:", matrix.ARTIFACTS / "traffic-results.json", flush=True)


if __name__ == "__main__":
    main()
