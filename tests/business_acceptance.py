"""Product/case fields, inquiry definitions, private exports and attachment metadata on real providers."""
import base64
import copy
import csv
import io
import json
import uuid
from urllib.parse import quote
import page_builder_acceptance as builder

base_check = builder.check


def check(admin, guest):
    home = base_check(admin, guest)
    raw = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII=")
    asset = admin.upload("before.png", raw)
    path = "admin/assets/" + asset["id"]
    renamed = admin.call(path, "PUT", dict(name="产品图.png", group="产品素材", version=asset["version"]))
    assert renamed["url"] == asset["url"] and admin.call(asset["url"]) == raw
    assert "产品素材" in admin.call("admin/assets/groups")
    assert admin.call("admin/assets?group=" + quote("产品素材"))["total"] == 1
    assert admin.call("admin/assets?q=" + quote("产品图"))["items"][0]["id"] == asset["id"]
    admin.call(path, "PUT", dict(name="旧值.png", group="", version=asset["version"]), expected=409)
    for name, group in [("../bad.png", ""), ("other.pdf", ""), ("fine.png", "x" * 81)]:
        admin.call(path, "PUT", dict(name=name, group=group, version=renamed["version"]), expected=400)
    products = []
    for kind, route in [("product", "products"), ("case", "cases")]:
        data = dict(kind=kind, slug="business-" + kind, title="产品标题" if kind == "product" else "案例标题", summary="业务介绍", html="<p>业务正文</p>",
                    coverId=asset["id"], categoryId="", tagIds=[], version=0, fields=[dict(key="model", label="型号" if kind == "product" else "行业", value="检索业务参数")])
        content = admin.call("admin/contents", "POST", data)
        cpath = "admin/contents/" + content["id"]
        guest.call("public/contents/" + content["slug"], expected=404)
        content = admin.call(cpath + "/publish", "POST", dict(version=content["version"]))
        first = admin.call(cpath + "/revisions")["items"][0]
        assert guest.call(f"public/contents?kind={kind}&q=" + quote("检索业务参数"))["total"] == 1
        target = next(x for x in admin.call("admin/menu/targets?type=" + kind)["items"] if x["id"] == content["id"])
        assert target["url"] == "/" + route + "/" + content["slug"]
        menu = admin.call("admin/menu", "POST", dict(type=kind, targetId=content["id"], label="", url="", sort=0))
        assert any(x["url"] == target["url"] for x in guest.call("public/menu"))
        content = admin.call(cpath, "PUT", dict(content, fields=[dict(key="model", label="新字段名称", value="未公开字段")]))
        assert guest.call("public/contents/" + content["slug"])["fields"][0]["value"] == "检索业务参数"
        content = admin.call(cpath + "/revisions/" + first["id"] + "/restore", "POST", dict(version=content["version"]))
        assert content["fields"][0]["value"] == "检索业务参数"
        for fields in [[dict(key="bad key", label="名称", value="")], [dict(key="model", label="", value="")],
                       [dict(key="model", label="名称", value="x" * 2001)], content["fields"] * 2]:
            admin.call(cpath, "PUT", dict(content, fields=fields), expected=400)
            assert admin.call(cpath)["version"] == content["version"]
        admin.call("admin/assets/" + asset["id"], "DELETE", expected=409)
        products.append(guest.call("public/contents/" + content["slug"]))
    form = admin.call("admin/inquiry-form")
    assert [x["key"] for x in form["fields"]] == ["product", "budget", "appointment"]
    definitions = [dict(key="segment", label="客户类型", type="select", required=True, options=["企业", "学校"]),
        dict(key="appointment", label="预约日期", type="date"), dict(key="estimate", label="预算数额", type="number"),
        dict(key="detail", label="补充要求", type="textarea")]
    form = admin.call("admin/inquiry-form", "PUT", dict(version=form["version"], fields=definitions))
    assert guest.call("public/inquiry-form")["fields"] == form["fields"]
    guest.call("admin/inquiry-form", expected=401)
    for fields in [definitions * 2, [dict(key="ok", label="名称", type="script")], [dict(key="ok", label="选择", type="select", options=[])]]:
        admin.call("admin/inquiry-form", "PUT", dict(form, fields=fields), expected=400)
        assert admin.call("admin/inquiry-form")["version"] == form["version"]
    admin.call("admin/inquiry-form", "PUT", dict(form, version=0), expected=409)
    lead = dict(id=uuid.uuid4().hex, path="/products/business-product", name="验收客户", contact="local-only", organization="测试机构", need="产品咨询", consent=True)
    for index, (fields, status) in enumerate([({}, 400), ({"segment": "个人"}, 400), ({"segment": "企业", "appointment": "2026-02-30"}, 400),
                           ({"segment": "企业", "estimate": "NaN"}, 400), ({"segment": "企业", "unknown": "value"}, 409)]):
        # Isolated trusted-loopback proxy: separate clients keep validation checks outside the existing IP throttle.
        guest.headers["X-Forwarded-For"] = f"192.0.2.{index + 1}"
        guest.call("public/leads", "POST", dict(lead, fields=fields), expected=status)
    guest.headers["X-Forwarded-For"] = "192.0.2.100"
    assert admin.call("admin/leads")["total"] == 0
    values = dict(segment="企业", appointment="2026-10-01", estimate="12.5", detail="=1+1")
    submitted = guest.call("public/leads", "POST", dict(lead, fields=values))
    assert submitted == dict(id=lead["id"])
    private = admin.call("admin/leads")["items"][0]
    assert private["contentId"] == products[0]["id"]
    assert json.loads(private["fieldsJson"])[0]["Label"] == "客户类型"
    guest.call("public/leads", "POST", dict(lead, fields=values))
    guest.call("public/leads", "POST", dict(lead, fields=dict(values, detail="changed")), expected=409)
    assert admin.call("admin/leads")["total"] == 1
    form = admin.call("admin/inquiry-form", "PUT", dict(form, fields=[dict(definitions[0], label="服务对象")]))
    guest.call("public/leads", "POST", dict(lead, fields=values))  # Idempotent old submission survives definition changes.
    exported = list(csv.reader(io.StringIO(admin.call("admin/leads/export").decode("utf-8-sig"))))
    assert "客户类型 [segment]" in exported[0] and "补充要求 [detail]" in exported[0]
    assert "'=1+1" in exported[1]
    home["_verify_after_restore"] = products
    home["_verify_admin_after_restore"] = {path: admin.call(path) for path in ["admin/inquiry-form", "admin/leads",
        "admin/leads/export", "admin/assets?group=" + quote("产品素材"), asset["url"]]}
    print("PASS: metadata grouping/version/bytes, product/case publish/history/menu/search, form validation/idempotency/private CSV", flush=True)
    return home


if __name__ == "__main__":
    builder.check = check
    builder.main()
