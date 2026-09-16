"""Isolated v7 migration and trusted-proxy IP/region acceptance: python tests/geolocation_acceptance.py [Sqlite|all]."""
import json
import os
import secrets
import sys
import uuid

os.environ.setdefault("CMS_TEST_CONFIGURATION", "Release")
import run_matrix as matrix
from integration import Client


def check_network(admin, editor):
    browser = Client(admin.base, {"User-Agent": "Mozilla/5.0", "X-Forwarded-For": "114.114.114.114"})
    first = dict(id=uuid.uuid4().hex, path="/", referrer="", campaign="geo-check")
    receipt = browser.call("public/visits", "POST", dict(first, ipAddress="1.1.1.1", location="伪造地区"))
    assert set(receipt) == {"id", "views"}, receipt
    profile = next(v for v in admin.call("admin/visitors")["items"] if v["source"] == "推广：geo-check")
    assert profile["ipAddress"] == "114.114.114.114" and "中国" in profile["location"], profile
    route = f"admin/visitors/{profile['id']}/visits"
    browser.headers["X-Forwarded-For"] = "2001:4860:4860::8888"
    second = dict(first, id=uuid.uuid4().hex)
    browser.call("public/visits", "POST", second)
    ipv6 = next(v for v in admin.call(route)["items"] if v["id"] == second["id"])
    assert ipv6["ipAddress"] == "2001:4860:4860::8888" and ipv6["location"] not in ("", "未知地区"), ipv6
    # A retry from another network cannot rewrite the original visit or the profile's latest accepted network.
    browser.headers["X-Forwarded-For"] = "8.8.8.8"
    for _ in range(3):
        browser.call("public/visits", "POST", first)
    profile = next(v for v in admin.call("admin/visitors")["items"] if v["id"] == profile["id"])
    assert profile["views"] == 2 and profile["ipAddress"] == ipv6["ipAddress"] and profile["location"] == ipv6["location"]
    old = next(v for v in admin.call(route)["items"] if v["id"] == first["id"])
    assert old["ipAddress"] == "114.114.114.114" and "中国" in old["location"]
    for forwarded, expected_ip, expected_location in [
        ("::ffff:114.114.114.114", "114.114.114.114", None),
        ("10.2.3.4", "10.2.3.4", "内网地址"),
        ("192.0.2.1", "192.0.2.1", "保留地址"),
        ("1.1.1.1, 8.8.8.8", "8.8.8.8", None),
        ("invalid-header", "127.0.0.1", "本机地址"),
    ]:
        browser.headers["X-Forwarded-For"] = forwarded
        browser.headers["X-Real-IP"] = "9.9.9.9"
        event = dict(first, id=uuid.uuid4().hex)
        browser.call("public/visits", "POST", event)
        row = next(v for v in admin.call(route)["items"] if v["id"] == event["id"])
        assert row["ipAddress"] == expected_ip, row
        if expected_location:
            assert row["location"] == expected_location, row
    for endpoint in ("admin/visitors", route):
        browser.call(endpoint, expected=401)
        editor.call(endpoint, expected=403)
    report = admin.call("admin/traffic")
    assert report["today"]["visitors"] == 1 and report["today"]["views"] == 7, report
    history = admin.call(route)
    return profile["id"], history


def main():
    kinds = ["Sqlite", "PostgreSQL", "MySql", "SqlServer"] if "all" in sys.argv else [sys.argv[1] if len(sys.argv) > 1 else "Sqlite"]
    owned, results = [], {}
    matrix.command(["dotnet", str(matrix.CHECKS), "--geolocation"])
    try:
        for kind in kinds:
            print("DATABASE:", kind, flush=True)
            password = "Geo!" + secrets.token_hex(18)
            env = dict(os.environ, Database__Type=kind, Database__ConnectionString=matrix.database(kind, password, owned),
                Setup__Username="geoadmin", Setup__Password=password, ASPNETCORE_ENVIRONMENT="Development",
                Urls=f"http://127.0.0.1:{matrix.port()}", Security__KeyPath=str(matrix.LOCAL / kind / "keys"),
                Storage__Path=str(matrix.LOCAL / kind / "uploads"), Consul__Enabled="false")
            matrix.command(["dotnet", str(matrix.CHECKS), "--create-v7"], env)
            with (matrix.ARTIFACTS / (kind + "-geolocation.log")).open("w", encoding="utf-8") as log:
                process = matrix.start(env, log)
                matrix.stop(process)
                matrix.command(["dotnet", str(matrix.API), "--migrate"], env)
                matrix.command(["dotnet", str(matrix.CHECKS), "--verify-v7-upgrade"], env)
                matrix.command(["dotnet", str(matrix.API), "--initialize"], env)
                process = matrix.start(env, log)
                try:
                    admin = Client(env["Urls"]); admin.login("geoadmin", password)
                    editor_password = "Editor!" + secrets.token_hex(18)
                    admin.call("admin/users", "POST", dict(username="geoeditor", displayName="IP 权限验收", role="Editor", enabled=True, password=editor_password))
                    editor = Client(env["Urls"]); editor.login("geoeditor", editor_password)
                    visitor, history = check_network(admin, editor)
                    legacy = next(v for v in admin.call("admin/visitors")["items"] if v["source"] == "legacy-region")
                    assert not legacy["ipAddress"] and not legacy["location"], legacy
                    (matrix.ROOT / "docs/openapi.json").write_text(json.dumps(admin.call("/openapi/v1.json"), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                finally:
                    matrix.stop(process)
                process = matrix.start(env, log)
                try:
                    assert admin.call(f"admin/visitors/{visitor}/visits") == history
                    assert admin.call("admin/leads")["items"][0]["contact"] == "legacy@example.test"
                finally:
                    matrix.stop(process)
            results[kind] = "passed: v7 migration/retry, real IPv4/IPv6 lookup, private/reserved IP, proxy chain/body spoof rejection, per-visit history, one UV across IP changes, permission and restart persistence"
            print("PASS:", kind, flush=True)
    finally:
        for name in owned:
            matrix.command(["docker", "rm", "-f", name])
        (matrix.ARTIFACTS / "geolocation-results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        print("RESULTS:", matrix.ARTIFACTS / "geolocation-results.json", flush=True)


if __name__ == "__main__":
    main()
