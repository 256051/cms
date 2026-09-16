"""Exercise recovery, scheduling, private follow-ups and portable backup on isolated databases."""
import base64
from datetime import datetime, timedelta, timezone
import json
import os
import secrets
import sys
import time
import uuid
import zipfile
from urllib.parse import quote

os.environ.setdefault("CMS_TEST_CONFIGURATION", "Release")
import run_matrix as matrix
from integration import Client


def check(admin, guest, owner):
    category = admin.call("admin/taxonomy", "POST", dict(kind="category", name="验收分类", slug="acceptance"))
    tag = admin.call("admin/taxonomy", "POST", dict(kind="tag", name="验收标签", slug="acceptance"))
    image = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII=")
    asset = admin.upload("历史引用.png", image)
    item = admin.call("admin/contents", "POST", dict(kind="post", slug="acceptance-post", title="历史正文", summary="摘要", html=f'<p>正文独有关键词星辰</p><img src="/media/{asset["id"]}">', coverId="", categoryId=category["id"], tagIds=[tag["id"]], version=0))
    path = "admin/contents/" + item["id"]
    first_revision = admin.call(path + "/revisions")["items"][0]
    item = admin.call(path + "/publish", "POST", dict(version=item["version"]))
    first_published = admin.call(path)["publishedAt"]
    assert guest.call("public/contents?q=" + quote("星辰"))["items"][0]["summary"].find("星辰") >= 0
    item = admin.call(path, "PUT", dict(item, html="<p>新版正文</p>", title="新版草稿"))
    admin.call(path, "PUT", dict(item, version=1), expected=409)
    item = admin.call(path + "/publish", "POST", dict(version=item["version"]))
    assert item["publishedAt"] == first_published and item["lastPublishedAt"] >= first_published
    assert guest.call("public/contents?q=" + quote("星辰"))["total"] == 0
    admin.call("admin/assets/" + asset["id"], "DELETE", expected=409)
    refs = admin.call("admin/assets/" + asset["id"] + "/references")
    assert any(x["source"] == "历史版本" for x in refs)
    item = admin.call(path + "/revisions/" + first_revision["id"] + "/restore", "POST", dict(version=item["version"]))
    assert "星辰" in item["html"] and guest.call("public/contents/acceptance-post")["title"] == "新版草稿"
    assert admin.call("admin/contents?status=published&categoryId=" + category["id"] + "&tagId=" + tag["id"])["total"] == 1
    assert admin.call("admin/contents?sort=views&status=published&categoryId=" + category["id"])["total"] == 1
    copied = admin.call(path + "/duplicate", "POST")
    admin.call("admin/contents/batch", "POST", dict(action="unpublish", items=[None]), expected=400)
    assert not copied["published"] and copied["id"] != item["id"] and copied["slug"] != item["slug"]
    admin.call("admin/contents/batch", "POST", dict(action="unpublish", items=[dict(id=item["id"], version=item["version"]), dict(id=copied["id"], version=999)]), expected=409)
    assert admin.call(path)["published"]
    admin.call("admin/contents/batch", "POST", dict(action="category", categoryId="", items=[dict(id=copied["id"], version=copied["version"])]))
    copied = admin.call("admin/contents/" + copied["id"])
    guest.call("public/comments", "POST", dict(contentId=item["id"], author="访客", body="保留评论"))
    admin.call(path, "DELETE", dict(version=item["version"]))
    guest.call("public/contents/acceptance-post", expected=404)
    trash = admin.call("admin/contents?status=trash")["items"][0]
    assert admin.call("admin/contents")["total"] == 1
    assert admin.call("admin/comments")["total"] == 1
    admin.call(path + "/restore", "POST", dict(version=trash["version"]))
    item = admin.call(path)
    assert not item["published"]
    now = datetime.now(timezone.utc)
    item = admin.call(path + "/schedule", "PUT", dict(version=item["version"], publishAt=(now + timedelta(seconds=2)).isoformat(), unpublishAt=None))
    item = admin.call(path, "PUT", dict(item, title="不应定时公开的新草稿"))
    for _ in range(45):
        item = admin.call(path)
        if item["published"]:
            break
        time.sleep(1)
    assert item["published"], "scheduler did not publish"
    assert guest.call("public/contents/acceptance-post")["title"] == "历史正文"
    assert item["title"] == "不应定时公开的新草稿"
    copied = admin.call("admin/contents/" + copied["id"] + "/publish", "POST", dict(version=copied["version"]))
    assert guest.call("public/contents/acceptance-post/discovery")["next"]["id"] == copied["id"]
    visit = dict(id=uuid.uuid4().hex, path="/posts/acceptance-post", referrer="", campaign="")
    guest.call("public/visits", "POST", visit)
    assert admin.call(path)["views"] == 1 and admin.call(path)["visitors"] == 1
    lead_id = uuid.uuid4().hex
    guest.call("public/leads", "POST", dict(id=lead_id, path="/posts/acceptance-post", name="=SUM(1)", contact="123456789", organization="客户单位", need="产品咨询", consent=True, visitId=visit["id"]))
    lead = admin.call("admin/leads")["items"][0]
    follow = dict(status="following", notes="首次沟通", version=lead["version"], ownerId=owner["id"], nextContactAt=(datetime.now(timezone.utc) + timedelta(seconds=2)).isoformat())
    lead = admin.call("admin/leads/" + lead_id, "PUT", follow)
    admin.call("admin/leads/" + lead_id, "PUT", follow, expected=409)
    assert admin.call("admin/leads/" + lead_id + "/followups")["total"] == 1
    time.sleep(3)
    assert admin.call("admin/leads/overdue-count") == 1
    assert admin.call("admin/leads?overdue=true&owner=" + owner["id"])["total"] == 1
    csv = admin.call("admin/leads/export").decode("utf-8-sig")
    assert "'=SUM(1)" in csv and "首次沟通" in csv
    guest.call("admin/leads/export", expected=401)
    guest.call("admin/maintenance/download", expected=401)
    assert admin.call("admin/assets?q=" + quote("历史引用") + "&type=image")["total"] == 1
    # Copied content can only be purged after being moved to the recycle bin.
    admin.call("admin/contents/" + copied["id"] + "/purge", "DELETE", dict(version=copied["version"]), expected=400)
    admin.call("admin/contents/" + copied["id"], "DELETE", dict(version=copied["version"]))
    copied = next(x for x in admin.call("admin/contents?status=trash")["items"] if x["id"] == copied["id"])
    admin.call("admin/contents/" + copied["id"] + "/purge", "DELETE", dict(version=copied["version"]))
    assert admin.call("admin/contents?status=trash")["total"] == 0
    return item, asset, image


