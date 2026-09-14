"""Settings behavior against an isolated matrix server with a fresh comment rate window."""
import base64
import concurrent.futures


def check_settings(admin, editor, guest, passed):
    original = admin.call("admin/settings")
    def save(**changes):
        return admin.call("admin/settings", "PUT", dict(admin.call("admin/settings"), **changes))
    guest.call("admin/settings", expected=401)
    editor.call("admin/settings", expected=403)
    editor.call("admin/settings", "PUT", original, expected=403)
    admin.call("admin/settings", "PUT", original, csrf=False, expected=400)
    audit = admin.call("admin/audit")["total"]
    invalid = [dict(title=""), dict(subtitle="长" * 101), dict(footerText="<script>bad</script>"), dict(footerText="文" * 501), dict(description=None), dict(language="xx"), dict(homePageSize=0), dict(categoryPageSize=51), dict(tagPageSize=-1), dict(searchPageSize=2.5), dict(version=-1), dict(faviconId="missing")]
    for patch in invalid:
        admin.call("admin/settings", "PUT", dict(original, **patch), expected=400)
    assert admin.call("admin/settings") == original and admin.call("admin/audit")["total"] == audit
    passed("settings administrator permissions, CSRF, plain text, assets and bounded values reject without mutation")

    png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII=")
    icon = admin.upload("settings-icon.png", png)
    guest.call("/media/" + icon["id"], expected=404)
    configured = dict(subtitle="持久化副标题 🎉", faviconId=icon["id"], language="en", homePageSize=1, categoryPageSize=2, tagPageSize=3, searchPageSize=4, footerText="版权信息\n纯文本页脚", blockSearchEngines=True)
    state = save(**configured)
    assert all(guest.call("public/settings")[k] == v for k, v in configured.items())
    assert guest.call("/media/" + icon["id"]) == png
    admin.call("admin/assets/" + icon["id"], "DELETE", expected=409)
    for route, size in [("", 1), ("?categoryId=missing", 2), ("?tagId=missing", 3), ("?search=true", 4)]:
        assert guest.call("public/contents" + route)["pageSize"] == size
    assert len(guest.call("public/contents")["items"]) == 1
    assert guest.call("public/contents?page=2")["items"][0]["id"] != guest.call("public/contents?page=1")["items"][0]["id"]
    assert guest.call("public/contents?pageSize=2")["pageSize"] == 2
    passed("site identity, icon visibility and reference protection, four list sizes and public settings take effect")

    admin.call("admin/settings", "PUT", original, expected=409)
    def concurrent_save(label):
        try:
            admin.call("admin/settings", "PUT", dict(state, subtitle=label))
            return "saved"
        except AssertionError as e:
            assert "got 409" in str(e), str(e)
            return "conflict"
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(concurrent_save, ["管理员甲", "管理员乙"])) == ["conflict", "saved"]
    events = admin.call("admin/audit")["items"]
    assert any(x["action"] == "settings.save" and x["targetId"] == "site" and x["targetName"] == original["title"] for x in events)
    passed("concurrent settings saves accept one revision, stale updates conflict and successful writes identify the site")

    content = admin.call("public/contents?kind=page")["items"][0]
    payload = dict(contentId=content["id"], author="访客", body="设置评论验证")
    save(commentsEnabled=True, requireCommentApproval=True, commentsRequireLogin=False)
    pending = guest.call("public/comments", "POST", payload)
    assert not pending["approved"]
    save(commentsRequireLogin=True, requireCommentApproval=False)
    assert guest.call("public/comments", "POST", payload, expected=401)["code"] == "COMMENT_LOGIN_REQUIRED"
    signed = editor.call("public/comments", "POST", dict(payload, author="冒名"))
    assert signed["approved"] and signed["author"] == editor.call("auth/me")["displayName"]
    assert pending["id"] not in {x["id"] for x in guest.call("public/comments?contentId=" + content["id"])["items"]}
    save(commentsEnabled=False)
    assert guest.call("public/comments", "POST", payload, expected=403)["code"] == "COMMENTS_DISABLED"
    assert guest.call("public/comments?contentId=" + content["id"])["total"] == 0
    assert any(x["id"] == signed["id"] for x in admin.call("admin/comments")["items"])
    save(commentsEnabled=True, commentsRequireLogin=False)
    immediate = guest.call("public/comments", "POST", payload)
    assert immediate["approved"]
    assert guest.call("public/comments?contentId=" + content["id"])["total"] == 2
    passed("comments enablement, moderation, existing-account-only submission and independent-page comments are enforced server-side")
    # Leave non-default fields to verify exact persistence and restoration in the runner.
    save(**configured, commentsEnabled=True, requireCommentApproval=True, commentsRequireLogin=False)
