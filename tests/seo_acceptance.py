"""SEO and URL changes through isolated real-provider APIs, preserving publication and backup semantics."""
import base64
from datetime import datetime, timedelta, timezone
import page_builder_acceptance as builder

base_check = builder.check


def check(admin, guest):
    home = base_check(admin, guest)
    image = admin.upload("分享图片.png", base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII="))
    data = dict(kind="page", slug="seo-original", title="可见标题", summary="可见摘要", html="<p>正文</p>", coverId="", categoryId="", tagIds=[], version=0,
                seo=dict(title="搜索标题", description="分享描述", imageId=image["id"], noIndex=True))
    page = admin.call("admin/contents", "POST", data)
    path = "admin/contents/" + page["id"]
    guest.call("/media/" + image["id"], expected=404)
    page = admin.call(path + "/publish", "POST", dict(version=page["version"]))
    assert guest.call("public/contents/seo-original")["seo"]["title"] == "搜索标题"
    assert guest.call("/media/" + image["id"])
    assert all(x["id"] != page["id"] for x in guest.call("public/sitemap"))
    first = admin.call(path + "/revisions")["items"][0]
    page = admin.call(path, "PUT", dict(page, slug="seo-next", seo=dict(title="新搜索标题", noIndex=False)))
    guest.call("public/contents/seo-next", expected=404)
    assert guest.call("public/contents/seo-original")["seo"]["title"] == "搜索标题"
    admin.call("admin/contents", "POST", dict(data, slug="seo-next"), expected=409)
    page = admin.call(path + "/publish", "POST", dict(version=page["version"]))
    assert guest.call("public/contents/seo-original")["slug"] == "seo-next"
    assert guest.call("public/contents/seo-next")["seo"]["title"] == "新搜索标题"
    assert any(x["id"] == page["id"] for x in guest.call("public/sitemap"))
    guest.call("/media/" + image["id"], expected=404)
    admin.call("admin/assets/" + image["id"], "DELETE", expected=409)
    admin.call("admin/contents", "POST", data, expected=409)  # Old published URL cannot be claimed.
    for slug in ["seo-third", "seo-original"]:
        page = admin.call(path, "PUT", dict(page, slug=slug))
        page = admin.call(path + "/publish", "POST", dict(version=page["version"]))
    for slug in ["seo-original", "seo-next", "seo-third"]:
        assert guest.call("public/contents/" + slug)["slug"] == "seo-original"
    page = admin.call(path + "/revisions/" + first["id"] + "/restore", "POST", dict(version=page["version"]))
    assert page["seo"]["imageId"] == image["id"] and page["slug"] == "seo-original"
    assert guest.call("public/contents/seo-original")["seo"]["title"] == "新搜索标题"
    page = admin.call(path, "PUT", dict(page, slug="scheduled-address"))
    page = admin.call(path + "/schedule", "PUT", dict(version=page["version"], publishAt=(datetime.now(timezone.utc) + timedelta(days=1)).isoformat()))
    page = admin.call(path, "PUT", dict(page, slug="later-draft"))
    admin.call("admin/contents", "POST", dict(data, slug="scheduled-address"), expected=409)
    page = admin.call(path + "/schedule", "PUT", dict(version=page["version"]))
    admin.call("admin/contents", "POST", dict(data, slug="scheduled-address"))
    for bad in [dict(title="x" * 201), dict(description="x" * 501), dict(imageId="missing"), dict(imageId="f" * 32)]:
        admin.call(path, "PUT", dict(page, seo=bad), expected=400)
        assert admin.call(path)["version"] == page["version"]
    page = admin.call(path + "/unpublish", "POST", dict(version=page["version"]))
    for slug in ["seo-original", "seo-next", "seo-third"]:
        guest.call("public/contents/" + slug, expected=404)
    # Leave a rename and SEO snapshot in the backup; the shared fixture checks restore into SQLite.
    admin.call(path + "/publish", "POST", dict(version=page["version"]))
    home["_verify_after_restore"] = [guest.call("public/contents/later-draft")]
    print("PASS: SEO media/noindex, URL draft isolation, direct aliases, reservation conflicts and history", flush=True)
    return home


if __name__ == "__main__":
    builder.check = check
    builder.main()
