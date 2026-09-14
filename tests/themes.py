"""Theme contract checks, run only against the matrix's isolated database."""
import concurrent.futures
import json
import urllib.parse


def check_themes(admin, editor, guest, passed):
    before = admin.call("admin/themes")
    assert before["activeThemeId"] == "classic"
    assert {t["id"] for t in before["themes"]} == {"classic", "paper", "magazine", "midnight", "fuwari", "retypeset", "cactus"}
    new_defaults = {
        "fuwari": ("#7C5CC4", "记录生活，也记录灵感。"),
        "retypeset": ("#9A5B36", "把日子写成值得重读的篇章。"),
        "cactus": ("#2BBC8A", "保持好奇，持续构建。"),
    }
    for theme in before["themes"]:
        if theme["id"] in new_defaults:
            assert (theme["defaults"]["accentColor"], theme["defaultHeroTitle"]) == new_defaults[theme["id"]]
            assert theme["options"] == theme["defaults"]
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
    for theme in before["themes"]:
        for invalid in [dict(accentColor="red"), dict(accentColor="#fff;url(x)"), dict(heroTitle="<script>alert(1)</script>"), dict(heroTitle="长" * 101), dict(heroDescription="文" * 501), dict(heroDescription=None)]:
            invalid_options = dict(theme["defaults"], **invalid)
            admin.call("admin/themes/active", "PUT", dict(payload, themeId=theme["id"], options=invalid_options), expected=400)
            if None not in invalid_options.values():
                query = urllib.parse.urlencode(dict(themeId=theme["id"], **invalid_options))
                admin.call("admin/themes/preview?" + query, expected=400)
    admin.call("admin/themes/preview?themeId=unknown", expected=400)
    assert admin.call("admin/themes") == before
    passed("seven-theme administrator permissions, CSRF and bounded apply/preview validation")

    count = admin.call("admin/audit")["total"]
    initial_public = guest.call("public/theme")
    site_description = guest.call("public/settings")["description"]
    for theme in before["themes"]:
        preview_options = dict(theme["defaults"], heroTitle="只在预览显示 " + theme["id"], heroDescription="预览内容")
        query = urllib.parse.urlencode(dict(themeId=theme["id"], **preview_options))
        assert admin.call("admin/themes/preview?" + query) == dict(themeId=theme["id"], options=preview_options)
        defaults = admin.call("admin/themes/preview?themeId=" + theme["id"])
        assert defaults["options"] == dict(theme["defaults"], heroTitle=theme["defaultHeroTitle"], heroDescription=site_description)
        assert guest.call("public/theme") == initial_public
    assert admin.call("admin/themes") == before and admin.call("admin/audit")["total"] == count
    assert guest.call("public/theme")["themeId"] == "classic"
    passed("seven-theme previews and default fallbacks without persistence, activation or audit side effects")

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
    for theme in reversed(before["themes"]):
        profile = next(t["options"] for t in state["themes"] if t["id"] == theme["id"])
        assert profile == saved[theme["id"]]
        state = admin.call("admin/themes/active", "PUT", dict(themeId=theme["id"], options=profile, version=state["version"]))
        assert guest.call("public/theme") == dict(themeId=theme["id"], options=saved[theme["id"]])
    passed("seven independent theme profiles survive switching, effective-only public output and stale-version rejection")

    for theme in before["themes"]:
        if theme["id"] not in new_defaults:
            continue
        state = admin.call("admin/themes/active", "PUT", dict(themeId=theme["id"], options=theme["defaults"], version=state["version"]))
        assert guest.call("public/theme") == dict(themeId=theme["id"], options=dict(theme["defaults"], heroTitle=theme["defaultHeroTitle"], heroDescription=site_description))
        assert all(t["options"] == saved[t["id"]] for t in state["themes"] if t["id"] != theme["id"])
        state = admin.call("admin/themes/active", "PUT", dict(themeId=theme["id"], options=saved[theme["id"]], version=state["version"]))
    passed("new themes restore defaults with site-description fallback without overwriting other profiles")

    # Two requests with one version must not both activate successfully.
    def apply(id):
        try:
            admin.call("admin/themes/active", "PUT", dict(themeId=id, options=saved[id], version=state["version"]))
            return "saved"
        except AssertionError as e:
            assert "got 409" in str(e)
            return "conflict"
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        assert sorted(pool.map(apply, ["fuwari", "cactus"])) == ["conflict", "saved"]
    current = admin.call("admin/themes")
    admin.call("admin/themes/active", "PUT", dict(themeId="classic", options=saved["classic"], version=current["version"]))
    logs = admin.call("admin/audit")["items"]
    assert any(x["action"] == "theme.apply" and x["targetType"] == "theme" and x["targetId"] == "classic" and x["targetName"] == "经典博客" for x in logs)
    passed("concurrent theme activation accepts one revision and records theme identity")
