"""Reuse isolated upgrade/backup fixtures to check shared blocks end to end on all providers."""
import base64
import copy
import uuid
from urllib.parse import quote
from datetime import datetime, timedelta, timezone
import page_builder_acceptance as builder


base_check = builder.check


def check(admin, guest):
    base_check(admin, guest)
    image = admin.upload("公共区块.png", base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII="))
    data = dict(kind="block", slug="shared-footer", title="咨询公共区块", summary="", html="", coverId="", categoryId="", tagIds=[], version=0,
                layout=dict(blocks=[builder.block("image", imageId=image["id"], text="共享原文")]))
    shared = admin.call("admin/contents", "POST", data)
    path = "admin/contents/" + shared["id"]
    first = admin.call(path + "/revisions")["items"][0]
    ref = builder.block("shared", sharedId=shared["id"])
    payload = dict(data, kind="page", slug="synchronized-page", title="同步页面", layout=dict(blocks=[ref]))
    admin.call("admin/contents", "POST", payload, expected=409)
    shared = admin.call(path + "/publish", "POST", dict(version=shared["version"]))
    guest.call("/media/" + image["id"], expected=404)
    guest.call("public/contents/shared-footer", expected=404)
    guest.call("public/contents/shared-footer/discovery", expected=404)
    guest.call("public/contents?kind=block", expected=400)
    guest.call("admin/blocks/" + shared["id"], expected=401)
    assert not any(x["id"] == shared["id"] for x in guest.call("public/sitemap"))
    nested = dict(shared, layout=dict(blocks=[ref]))
    admin.call(path, "PUT", nested, expected=400)
    assert admin.call(path)["version"] == shared["version"]
    page = admin.call("admin/contents", "POST", payload)
    ppath = "admin/contents/" + page["id"]
    page = admin.call(ppath + "/publish", "POST", dict(version=page["version"]))
    copy_page = admin.call("admin/contents", "POST", dict(payload, slug="independent-page", layout=shared["layout"]))
    copy_path = "admin/contents/" + copy_page["id"]
    admin.call(copy_path + "/publish", "POST", dict(version=copy_page["version"]))
    assert guest.call("/media/" + image["id"])
    expanded = guest.call("public/contents/synchronized-page")
    assert expanded["layout"]["blocks"][0]["type"] == "image" and "共享原文" in expanded["html"]
    assert admin.call(ppath)["layout"]["blocks"][0]["sharedId"] == shared["id"]
    preview = admin.call("admin/layout-preview", "POST", dict(blocks=[ref, dict(ref, id=uuid.uuid4().hex)]))
    assert len({x["id"] for x in preview["blocks"]}) == 2
    for route, method, body in [(path + "/unpublish", "POST", dict(version=shared["version"])),
        (path, "DELETE", dict(version=shared["version"])),
        ("admin/contents/batch", "POST", dict(action="unpublish", items=[dict(id=shared["id"], version=shared["version"])]))]:
        admin.call(route, method, body, expected=409)
        assert admin.call(path)["version"] == shared["version"]
    changed = copy.deepcopy(shared)
    changed["layout"]["blocks"][0].update(text="共享更新关键词", imageId="")
    shared = admin.call(path, "PUT", changed)
    assert "共享原文" in guest.call("public/contents/synchronized-page")["html"]
    assert "共享原文" in admin.call("admin/layout-preview", "POST", payload["layout"])["blocks"][0]["text"]
    shared = admin.call(path + "/publish", "POST", dict(version=shared["version"]))
    assert "共享更新关键词" in guest.call("public/contents/synchronized-page")["html"]
    assert "共享原文" in guest.call("public/contents/independent-page")["html"]
    assert guest.call("public/contents?kind=page&q=" + quote("共享更新关键词"))["total"] == 1
    assert admin.call(ppath)["version"] == page["version"]  # Derived search updates do not conflict with editors.
    independent = admin.call(copy_path)
    admin.call(copy_path + "/unpublish", "POST", dict(version=independent["version"]))
    guest.call("/media/" + image["id"], expected=404)  # Old materialized snapshot is not a live image reference.
    admin.call("admin/assets/" + image["id"], "DELETE", expected=409)  # History still protects the file.
    shared = admin.call(path + "/revisions/" + first["id"] + "/restore", "POST", dict(version=shared["version"]))
    assert "共享更新关键词" in guest.call("public/contents/synchronized-page")["html"]
    shared = admin.call(path + "/publish", "POST", dict(version=shared["version"]))
    assert "共享原文" in guest.call("public/contents/synchronized-page")["html"]
    # An incompatible block publication is rejected without changing the live pages.
    with_contact = dict(payload, slug="with-contact", layout=dict(blocks=[ref, builder.block("contact")]))
    contact_page = admin.call("admin/contents", "POST", with_contact)
    cpath = "admin/contents/" + contact_page["id"]
    contact_page = admin.call(cpath + "/publish", "POST", dict(version=contact_page["version"]))
    changed = dict(shared, layout=dict(blocks=[builder.block("contact")]))
    shared = admin.call(path, "PUT", changed)
    admin.call(path + "/publish", "POST", dict(version=shared["version"]), expected=400)
    assert "共享原文" in guest.call("public/contents/synchronized-page")["html"]
    contact_page = admin.call(cpath + "/unpublish", "POST", dict(version=contact_page["version"]))
    page = admin.call(ppath + "/unpublish", "POST", dict(version=page["version"]))
    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    page = admin.call(ppath + "/schedule", "PUT", dict(version=page["version"], publishAt=future))
    admin.call(path + "/unpublish", "POST", dict(version=shared["version"]), expected=409)
    page = admin.call(ppath + "/schedule", "PUT", dict(version=page["version"]))
    admin.call(path, "DELETE", dict(version=shared["version"]))
    trashed = next(x for x in admin.call("admin/contents?kind=block&status=trash")["items"] if x["id"] == shared["id"])
    admin.call(path + "/purge", "DELETE", dict(version=trashed["version"]), expected=409)
    admin.call(path + "/restore", "POST", dict(version=trashed["version"]))
    shared = admin.call(path)
    shared = admin.call(path + "/revisions/" + first["id"] + "/restore", "POST", dict(version=shared["version"]))
    admin.call(path + "/publish", "POST", dict(version=shared["version"]))
    page = admin.call(ppath + "/publish", "POST", dict(version=page["version"]))
    refs = admin.call("admin/blocks/" + shared["id"] + "/references")
    assert any(x["source"] == "公开页面" for x in refs) and any(x["source"] == "历史版本" for x in refs)
    settings = admin.call("admin/settings")
    admin.call("admin/settings", "PUT", dict(settings, homePageId=page["id"]))
    print("PASS: shared publication, copies, search, preview, cycles, references, history and media isolation", flush=True)
    return guest.call("public/home")  # Matrix verifies expanded blocks after restoring every provider's archive.


if __name__ == "__main__":
    builder.check = check
    builder.main()
