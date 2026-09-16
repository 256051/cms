"""ZIP content round trips, trust boundaries and transaction rollback on disposable SQLite sites."""
import base64
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import sqlite3
import uuid
import zipfile

os.environ.setdefault("CMS_TEST_CONFIGURATION", "Release")
import run_matrix as matrix
from integration import Client


def upload_package(client, kind, raw, expected=200, csrf=True):
    boundary = "package" + uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\n{kind}\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="content.zip"\r\n'
            'Content-Type: application/zip\r\n\r\n').encode() + raw + f"\r\n--{boundary}--\r\n".encode()
    return client.call("admin/contents/import", "POST", raw=body, content_type="multipart/form-data; boundary=" + boundary,
                       expected=expected, csrf=csrf)


def unpack(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        return json.loads(archive.read("content.json")), {n: archive.read(n) for n in archive.namelist() if n != "content.json"}


def pack(manifest, files, extra=()):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("content.json", json.dumps(manifest, ensure_ascii=False))
        for name, data in list(files.items()) + list(extra): archive.writestr(name, data)
    return output.getvalue()


def snapshot(client, uploads):
    return ({kind: client.call("admin/contents?kind=" + kind)["total"] for kind in ["product", "case", "page"]},
            client.call("admin/assets")["total"], client.call("admin/taxonomy"), client.call("admin/audit")["total"],
            sorted(p.name for p in uploads.glob("*")))


def source_packages(admin):
    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII=")
    image = admin.upload("内容图片.png", png)
    hidden_image = admin.upload("隐藏模块图片.png", png + b"hidden-section")
    admin.call("admin/assets/" + image["id"], "PUT", dict(name=image["name"], group="页面素材", version=image["version"]))
    attachment = admin.upload("资料.pdf", b"%PDF-1.4\n%content-package\n%%EOF")
    category = admin.call("admin/taxonomy", "POST", dict(kind="category", name="产品分类", slug="transfer-category"))
    tag = admin.call("admin/taxonomy", "POST", dict(kind="tag", name="精选", slug="transfer-tag"))
    def draft(kind, slug, **changes):
        return dict(dict(kind=kind, slug=slug, title="导入导出 " + slug, summary="完整数据往返", version=0,
            html=f'<p>正文</p><img src="{image["url"]}"><a href="{attachment["url"]}">下载资料</a>', coverId=image["id"],
            categoryId=category["id"], tagIds=[tag["id"]], seo=dict(title="分享标题", description="分享描述", imageId=image["id"], noIndex=True),
            fields=[] if kind in ("page", "block") else [dict(key="model", label="型号", value="A-123")]), **changes)
    shared = admin.call("admin/contents", "POST", draft("block", "transfer-shared", layout=dict(blocks=[
        dict(id=uuid.uuid4().hex, type="hero", title="已发布公共区块", imageId=image["id"], mobile=dict(columns=1, hidden=True)),
        dict(id=uuid.uuid4().hex, type="image", title="未公开的区块模块", imageId=hidden_image["id"], hidden=True)])))
    shared = admin.call("admin/contents/" + shared["id"] + "/publish", "POST", dict(version=shared["version"]))
    admin.call("admin/contents/" + shared["id"], "PUT", dict(shared, layout=dict(blocks=[dict(id=uuid.uuid4().hex, type="text", text="不可泄露的区块草稿")]), version=shared["version"]))
    packages = {}
    for kind in ["product", "case", "page"]:
        layout = dict(version=1, width="narrow", showTitle=True, showHeader=False, showFooter=False, blocks=[
            dict(id=uuid.uuid4().hex, type="shared", sharedId=shared["id"]),
            dict(id=uuid.uuid4().hex, type="text", html=f'<p>布局正文</p><a href="{attachment["url"]}">附件</a>'),
            dict(id=uuid.uuid4().hex, type="image", imageId=hidden_image["id"], hidden=True),
            dict(id=uuid.uuid4().hex, type="posts", contentKind="product", categoryId=category["id"]),
            dict(id=uuid.uuid4().hex, type="cards", items=[dict(title="详情", text="图片地址：" + image["url"], imageId=image["id"], linkUrl="/products/transfer-product")])])
        first = admin.call("admin/contents", "POST", draft(kind, "transfer-" + kind, layout=layout))
        second = admin.call("admin/contents", "POST", draft(kind, "transfer-" + kind + "-second",
            html=f'<p>富文本往返</p><img src="{image["url"]}"><code>图片地址：{image["url"]}</code><a href="/{"products" if kind == "product" else "cases" if kind == "case" else "pages"}/{first["slug"]}?from=zip#detail">内部链接</a>'))
        admin.call("admin/contents/" + first["id"] + "/publish", "POST", dict(version=first["version"]))
        raw = admin.call("admin/contents/export", "POST", dict(kind=kind, ids=[first["id"], second["id"]]))
        manifest, files = unpack(raw)
        assert len(manifest["contents"]) == 2 and len(manifest["assets"]) == 3 and len(manifest["taxonomy"]) == 2
        assert "不可泄露的区块草稿" not in json.dumps(manifest, ensure_ascii=False)
        assert "未公开的区块模块" not in json.dumps(manifest, ensure_ascii=False)
        assert all(b["type"] != "shared" for b in manifest["contents"][0]["draft"]["layout"]["blocks"])
        for asset in manifest["assets"]: assert hashlib.sha256(files['assets/' + asset['id']]).hexdigest() == asset['sha256']
        selected = admin.call("admin/contents/export", "POST", dict(kind=kind, status="draft", q="-second", categoryId=category["id"], tagId=tag["id"]))
        assert len(unpack(selected)[0]["contents"]) == 1
        packages[kind] = raw
    return packages, image, attachment


def main():
    processes, logs = [], []
    try:
        clients, envs = [], []
        for name in ["source", "target"]:
            directory = matrix.LOCAL / name; directory.mkdir()
            password = "Transfer!" + secrets.token_hex(18)
            env = dict(os.environ, Database__Type="Sqlite", Database__ConnectionString="Data Source=" + str(directory / "cms.db"),
                Setup__Username="transferadmin", Setup__Password=password, ASPNETCORE_ENVIRONMENT="Development",
                Urls=f"http://127.0.0.1:{matrix.port()}", Security__KeyPath=str(directory / "keys"), Storage__Path=str(directory / "uploads"),
                Maintenance__BackupPath=str(directory / "backups"), Maintenance__BackupIntervalHours="0", Maintenance__TrafficRetentionDays="0", Consul__Enabled="false")
            matrix.command(["dotnet", str(matrix.API), "--initialize"], env)
            log = (matrix.ARTIFACTS / (name + ".log")).open("w", encoding="utf-8"); logs.append(log)
            processes.append(matrix.start(env, log))
            client = Client(env["Urls"]); client.login("transferadmin", password)
            clients.append(client); envs.append(env)
        source, target = clients
        packages, image, attachment = source_packages(source)
        guest = Client(envs[1]["Urls"])
        guest.call("admin/contents/export", "POST", dict(kind="product"), expected=401)
        upload_package(guest, "product", packages["product"], expected=401)
        target.call("admin/contents/export", "POST", dict(kind="product"), csrf=False, expected=400)
        upload_package(target, "product", packages["product"], csrf=False, expected=400)
        original = {}
        for kind, raw in packages.items():
            result = upload_package(target, kind, raw)
            assert len(result["items"]) == 2 and result["assets"] == 3 and result["renamed"] == 0
            rows = [target.call("admin/contents/" + x["id"]) for x in result["items"]]
            original[kind] = rows
            for row in rows:
                assert not row["published"] and row["publishedAt"] is None and row["scheduledPublishAt"] is None
                assert row["coverId"] != image["id"] and row["seo"]["imageId"] == row["coverId"]
                assert image["id"] not in row["html"]
                assert target.call("/media/" + row["coverId"]) == source.call(image["url"])
                guest.call("/media/" + row["coverId"], expected=404)
                assert target.call("admin/contents/" + row["id"] + "/revisions")["total"] == 1
            built = next(x for x in rows if x["layout"])
            assert built["layout"]["width"] == "narrow" and not built["layout"]["showHeader"]
            assert built["layout"]["blocks"][0]["mobile"]["hidden"] and built["layout"]["blocks"][2]["hidden"]
            assert target.call("/media/" + built["layout"]["blocks"][2]["imageId"]).endswith(b"hidden-section")
            assert next(x for x in built["layout"]["blocks"] if x["type"] == "posts")["categoryId"] == built["categoryId"]
            assert not built["fields"] if kind == "page" else built["fields"][0]["value"] == "A-123"
            again = upload_package(target, kind, raw)
            assert again["renamed"] == 2
            by_source = {x["sourceSlug"]: x for x in again["items"]}
            rich = target.call("admin/contents/" + by_source["transfer-" + kind + "-second"]["id"])
            assert by_source["transfer-" + kind]["slug"] + "?from=zip#detail" in rich["html"]
            assert [target.call("admin/contents/" + row["id"]) for row in rows] == rows
            assert len(target.call("admin/taxonomy")) == 2
        print("PASS: three kinds, filtered/selected exports, binary hashes, layouts/hidden/shared sections, taxonomy, SEO, internal links and clone-only imports", flush=True)
        uploads = Path(envs[1]["Storage__Path"])
        before = snapshot(target, uploads)
        manifest, files = unpack(packages["product"])
        invalid = []
        bad = copy.deepcopy(manifest); bad["assets"][0]["sha256"] = "0" * 64; invalid.append(pack(bad, files))
        bad = copy.deepcopy(manifest); bad["version"] = 99; invalid.append(pack(bad, files))
        bad = copy.deepcopy(manifest); bad["contents"][0]["draft"]["coverId"] = uuid.uuid4().hex; invalid.append(pack(bad, files))
        bad = copy.deepcopy(manifest); bad["contents"][0]["draft"]["layout"]["blocks"][0]["type"] = "script"; invalid.append(pack(bad, files))
        bad = copy.deepcopy(manifest); bad["assets"][0]["name"] = "../escape.png"; invalid.append(pack(bad, files))
        bad = copy.deepcopy(manifest); bad["contents"][1]["draft"]["title"] = None; invalid.append(pack(bad, files))
        bad = copy.deepcopy(manifest); bad["contents"][1]["draft"]["tagIds"] = [None]; invalid.append(pack(bad, files))
        bad = copy.deepcopy(manifest); fake_files = dict(files); asset = bad["assets"][0]
        fake_files["assets/" + asset["id"]] = b"<html><script>alert(1)</script></html>"
        asset["sha256"] = hashlib.sha256(fake_files["assets/" + asset["id"]]).hexdigest()
        invalid.append(pack(bad, fake_files))
        invalid.append(pack(manifest, files, [("assets/" + uuid.uuid4().hex, b"x" * (51 * 1024 * 1024))]))
        invalid += [b"not a ZIP", pack(manifest, {}), pack(manifest, files, [("../outside.txt", b"escape")]),
                    pack(manifest, files, [("assets/" + uuid.uuid4().hex, b"extra")]), pack(dict(manifest, taxonomy=None), files)]
        for raw in invalid:
            upload_package(target, "product", raw, expected=400)
            assert snapshot(target, uploads) == before
        upload_package(target, "case", packages["product"], expected=400)
        target.call("admin/contents/export", "POST", dict(kind="post"), expected=400)
        target.call("admin/contents/export", "POST", dict(kind="product", ids=[uuid.uuid4().hex]), expected=400)
        target.call("admin/contents/export", "POST", dict(kind="product", ids=[uuid.uuid4().hex] * 101), expected=400)
        target.call("admin/contents/export", "POST", dict(kind="product", status="trash"), expected=400)
        print("PASS: anonymous/CSRF/type/limit rejection and malformed, missing, corrupt or traversal packages leave no writes", flush=True)
        # Fault injection belongs only to this disposable database: fail after files and the first draft were written.
        database = matrix.LOCAL / "target/cms.db"
        bad = copy.deepcopy(manifest); bad["contents"][1]["draft"]["title"] = "rollback-probe"
        bad["taxonomy"][0]["name"] = "回滚时必须删除的新分类"
        with sqlite3.connect(database) as db:
            db.execute("CREATE TRIGGER transfer_fail BEFORE INSERT ON cms_content WHEN NEW.Title = 'rollback-probe' BEGIN SELECT RAISE(ABORT, 'transfer test fault'); END")
        try:
            upload_package(target, "product", pack(bad, files), expected=500)
            assert snapshot(target, uploads) == before
        finally:
            with sqlite3.connect(database) as db: db.execute("DROP TRIGGER transfer_fail")
        print("PASS: late database failure rolls back content, history, taxonomy, audits and every uploaded file", flush=True)
        editor_password = "Editor!" + secrets.token_hex(16)
        target.call("admin/users", "POST", dict(username="transfereditor", displayName="内容编辑", role="Editor", enabled=True, password=editor_password))
        editor = Client(envs[1]["Urls"]); editor.login("transfereditor", editor_password)
        assert upload_package(editor, "case", packages["case"])["renamed"] == 2
        assert len(unpack(editor.call("admin/contents/export", "POST", dict(kind="case")))[0]["contents"]) == 6
        (matrix.ROOT / "docs/openapi.json").write_text(json.dumps(target.call("/openapi/v1.json"), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        baseline = snapshot(target, uploads)
        matrix.stop(processes[1]); processes[1] = matrix.start(envs[1], logs[1])
        assert snapshot(target, uploads) == baseline
        for kind, rows in original.items():
            for row in rows: assert target.call("admin/contents/" + row["id"]) == row
        (matrix.ARTIFACTS / "content-transfer-results.json").write_text(json.dumps(dict(status="passed", cases=len(invalid), checks=[
            "three-kind ZIP round trips", "cross-site and duplicate imports", "shared/hidden/media/SEO/field references", "filters and limits",
            "authentication and CSRF", "malformed archives", "late failure atomic rollback", "editor permissions", "restart persistence"]), indent=2))
        print("PASS: editor permissions and restart persistence\nRESULTS:", matrix.ARTIFACTS, flush=True)
    finally:
        for process in processes: matrix.stop(process)
        for log in logs: log.close()


if __name__ == "__main__": main()
