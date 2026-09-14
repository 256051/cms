"""Theme contract checks, run only against the matrix's isolated database."""
import concurrent.futures
import json
import urllib.parse


def check_themes(admin, editor, guest, passed):
    before = admin.call("admin/themes")
    assert before["activeThemeId"] == "classic"
    assert {t["id"] for t in before["themes"]} == {"classic", "paper", "magazine", "midnight"}
    options = dict(before["themes"][0]["defaults"])
    payload = dict(themeId="paper", options=options, version=before["version"])
    guest.call("admin/themes", expected=401)
    guest.call("admin/themes/preview?themeId=paper", expected=401)
    for route in ("admin/themes", "admin/themes/preview?themeId=paper"):
        editor.call(route, expected=403)
    editor.call("admin/themes/active", "PUT", payload, expected=403)
    admin.call("admin/themes/active", "PUT", payload, csrf=False, expected=400)
    admin.call("admin/themes/active", "PUT", dict(payload, themeId="../../template"), expected=400)
    admin.call("admin/themes/active", "PUT", dict(payload, options=None), expected=400)
    for invalid in [dict(accentColor="red"), dict(accentColor="#fff;url(x)"), dict(heroTitle="<script>alert(1)</script>"), dict(heroTitle="长" * 101), dict(heroDescription="文" * 501), dict(heroDescription=None)]:
        admin.call("admin/themes/active", "PUT", dict(payload, options=dict(options, **invalid)), expected=400)
    assert admin.call("admin/themes") == before
    passed("theme administrator permissions, CSRF and bounded plain-text/color validation")

    count = admin.call("admin/audit")["total"]
    query = urllib.parse.urlencode(dict(themeId="paper", accentColor="#166534", heroTitle="只在预览显示", heroDescription="预览内容"))
    preview = admin.call("admin/themes/preview?" + query)
    assert preview["options"]["heroTitle"] == "只在预览显示"
    assert admin.call("admin/themes") == before and admin.call("admin/audit")["total"] == count
    assert guest.call("public/theme")["themeId"] == "classic"
    passed("theme preview validates without persistence, activation or audit side effects")

    state = before
    saved = {}
    for theme in before["themes"]:
        custom = dict(theme["defaults"], heroTitle="主题中文 🎉 " + theme["id"], heroDescription="主题介绍\n" + "文" * 480)
        state = admin.call("admin/themes/active", "PUT", dict(themeId=theme["id"], options=custom, version=state["version"]))
        saved[theme["id"]] = custom
        public = guest.call("public/theme")
        assert public == dict(themeId=theme["id"], options=custom)
        assert "themes" not in public and "profilesJson" not in json.dumps(public)
        assert all(t["options"] == saved[t["id"]] for t in state["themes"] if t["id"] in saved)
    admin.call("admin/themes/active", "PUT", payload, expected=409)
    assert admin.call("admin/themes") == state
    state = admin.call("admin/themes/active", "PUT", dict(themeId="classic", options=saved["classic"], version=state["version"]))
    assert guest.call("public/theme")["options"] == saved["classic"]
    passed("four independent theme profiles, effective-only public output and stale-version rejection")

    # Two requests with one version must not both activate successfully.
    def apply(id):
        try:
            admin.call("admin/themes/active", "PUT", dict(themeId=id, options=saved[id], version=state["version"]))
            return "saved"
        except AssertionError as e:
            assert "got 409" in str(e)
            return "conflict"
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(apply, ["paper", "midnight"])) == ["conflict", "saved"]
    current = admin.call("admin/themes")
    admin.call("admin/themes/active", "PUT", dict(themeId="classic", options=saved["classic"], version=current["version"]))
    logs = admin.call("admin/audit")["items"]
    assert any(x["action"] == "theme.apply" and x["targetType"] == "theme" and x["targetId"] == "classic" and x["targetName"] == "经典博客" for x in logs)
    passed("concurrent theme activation accepts one revision and records theme identity")
