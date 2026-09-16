"""Page composition, publication and exact v9 upgrade checks on explicitly isolated databases."""
import base64
import copy
import json
import hashlib
import io
import os
import secrets
import sys
import uuid
import zipfile

os.environ.setdefault("CMS_TEST_CONFIGURATION", "Release")
import run_matrix as matrix
from integration import Client


def block(kind="hero", **values):
    return dict(id=uuid.uuid4().hex, type=kind, title="模板首屏", **values)


def previous_archive(raw):
    """Reproduce the v9 archive shape from the untouched legacy fixture, with valid integrity hashes."""
    with zipfile.ZipFile(io.BytesIO(raw)) as source:
        payloads = {name: source.read(name) for name in source.namelist() if name != "manifest.json"}
        manifest = json.loads(source.read("manifest.json"))
    for table in ["NotificationDelivery", "NotificationState", "ContentRedirect", "InquiryFormSettings"]:
        payloads.pop("database/" + table + ".json", None)
    for name, field in [("Content", "FieldsJson"), ("CustomerLead", "FieldsJson"), ("Asset", "Group"), ("Asset", "Version"), ("Content", "DraftSlug"), ("Content", "SeoJson"), ("Content", "LayoutJson"), ("SiteSettings", "HomePageId")]:
        key = "database/" + name + ".json"
        rows = json.loads(payloads[key])
        for row in rows:
            row.pop(field, None)
        payloads[key] = json.dumps(rows, ensure_ascii=False).encode("utf-8")
    schema = json.loads(payloads["database/SchemaVersion.json"])
    schema[0]["Version"] = 9
    payloads["database/SchemaVersion.json"] = json.dumps(schema).encode("utf-8")
    manifest["Schema"] = 9
    manifest["Sha256"] = {name: hashlib.sha256(value).hexdigest().upper() for name, value in payloads.items()}
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        for name, value in payloads.items():
            archive.writestr(name, value)
        archive.writestr("manifest.json", json.dumps(manifest))
    return output.getvalue()


