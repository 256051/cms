"""Seven operational improvements on disposable databases and local-only notification receivers.
Usage: python tests/operations_acceptance.py [all]
"""
import base64
from datetime import datetime, timedelta, timezone
import io
import json
import os
from pathlib import Path
import secrets
import socketserver
import subprocess
import sys
import threading
import time
from urllib.parse import quote
import uuid
import zipfile
from http.server import ThreadingHTTPServer

os.environ.setdefault("CMS_TEST_CONFIGURATION", "Release")
import run_matrix as matrix
from integration import Client
from content_transfer_acceptance import upload_package, unpack
from notification_acceptance import Smtp, Webhook


def until(check, seconds=45):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        value = check()
        if value:
            return value
        time.sleep(.5)
    raise AssertionError("Expected background result did not arrive")


def run(kind, smtp, http, owned):
    message_offset = len(Smtp.messages)
    directory = matrix.LOCAL / kind
    directory.mkdir(exist_ok=True)
    password = "Operations!" + secrets.token_hex(18)
    env = dict(os.environ, Database__Type=kind, Database__ConnectionString=matrix.database(kind, password, owned),
        Setup__Username="opsadmin", Setup__Password=password, ASPNETCORE_ENVIRONMENT="Development", Consul__Enabled="false",
        Urls=f"http://127.0.0.1:{matrix.port()}", Security__KeyPath=str(directory / "keys"), Storage__Path=str(directory / "uploads"),
        Maintenance__BackupPath=str(directory / "backups"), Maintenance__BackupIntervalHours="0", Maintenance__TrafficRetentionDays="0",
        Maintenance__BackupKeepCount="2", Maintenance__BackupRetentionDays="7", Maintenance__LowDiskSpaceMb="1048576",
        Notifications__Enabled="true", Notifications__SiteUrl="http://127.0.0.1:9999",
        Notifications__Email__Enabled="true", Notifications__Email__Host="127.0.0.1", Notifications__Email__Port=str(smtp.server_address[1]),
        Notifications__Email__EnableSsl="false", Notifications__Email__From="cms@local.invalid", Notifications__Email__To="admin@local.invalid",
        Notifications__Email__Username="", Notifications__Email__Password="",
        Notifications__WeCom__Enabled="true", Notifications__WeCom__WebhookUrl=f"http://127.0.0.1:{http.server_port}/webhook")
    matrix.command(["dotnet", str(matrix.CHECKS), "--create-v14-operations"], env)
    checks = []
    def passed(message):
        checks.append(message)
        print("PASS:", kind, message, flush=True)
    with (matrix.ARTIFACTS / (kind + "-operations.log")).open("w", encoding="utf-8") as log:
        process = matrix.start(env, log)
        try:
            admin, guest, editor, support, other = [Client(env["Urls"]) for _ in range(5)]
            owner = admin.login("opsadmin", password)
            assert owner["id"] == "a" * 32 and owner["email"] == ""
            assert admin.call("admin/comments")["items"][0]["body"] == "原评论保持不变"
            if kind == "Sqlite":
                (matrix.ROOT / "docs/openapi.json").write_text(json.dumps(admin.call("/openapi/v1.json"), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            passed("schema 14 startup migration preserves account and comment")
            accounts = {}
            for role, client, name in [("Editor", editor, "opseditor"), ("Support", support, "opssupport"), ("Support", other, "opsother")]:
                accounts[name] = admin.call("admin/users", "POST", dict(username=name, displayName=name, role=role,
                    enabled=True, password=password, email=name + "@local.invalid"))
                client.login(name, password)
            support_id, other_id = accounts["opssupport"]["id"], accounts["opsother"]["id"]
            admin.call("admin/users", "POST", dict(username="bademail", displayName="bad", role="Support", enabled=True,
                password=password, email="bad@example.com\r\nBcc: x@example.com"), expected=400)
            for path in ["contents", "stats", "assets", "taxonomy", "comments", "users", "settings", "audit", "maintenance", "notifications", "traffic", "visitors", "inquiry-form", "access-tokens"]:
                support.call("admin/" + path, expected=403)
            editor.call("admin/leads", expected=403)
            assert [x["id"] for x in support.call("admin/leads/owners")] == [support_id]
            png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII=")
            asset = admin.upload("roundtrip.png", png)
            support.call(asset["url"], expected=404)
            category = admin.call("admin/taxonomy", "POST", dict(kind="category", name="文章测试", slug="ops-category"))
            def draft(slug, html):
                return dict(kind="post", slug=slug, title=slug, summary="文章测试", html=html, coverId=asset["id"],
                    categoryId=category["id"], tagIds=[], version=0, seo=dict(title="SEO", description="分享描述", imageId=asset["id"], noIndex=True))
            first = admin.call("admin/contents", "POST", draft("ops-first", '<p>文字与附件</p><img src="' + asset["url"] + '">'))
            second = admin.call("admin/contents", "POST", draft("ops-second", '<a href="/posts/ops-first?q=1#body">上一篇</a>'))
            first = admin.call(f'admin/contents/{first["id"]}/publish', "POST", dict(version=first["version"]))
            package = admin.call("admin/contents/export", "POST", dict(kind="post", ids=[first["id"], second["id"]]))
            manifest, files = unpack(package)
            assert len(manifest["assets"]) == 1 and len(manifest["contents"]) == 2
            imported = upload_package(admin, "post", package)
            assert imported["renamed"] == 2
            imported_rows = [admin.call("admin/contents/" + x["id"]) for x in imported["items"]]
            assert all(not x["published"] and x["layout"] is None and x["coverId"] != asset["id"] for x in imported_rows)
            first_slug = next(x["slug"] for x in imported["items"] if x["sourceSlug"] == "ops-first")
            assert "/posts/" + first_slug + "?q=1#body" in next(x["html"] for x in imported_rows if x["title"] == "ops-second")
            assert len(unpack(admin.call("admin/contents/export", "POST", dict(kind="post", q="ops-second", status="draft")))[0]["contents"]) == 2
            support.call("admin/contents/export", "POST", dict(kind="post"), expected=403)
            passed("article ZIP selection/filtering, attachments, SEO, internal links and isolated draft imports")
            comment = guest.call("public/comments", "POST", dict(contentId=first["id"], author="读者", body="请问如何使用"))
            cid = comment["id"]
            editor.call(f"admin/comments/{cid}/reply", "PUT", dict(reply="越权"), expected=403)
            admin.call(f"admin/comments/{cid}/reply", "PUT", dict(reply="答复 <script>按纯文本显示</script>"), csrf=False, expected=400)
            admin.call(f"admin/comments/{cid}/reply", "PUT", dict(reply="答复 <script>按纯文本显示</script>"))
            assert guest.call("public/comments?contentId=" + first["id"])["total"] == 0
            admin.call("admin/comments/batch", "POST", dict(ids=[cid, uuid.uuid4().hex], action="approve"), expected=409)
            assert not admin.call("admin/comments?contentId=" + first["id"])["items"][0]["approved"]
            admin.call("admin/comments/batch", "POST", dict(ids=[cid], action="approve"))
            shown = guest.call("public/comments?contentId=" + first["id"])["items"][0]
            assert shown["replyBy"] == owner["displayName"] and shown["reply"].startswith("答复")
            row = admin.call("admin/comments?contentId=" + first["id"] + "&q=" + quote("如何"))["items"][0]
            assert row["contentTitle"] == "ops-first" and row["contentUrl"] == "/posts/ops-first" and row["editorUrl"].endswith(first["id"])
            audit = admin.call(f'admin/audit?action=comment.reply&actor={owner["id"]}&target={cid}')
            assert audit["total"] == 1 and audit["items"][0]["actorName"] == owner["displayName"]
            assert admin.call("admin/audit?from=2099-01-01T00%3A00%3A00Z")["total"] == 0
            admin.call("admin/audit?from=2099-01-01&to=2020-01-01", expected=400)
            passed("comment context, official reply visibility, atomic moderation and audit filters")
            leads = []
            for name in ["mine", "other", "unassigned"]:
                receipt = guest.call("public/leads", "POST", dict(id=uuid.uuid4().hex, path="/", name=name, contact=name + "@example.test",
                    organization="测试", need="验证咨询权限", consent=True))
                leads.append(next(x for x in admin.call("admin/leads")["items"] if x["id"] == receipt["id"]))
            next_contact = (datetime.now(timezone.utc) + timedelta(seconds=2)).isoformat()
            def assign(row, who):
                return admin.call("admin/leads/" + row["id"], "PUT", dict(version=row["version"], status="following", notes="已分配", ownerId=who, nextContactAt=next_contact if row["id"] == leads[0]["id"] else None))
            leads[0], leads[1] = assign(leads[0], support_id), assign(leads[1], other_id)
            assert support.call("admin/leads?owner=" + other_id)["total"] == 1
            assert support.call("admin/leads")["items"][0]["id"] == leads[0]["id"]
            other.call(f'admin/leads/{leads[0]["id"]}/followups', expected=404)
            for row, expected in [(leads[0], 403), (leads[1], 404)]:
                support.call("admin/leads/" + row["id"], "PUT", dict(version=row["version"], status="following", notes="越权转派", ownerId=other_id), expected=expected)
            support.call(f'admin/leads/{leads[0]["id"]}?version={leads[0]["version"]}', "DELETE", expected=403)
            exported = support.call("admin/leads/export?owner=" + other_id).decode("utf-8-sig")
            assert "mine@example.test" in exported and "other@example.test" not in exported
            until(lambda: support.call("admin/leads/overdue-count") == 1, seconds=8)
            admin.call("admin/notifications/test/email", "POST", csrf=False, expected=400)
            email = admin.call("admin/notifications/test/email", "POST")
            webhook = admin.call("admin/notifications/test/wecom", "POST")
            admin.call("admin/notifications/test/email", "POST", expected=429)
            support.call("admin/notifications/test/email", "POST", expected=403)
            admin.call("admin/notifications/test/sms", "POST", expected=400)
            def delivery(id, status):
                return next((x for x in admin.call("admin/notifications")["items"] if x["id"] == id and x["status"] == status), None)
            until(lambda: delivery(email["id"], "sent"))
            until(lambda: delivery(webhook["id"], "failed"))
            until(lambda: any(b"opssupport@local.invalid" in message for message in Smtp.messages[message_offset:]))
            admin.call(f'admin/notifications/{webhook["id"]}/retry', "POST")
            until(lambda: delivery(webhook["id"], "sent"))
            admin.call(f'admin/notifications/{email["id"]}/retry', "POST", expected=409)
            passed("support scope on list/history/update/export, overdue reminders, SMTP owner routing and webhook test/retry")
            current = support.call("admin/leads")["items"][0]
            updated = support.call("admin/leads/" + current["id"], "PUT", dict(version=current["version"], status="completed", notes="已完成", ownerId=support_id))
            assert support.call("admin/leads?mine=true")["total"] == 0
            admin.call("admin/leads/" + updated["id"], "PUT", dict(version=updated["version"], status="following", notes="转派", ownerId=other_id))
            support.call(f'admin/leads/{updated["id"]}/followups', expected=404)
            assert support.call("admin/leads")["total"] == 0
            for _ in range(3): admin.call("admin/maintenance/backup", "POST")
            backups = admin.call("admin/maintenance/files")
            assert len(backups) == 2 and sum(x["latest"] for x in backups) == 1 and all(x["size"] > 0 for x in backups)
            assert admin.call("admin/maintenance")["storageWarning"]
            latest = next(x for x in backups if x["latest"])
            raw = admin.call("admin/maintenance/download?name=" + latest["name"])
            with zipfile.ZipFile(io.BytesIO(raw)) as zip:
                assert json.loads(zip.read("manifest.json"))["Schema"] == 15
            admin.call("admin/maintenance/download?name=" + quote("../outside.zip", safe=""), expected=400)
            old = next(x for x in backups if not x["latest"])
            old_path = directory / "backups" / old["name"]
            os.utime(old_path, (time.time() - 10 * 86400,) * 2)
            admin.call("admin/maintenance/backup", "POST")
            assert not old_path.exists()
            kept = admin.call("admin/maintenance/files")
            media_path = directory / "uploads" / (asset["id"] + ".png")
            held = media_path.with_suffix(".held")
            media_path.rename(held)
            try:
                admin.call("admin/maintenance/backup", "POST", expected=500)
                assert admin.call("admin/maintenance/files") == kept
            finally:
                held.rename(media_path)
            passed("backup history/download, count/age retention, capacity warning and failed-backup preservation")
            restore_zip = directory / "restore.zip"
            restore_zip.write_bytes(raw)
            restore_env = dict(env, Database__Type="Sqlite", Database__ConnectionString="Data Source=" + str(directory / "restored.db"),
                Storage__Path=str(directory / "restored-uploads"), Security__KeyPath=str(directory / "restored-keys"),
                Maintenance__BackupPath=str(directory / "restored-backups"), Notifications__Enabled="false", Urls=f"http://127.0.0.1:{matrix.port()}")
            matrix.command(["dotnet", str(matrix.API), "--restore=" + str(restore_zip)], restore_env)
            with (matrix.ARTIFACTS / (kind + "-restore.log")).open("w", encoding="utf-8") as restore_log:
                restored = matrix.start(restore_env, restore_log)
                try:
                    restored_admin = Client(restore_env["Urls"]); restored_admin.login("opsadmin", password)
                    assert any(x["role"] == "Support" and x["email"] == "opssupport@local.invalid" for x in restored_admin.call("admin/users"))
                    assert restored_admin.call("admin/comments?contentId=" + first["id"])["items"][0]["reply"] == shown["reply"]
                finally: matrix.stop(restored)
            token = admin.call("admin/access-tokens", "POST", dict(name="recovery-test", userId=owner["id"], scopes=["content:read"], expiresAt=(datetime.now(timezone.utc) + timedelta(days=1)).isoformat()))
            matrix.stop(process)
            reset = "Recovered!" + secrets.token_hex(18)
            for account, confirmation in [("opsadmin", "Different!" + reset), ("opseditor", reset), ("missing-admin", reset)]:
                rejected = subprocess.run(["dotnet", str(matrix.API), "--reset-admin=" + account], input=reset + "\n" + confirmation + "\n", env=env,
                    capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60, creationflags=matrix.CREATION)
                assert rejected.returncode != 0 and reset not in rejected.stdout + rejected.stderr
            process = matrix.start(env, log)
            assert admin.call("auth/me")["id"] == owner["id"]
            assert admin.call("admin/audit?action=password.recover")["total"] == 0
            matrix.stop(process)
            result = subprocess.run(["dotnet", str(matrix.API), "--reset-admin=opsadmin"], input=reset + "\n" + reset + "\n", env=env,
                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60, creationflags=matrix.CREATION)
            assert result.returncode == 0 and reset not in result.stdout + result.stderr
            process = matrix.start(env, log)
            admin.call("auth/me", expected=401)
            fresh = Client(env["Urls"]); fresh.login("opsadmin", password, expected=401); fresh.login("opsadmin", reset)
            assert fresh.call("admin/access-tokens")["items"][0]["revokedAt"] is not None
            assert fresh.call("admin/audit?action=password.recover")["total"] == 1
            passed("backup restoration preserves replies/roles/emails; console recovery revokes sessions and tokens")
        finally:
            matrix.stop(process)
    return checks


def main():
    smtp = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Smtp)
    http = ThreadingHTTPServer(("127.0.0.1", 0), Webhook)
    for server in [smtp, http]: threading.Thread(target=server.serve_forever, daemon=True).start()
    owned, results = [], {}
    try:
        for kind in (["Sqlite", "PostgreSQL", "MySql", "SqlServer"] if "all" in sys.argv else ["Sqlite"]):
            results[kind] = run(kind, smtp, http, owned)
            (matrix.ARTIFACTS / "operations-results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        print("RESULTS:", matrix.ARTIFACTS / "operations-results.json", flush=True)
    finally:
        for server in [smtp, http]: server.shutdown(); server.server_close()
        for name in owned:
            if matrix.command(["docker", "inspect", "--format", '{{index .Config.Labels "cms.test.run"}}', name]) == matrix.RUN:
                matrix.command(["docker", "rm", "-f", name])


if __name__ == "__main__": main()
