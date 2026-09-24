"""AI HTTP security and settings persistence checks on a disposable SQLite site; no real AI requests."""
import json
import os
import secrets
import datetime as dt
import run_matrix as matrix
from integration import Client
from remote_api import machine, send


def main():
    password = "AiCheck!" + secrets.token_hex(16)
    env = {k: v for k, v in os.environ.items() if not k.lower().startswith("ai__")}
    env.update(Database__Type="Sqlite", Database__ConnectionString="Data Source=" + str(matrix.LOCAL / "ai.db"),
        Setup__Username="aicheck", Setup__Password=password, ASPNETCORE_ENVIRONMENT="Development",
        Urls=f"http://127.0.0.1:{matrix.port()}", Security__KeyPath=str(matrix.LOCAL / "keys"), Storage__Path=str(matrix.LOCAL / "uploads"),
        Consul__Enabled="false", Maintenance__BackupPath=str(matrix.LOCAL / "backups"), Maintenance__BackupIntervalHours="0")
    matrix.command(["dotnet", str(matrix.API), "--initialize"], env)
    with (matrix.ARTIFACTS / "ai-http.log").open("w", encoding="utf-8") as log:
        process = matrix.start(env, log)
        try:
            guest = Client(env["Urls"])
            guest.call("admin/ai/status", expected=401)
            guest.call("admin/ai/generate", "POST", dict(action="write", instructions="test"), expected=401)
            admin = Client(env["Urls"])
            owner = admin.login("aicheck", password)
            assert admin.call("admin/ai/status") == dict(enabled=False, ready=False)
            def issue(scopes):
                return admin.call("admin/access-tokens", "POST", dict(name="n8n access check", userId=owner["id"], scopes=scopes,
                    expiresAt=(dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)).isoformat()))
            write_only = issue(["content:write"])
            send(machine(admin, write_only["secret"]), "ai/generate", "POST", dict(action="write", instructions="示例"), expected=403)
            ai_token = issue(["ai:generate"])
            automated = machine(admin, ai_token["secret"])
            send(automated, "ai/generate", "POST", dict(action="write", instructions="示例"), expected=409)
            send(automated, "contents", "POST", {}, key="n8n-denied-save", expected=403)
            send(automated, "contents/example/publish", "POST", {}, key="n8n-denied-publish", expected=403)
            admin.call("/api/v1/integration/ai/generate", "POST", dict(action="write", instructions="示例"), expected=401, csrf=False)
            admin.call(f'admin/access-tokens/{ai_token["token"]["id"]}/revoke', "POST")
            send(automated, "ai/generate", "POST", dict(action="write", instructions="示例"), expected=401)
            settings = dict(enabled=True, apiUrl="https://provider.example.com/v1", apiKey="ai-http-fixture-secret", model="fixture", version=0)
            admin.call("admin/ai/configuration", "PUT", settings, expected=400, csrf=False)
            saved = admin.call("admin/ai/configuration", "PUT", settings)
            assert saved["hasSecret"] and saved["values"]["apiKey"] == ""
            admin.call("admin/ai/configuration", "PUT", settings, expected=409)
            assert admin.call("admin/ai/status") == dict(enabled=True, ready=True)
            editor_pass = "AiEditor!" + secrets.token_hex(16)
            admin.call("admin/users", "POST", dict(username="aieditor", displayName="AI 编辑", role="Editor", enabled=True, password=editor_pass))
            editor = Client(env["Urls"])
            editor.login("aieditor", editor_pass)
            assert editor.call("admin/ai/status")["ready"]
            editor.call("admin/ai/configuration", expected=403)
            editor.call("admin/ai/configuration", "PUT", settings, expected=403)
            editor.call("admin/ai/test", "POST", expected=403)
            editor.call("admin/ai/generate", "POST", dict(action="write", instructions=""), expected=400)
            agent = dict(username="aistaff", displayName="咨询专员", role="Support", enabled=True, password=editor_pass)
            admin.call("admin/users", "POST", agent)
            staff = Client(env["Urls"])
            staff.login(agent["username"], editor_pass)
            staff.call("admin/ai/status", expected=403)
            staff.call("admin/ai/generate", "POST", dict(action="write", instructions="test"), expected=403)
            # An internal URL never gets a provider key: reject before opening a socket.
            invalid = dict(saved["values"], apiUrl="https://127.0.0.1/v1", apiKey="test-key")
            admin.call("admin/ai/configuration", "PUT", invalid, expected=400)
            snapshot = admin.call("/openapi/v1.json")
            snapshot["servers"] = [{"url": "/"}]
            (matrix.ROOT / "docs/openapi.json").write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            matrix.stop(process)
            process = matrix.start(env, log)
            assert admin.call("admin/ai/configuration")["values"]["model"] == "fixture"
            assert admin.call("admin/ai/configuration")["hasSecret"]
        finally:
            matrix.stop(process)
    assert "ai-http-fixture-secret" not in (matrix.ARTIFACTS / "ai-http.log").read_text(encoding="utf-8")
    print("PASS: AI HTTP permissions, CSRF, redaction, version conflict, restart persistence and OpenAPI export.")
    print("RESULTS:", matrix.ARTIFACTS)


if __name__ == "__main__":
    main()