def check(admin, guest):
    old = admin.call("admin/contents/" + "9" * 32)
    assert old["version"] == 7 and old["html"] == "<p>原有正文</p>" and old["layout"] is None
    assert guest.call("public/home") is None
    image = admin.upload("模板图片.png", base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII="))
    category = admin.call("admin/taxonomy", "POST", dict(kind="category", name="模块分类", slug="layout-category"))
    layout = dict(blocks=[block(imageId=image["id"], imageAlt="真实图片说明"), block("text", text="隐藏的独有内容", hidden=True),
                          block("posts", categoryId=category["id"], limit=3)])
    data = dict(kind="template", slug="reusable-layout", title="企业模板", summary="复用布局", html="", coverId="", categoryId="", tagIds=[], version=0, layout=layout)
    template = admin.call("admin/contents", "POST", data)
    path = "admin/contents/" + template["id"]
    first = admin.call(path + "/revisions")["items"][0]
    guest.call("/media/" + image["id"], expected=404)
    admin.call("admin/templates/" + template["id"], expected=404)
    template = admin.call(path + "/publish", "POST", dict(version=template["version"]))
    published = admin.call("admin/templates/" + template["id"])
    assert len(published["layout"]["blocks"]) == 2 and "隐藏的独有内容" not in json.dumps(published, ensure_ascii=False)
    guest.call("public/contents/reusable-layout", expected=404)
    guest.call("public/contents/reusable-layout/discovery", expected=404)
    guest.call("public/contents?kind=template", expected=400)
    guest.call("/media/" + image["id"], expected=404)
    assert not any(x["id"] == template["id"] for x in guest.call("public/sitemap"))
    assert admin.call("admin/contents?kind=template&status=published")["total"] == 1
    admin.call("admin/assets/" + image["id"], "DELETE", expected=409)
    admin.call("admin/taxonomy/" + category["id"], "DELETE", expected=409)
    guest.call("admin/templates/" + template["id"], expected=401)
    page = admin.call("admin/contents", "POST", dict(data, kind="page", slug="layout-home", title="自定义首页", layout=published["layout"]))
    pagepath = "admin/contents/" + page["id"]
    settings = admin.call("admin/settings")
    admin.call("admin/settings", "PUT", dict(settings, homePageId=page["id"]), expected=400)
    page = admin.call(pagepath + "/publish", "POST", dict(version=page["version"]))
    settings = admin.call("admin/settings", "PUT", dict(settings, homePageId=page["id"]))
    assert guest.call("public/home")["id"] == page["id"]
    guest.call("public/visits", "POST", dict(id=uuid.uuid4().hex, path="/", referrer="", campaign="builder"))
    assert admin.call(pagepath)["views"] == 1
    assert guest.call("/media/" + image["id"])
    changed = copy.deepcopy(template)
    changed["layout"]["blocks"][0]["title"] = "下一版模板"
    template = admin.call(path, "PUT", changed)
    assert admin.call("admin/templates/" + template["id"])["layout"]["blocks"][0]["title"] == "模板首屏"
    assert guest.call("public/home")["layout"]["blocks"][0]["title"] == "模板首屏"
    template = admin.call(path + "/publish", "POST", dict(version=template["version"]))
    assert guest.call("public/home")["layout"]["blocks"][0]["title"] == "模板首屏"
    template = admin.call(path + "/revisions/" + first["id"] + "/restore", "POST", dict(version=template["version"]))
    assert template["layout"]["blocks"][0]["title"] == "模板首屏"
    assert admin.call("admin/templates/" + template["id"])["layout"]["blocks"][0]["title"] == "下一版模板"
    admin.call(path, "PUT", dict(template, version=1), expected=409)
    rich = copy.deepcopy(template)
    rich["layout"]["blocks"][0].update(html='<p><strong>模块富文本</strong><img src="/media/' + image["id"] + '" onerror="alert(1)"></p><script>alert(1)</script>',
        mobile=dict(align="center", spacing="large", columns=2, textSize="large", hidden=True))
    rich_saved = admin.call(path, "PUT", rich)
    assert "<strong>模块富文本</strong>" in rich_saved["layout"]["blocks"][0]["html"]
    assert "onerror" not in rich_saved["layout"]["blocks"][0]["html"] and "<script" not in rich_saved["layout"]["blocks"][0]["html"]
    assert rich_saved["layout"]["blocks"][0]["mobile"]["hidden"] is True
    template = admin.call(path, "PUT", dict(template, version=rich_saved["version"]))
    for bad in [dict(blocks=None), dict(blocks=[None]), dict(blocks=[block(linkUrl="javascript:alert(1)")]),
                dict(blocks=[block(linkUrl="//evil.example")]), dict(blocks=[block(imageId="missing")]),
                dict(blocks=[block("unknown")]), dict(blocks=[block(text="<script>1</script>")]),
                dict(blocks=[block("contact"), block("contact")]), dict(blocks=[block()] * 41),
                dict(blocks=[block(mobile=dict(columns=3))]), dict(blocks=[block(mobile=dict(align="position:absolute"))]),
                dict(blocks=[block(html="x" * 50001)]), dict(blocks=[block(html='<img src="https://example.com/remote.png">')])]:
        admin.call(path, "PUT", dict(template, layout=bad), expected=400)
        assert admin.call(path)["version"] == template["version"]
    admin.call(pagepath, "DELETE", dict(version=page["version"]), expected=409)
    page = admin.call(pagepath + "/unpublish", "POST", dict(version=page["version"]))
    assert guest.call("public/home") is None
    guest.call("/media/" + image["id"], expected=404)
    page = admin.call(pagepath + "/publish", "POST", dict(version=page["version"]))
    copied = admin.call(path + "/duplicate", "POST")
    assert copied["layout"] == template["layout"] and not copied["published"]
    admin.call(path, "DELETE", dict(version=template["version"]))
    recycled = next(x for x in admin.call("admin/contents?kind=template&status=trash")["items"] if x["id"] == template["id"])
    admin.call(path + "/restore", "POST", dict(version=recycled["version"]))
    assert admin.call(path)["layout"] == template["layout"]
    return page


def main():
    kinds = ["Sqlite", "PostgreSQL", "MySql", "SqlServer"] if "all" in sys.argv else [sys.argv[1] if len(sys.argv) > 1 else "Sqlite"]
    owned, results = [], {}
    try:
        for kind in kinds:
            print("DATABASE:", kind, flush=True)
            password = "Builder!" + secrets.token_hex(18)
            env = dict(os.environ, Database__Type=kind, Database__ConnectionString=matrix.database(kind, password, owned),
                Setup__Username="checkadmin", Setup__Password=password, ASPNETCORE_ENVIRONMENT="Development", Consul__Enabled="false",
                Urls=f"http://127.0.0.1:{matrix.port()}", Security__KeyPath=str(matrix.LOCAL / kind / "keys"), Storage__Path=str(matrix.LOCAL / kind / "uploads"),
                Maintenance__BackupPath=str(matrix.LOCAL / kind / "backups"), Maintenance__BackupIntervalHours="0", Maintenance__TrafficRetentionDays="0")
            matrix.command(["dotnet", str(matrix.CHECKS), "--create-v9"], env)
            matrix.command(["dotnet", str(matrix.API), "--initialize"], env)
            matrix.command(["dotnet", str(matrix.API), "--migrate"], env)
            with (matrix.ARTIFACTS / (kind + "-builder.log")).open("w", encoding="utf-8") as log:
                process = matrix.start(env, log)
                try:
                    admin, guest = Client(env["Urls"]), Client(env["Urls"], {"User-Agent": "Mozilla/5.0"})
                    admin.login("checkadmin", password)
                    if kind == "Sqlite":
                        (matrix.ROOT / "docs/openapi.json").write_text(json.dumps(admin.call("/openapi/v1.json"), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                        admin.call("admin/maintenance/backup", "POST")
                        (matrix.LOCAL / kind / "previous-v9.zip").write_bytes(previous_archive(admin.call("admin/maintenance/download")))
                    page = check(admin, guest)
                    admin.call("admin/maintenance/backup", "POST")
                    archive = matrix.LOCAL / kind / "layout-snapshot.zip"
                    archive.write_bytes(admin.call("admin/maintenance/download"))
                finally:
                    matrix.stop(process)
                if kind == "Sqlite":
                    previous = dict(env, Database__ConnectionString="Data Source=" + str(matrix.LOCAL / kind / "previous-restored.db"),
                        Security__KeyPath=str(matrix.LOCAL / kind / "previous-keys"), Storage__Path=str(matrix.LOCAL / kind / "previous-uploads"))
                    matrix.command(["dotnet", str(matrix.API), "--restore=" + str(matrix.LOCAL / kind / "previous-v9.zip")], previous)
                    process = matrix.start(previous, log)
                    try:
                        assert Client(previous["Urls"]).call("public/contents/before-builder")["html"] == "<p>原有正文</p>"
                    finally:
                        matrix.stop(process)
                restored = dict(env, Database__Type="Sqlite", Database__ConnectionString="Data Source=" + str(matrix.LOCAL / kind / "restored.db"),
                    Security__KeyPath=str(matrix.LOCAL / kind / "restored-keys"), Storage__Path=str(matrix.LOCAL / kind / "restored-uploads"))
                matrix.command(["dotnet", str(matrix.API), "--restore=" + str(archive)], restored)
                process = matrix.start(restored, log)
                try:
                    assert Client(restored["Urls"]).call("public/home")["layout"] == page["layout"]
                    for expected in page.get("_verify_after_restore", []):
                        assert Client(restored["Urls"]).call("public/contents/" + expected["slug"]) == expected
                    if page.get("_verify_admin_after_restore"):
                        restored_admin = Client(restored["Urls"])
                        restored_admin.login("checkadmin", password)
                        for path, expected in page["_verify_admin_after_restore"].items():
                            assert restored_admin.call(path) == expected, path
                finally:
                    matrix.stop(process)
            results[kind] = "passed: v9 upgrade, validation, public isolation, homepage, independent template copies, revisions, recycle, references and backup restore"
            print(results[kind], flush=True)
    finally:
        for name in owned:
            matrix.command(["docker", "rm", "-f", name])
        (matrix.ARTIFACTS / "page-builder-results.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
        print("Artifacts:", matrix.ARTIFACTS, flush=True)


if __name__ == "__main__":
    main()
