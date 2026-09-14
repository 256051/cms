"""Hierarchical navigation checks against the matrix's isolated database only."""
import concurrent.futures


def check_menus(admin, editor, guest, passed):
    template = dict(label="资源导航", url="#", sort=10, type="custom", parentId="", targetId="", openInNewTab=False, version=0)
    guest.call("admin/menu", expected=401)
    editor.call("admin/menu", expected=403)
    editor.call("admin/menu/targets?type=post", expected=403)
    editor.call("admin/menu", "POST", template, expected=403)
    admin.call("admin/menu", "POST", template, csrf=False, expected=400)
    for patch in [dict(type="script"), dict(url="javascript:alert(1)"), dict(url="//evil.example"), dict(url="/\\evil.example"), dict(parentId="missing"), dict(type="post", targetId="missing")]:
        admin.call("admin/menu", "POST", dict(template, **patch), expected=400)
    root = admin.call("admin/menu", "POST", template)
    child = admin.call("admin/menu", "POST", dict(template, label="二级导航", parentId=root["id"]))
    grandchild = admin.call("admin/menu", "POST", dict(template, label="三级导航", parentId=child["id"], openInNewTab=True))
    admin.call("admin/menu/" + root["id"], "PUT", dict(root, parentId=root["id"]), expected=400)
    admin.call("admin/menu/" + root["id"], "PUT", dict(root, parentId=grandchild["id"]), expected=400)
    admin.call("admin/menu/" + root["id"], "DELETE", expected=409)
    fourth = admin.call("admin/menu", "POST", dict(template, parentId=grandchild["id"]))
    fifth = admin.call("admin/menu", "POST", dict(template, parentId=fourth["id"]))
    admin.call("admin/menu", "POST", dict(template, parentId=fifth["id"]), expected=400)
    for row in [fifth, fourth]: admin.call("admin/menu/" + row["id"], "DELETE")
    passed("menu permissions, CSRF, safe links, parent existence, cycle and depth protection")

    content = dict(kind="post", slug="menu-resource-post", title="菜单文章中文", summary="", html="<p>导航资源</p>", coverId="", categoryId="", tagIds=[], version=0)
    post = admin.call("admin/contents", "POST", content)
    admin.call("admin/menu", "POST", dict(template, type="post", targetId=post["id"]), expected=400)
    assert all(x["id"] != post["id"] for x in admin.call("admin/menu/targets?type=post")["items"])
    post = admin.call(f'admin/contents/{post["id"]}/publish', "POST", dict(version=post["version"]))
    page = admin.call("admin/contents", "POST", dict(content, kind="page", slug="menu-resource-page"))
    page = admin.call(f'admin/contents/{page["id"]}/publish', "POST", dict(version=page["version"]))
    category = admin.call("admin/taxonomy", "POST", dict(kind="category", name="菜单分类", slug="menu-category"))
    tag = admin.call("admin/taxonomy", "POST", dict(kind="tag", name="菜单标签", slug="menu-tag"))
    links = []
    for kind, target, prefix in [("post", post, "posts"), ("page", page, "pages"), ("category", category, "category"), ("tag", tag, "tag")]:
        result = admin.call("admin/menu/targets?type=" + kind + "&q=%E8%8F%9C%E5%8D%95")
        assert any(x["id"] == target["id"] for x in result["items"])
        row = admin.call("admin/menu", "POST", dict(template, type=kind, targetId=target["id"], parentId=root["id"], label="不应信任的名称", url="https://wrong.example"))
        assert row["label"] == target.get("title", target.get("name")) and row["url"] == "/" + prefix + "/" + target["slug"]
        links.append(row)
    admin.call("admin/menu", "POST", dict(template, type="tag", targetId=category["id"]), expected=400)
    admin.call("admin/taxonomy/" + category["id"], "DELETE", expected=409)
    admin.call("admin/contents/" + post["id"], "DELETE", dict(version=post["version"]), expected=409)
    renamed = admin.call("admin/taxonomy/" + tag["id"], "PUT", dict(kind="tag", name="新标签名称", slug="menu-tag-new"))
    assert next(x for x in guest.call("public/menu") if x["id"] == links[3]["id"])["url"] == "/tag/" + renamed["slug"]
    assert next(x for x in guest.call("public/menu") if x["id"] == links[3]["id"])["label"] == renamed["name"]
    post = admin.call("admin/contents/" + post["id"], "PUT", dict(content, title="不应泄漏的草稿标题", version=post["version"]))
    assert next(x for x in guest.call("public/menu") if x["id"] == links[0]["id"])["label"] == content["title"]
    passed("five menu types, searchable targets, automatic names and URLs, reference protection and draft isolation")

    below = admin.call("admin/menu", "POST", dict(template, parentId=links[0]["id"], label="文章下的链接"))
    post = admin.call(f'admin/contents/{post["id"]}/unpublish', "POST", dict(version=post["version"]))
    assert not {links[0]["id"], below["id"]} & {x["id"] for x in guest.call("public/menu")}
    assert not next(x for x in admin.call("admin/menu") if x["id"] == links[0]["id"])["available"]
    post = admin.call(f'admin/contents/{post["id"]}/publish', "POST", dict(version=post["version"]))
    assert {links[0]["id"], below["id"]} <= {x["id"] for x in guest.call("public/menu")}
    moved = admin.call("admin/menu/" + grandchild["id"], "PUT", dict(grandchild, parentId=root["id"], sort=-1))
    assert moved["parentId"] == root["id"] and moved["openInNewTab"]
    admin.call("admin/menu/" + grandchild["id"], "PUT", grandchild, expected=409)
    admin.call(f'admin/menu/{grandchild["id"]}?version=0', "DELETE", expected=409)
    passed("unpublished menu branches hide and recover, hierarchy moves, sibling order and opening targets")

    def update(name):
        try:
            admin.call("admin/menu/" + child["id"], "PUT", dict(child, label=name))
            return "saved"
        except AssertionError as e:
            assert "got 409" in str(e)
            return "conflict"
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(update, ["菜单并发一", "菜单并发二"])) == ["conflict", "saved"]
    assert any(x["action"] == "menu.save" and x["targetId"] == child["id"] for x in admin.call("admin/audit")["items"])
    for row in [below, *links, moved]: admin.call("admin/menu/" + row["id"], "DELETE")
    for target in [post, page]: admin.call("admin/contents/" + target["id"], "DELETE", dict(version=target["version"]))
    for target in [category, tag]: admin.call("admin/taxonomy/" + target["id"], "DELETE")
    # Keep the root/child pair for restart and restore verification.
    passed("concurrent menu saves accept one version, audited writes and safe leaf deletion")