def main():
    kinds = ["Sqlite", "PostgreSQL", "MySql", "SqlServer"] if "all" in sys.argv else [sys.argv[1] if len(sys.argv) > 1 else "Sqlite"]
    owned, results = [], {}
    try:
        for kind in kinds:
            print("DATABASE:", kind, flush=True)
            password = "Check!" + secrets.token_hex(18)
            env = dict(os.environ, Database__Type=kind, Database__ConnectionString=matrix.database(kind, password, owned),
                Setup__Username="checkadmin", Setup__Password=password, ASPNETCORE_ENVIRONMENT="Development", Consul__Enabled="false",
                Urls=f"http://127.0.0.1:{matrix.port()}", Security__KeyPath=str(matrix.LOCAL / kind / "keys"), Storage__Path=str(matrix.LOCAL / kind / "uploads"),
                Maintenance__BackupPath=str(matrix.LOCAL / kind / "backups"), Maintenance__BackupIntervalHours="0", Maintenance__TrafficRetentionDays="0")
            matrix.command(["dotnet", str(matrix.CHECKS), "--create-v8"], env)
            matrix.command(["dotnet", str(matrix.API), "--initialize"], env)
            matrix.command(["dotnet", str(matrix.API), "--migrate"], env)
            matrix.command(["dotnet", str(matrix.CHECKS), "--verify-v8-upgrade"], env)
            with (matrix.ARTIFACTS / (kind + "-editorial.log")).open("w", encoding="utf-8") as log:
                process = matrix.start(env, log)
                try:
                    admin, guest = Client(env["Urls"]), Client(env["Urls"], {"User-Agent": "Mozilla/5.0"})
                    owner = admin.login("checkadmin", password)
                    if kind == "Sqlite":
                        (matrix.ROOT / "docs/openapi.json").write_text(json.dumps(admin.call("/openapi/v1.json"), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                    item, asset, image = check(admin, guest, owner)
                    status = admin.call("admin/maintenance/backup", "POST")
                    assert status["state"]["lastSuccessAt"] and not status["state"]["error"]
                    archive = matrix.LOCAL / kind / "snapshot.zip"
                    archive.write_bytes(admin.call("admin/maintenance/download"))
                finally:
                    matrix.stop(process)
                maintenance_env = dict(env, CMS_TEST_MAINTENANCE_ROOT=str(matrix.LOCAL / kind / "maintenance-check"))
                matrix.command(["dotnet", str(matrix.CHECKS), "--editorial-maintenance"], maintenance_env)
                # A portable snapshot produced by every provider must restore into a separate SQLite database.
                restore_env = dict(env, Database__Type="Sqlite", Database__ConnectionString="Data Source=" + str(matrix.LOCAL / kind / "restored.db"),
                    Security__KeyPath=str(matrix.LOCAL / kind / "restored-keys"), Storage__Path=str(matrix.LOCAL / kind / "restored-uploads"))
                damaged = matrix.LOCAL / kind / "damaged.zip"
                with zipfile.ZipFile(archive) as source, zipfile.ZipFile(damaged, "w") as target:
                    for entry in source.infolist():
                        payload = source.read(entry.filename)
                        target.writestr(entry.filename, payload + b" " if entry.filename == "database/Content.json" else payload)
                try:
                    matrix.command(["dotnet", str(matrix.API), "--restore=" + str(damaged)], restore_env)
                    raise AssertionError("Corrupt archive accepted")
                except RuntimeError as error:
                    assert "InvalidDataException" in str(error)
                matrix.command(["dotnet", str(matrix.API), "--restore=" + str(archive)], restore_env)
                try:
                    matrix.command(["dotnet", str(matrix.API), "--restore=" + str(archive)], restore_env)
                    raise AssertionError("Nonempty restore target accepted")
                except RuntimeError as error:
                    assert "InvalidOperationException" in str(error)
                process = matrix.start(restore_env, log)
                try:
                    restored = Client(restore_env["Urls"])
                    restored.login("checkadmin", password)
                    assert restored.call("admin/contents/" + item["id"])["html"] == item["html"]
                    assert restored.call("/media/" + asset["id"]) == image
                    assert restored.call("admin/leads")["total"] == 1
                    assert restored.call("admin/contents/" + item["id"] + "/revisions")["total"] > 3
                finally:
                    matrix.stop(process)
            results[kind] = "PASS: v8 migration, history, trash, CAS, batches, search, schedule, follow-ups, CSV, backup integrity/restore, failure status, retention and scheduled backup interval"
            print(results[kind], flush=True)
    finally:
        for name in owned:
            matrix.command(["docker", "rm", "-f", name])
        (matrix.ARTIFACTS / "editorial-results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        print("Artifacts:", matrix.ARTIFACTS, flush=True)


if __name__ == "__main__":
    main()
