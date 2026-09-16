"""Traffic and private inquiry acceptance; run only against the caller's isolated database."""
import concurrent.futures
import time
import uuid
from integration import Client


def check_traffic(admin, editor, record):
    browser = Client(admin.base, {"User-Agent": "Mozilla/5.0 Chrome/140.0"})
    other = Client(admin.base, {"User-Agent": "Mozilla/5.0 iPhone Mobile"})
    bot = Client(admin.base, {"User-Agent": "Googlebot"})
    before = admin.call("admin/traffic")
    article = admin.call("admin/contents", "POST", dict(kind="post", slug="traffic-" + uuid.uuid4().hex,
        title="访问统计验收文章", summary="阅读记录", html="<p>统计正文</p>", coverId="", categoryId="", tagIds=[], version=0))
    article = admin.call(f"admin/contents/{article['id']}/publish", "POST", {"version": article["version"]})
    path = "/posts/" + article["slug"]
    visit = dict(id=uuid.uuid4().hex, path=path, referrer="https://search.example/private?q=secret", campaign="")
    baseline = admin.call("public/contents/" + article["slug"])
    for _ in range(2): assert browser.call("public/contents/" + article["slug"])["views"] == 0
    browser.call("public/visits", "POST", visit, csrf=False, expected=400)
    assert browser.call("public/visits", "POST", visit)["id"] == visit["id"]
    assert browser.call("public/visits", "POST", visit)["id"] == visit["id"]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda _: browser.call("public/visits", "POST", visit), range(4)))
    assert browser.call("public/contents/" + article["slug"])["views"] == 1
    assert bot.call("public/visits", "POST", dict(visit, id=uuid.uuid4().hex))["id"] == ""
    assert admin.call("public/visits", "POST", dict(visit, id=uuid.uuid4().hex))["id"] == ""
    for invalid in ("/admin", "/admin/themes/preview/posts/" + article["slug"], "/posts/missing", "/pages/" + article["slug"]):
        browser.call("public/visits", "POST", dict(visit, id=uuid.uuid4().hex, path=invalid), expected=404)
    browser.call("public/visits", "POST", dict(visit, id="invalid"), expected=400)
    second = dict(visit, id=uuid.uuid4().hex)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda _: browser.call("public/visits", "POST", second), range(4)))
    other_visit = dict(visit, id=uuid.uuid4().hex, campaign="推广验收")
    other.call("public/visits", "POST", other_visit)
    time.sleep(2)
    reading = f"public/visits/{visit['id']}/reading"
    browser.call(reading, "POST", dict(activeSeconds=2, depth=80))
    browser.call(reading, "POST", dict(activeSeconds=1, depth=20))
    other.call(reading, "POST", dict(activeSeconds=2, depth=90), expected=404)
    browser.call(reading, "POST", dict(activeSeconds=-1, depth=101), expected=400)
    counts = next(c for c in admin.call("admin/contents?sort=views")["items"] if c["id"] == article["id"])
    assert (counts["views"], counts["todayViews"], counts["visitors"]) == (3, 3, 2), counts
    assert admin.call("admin/contents?sort=views")["items"][0]["id"] == article["id"]
    assert admin.call("public/contents/" + article["slug"])["version"] == baseline["version"]
    visitors = admin.call("admin/visitors")["items"]
    profile = next(v for v in visitors if v["source"] == "search.example")
    history = admin.call(f"admin/visitors/{profile['id']}/visits")["items"]
    read = next(v for v in history if v["id"] == visit["id"])
    assert read["activeSeconds"] == 2 and read["depth"] == 80, read
    assert profile["views"] == 2 and profile["lastSeenAt"] >= profile["createdAt"]
    action = dict(id=uuid.uuid4().hex, kind="consultation", targetId="")
    for _ in range(2): browser.call(f"public/visits/{visit['id']}/events", "POST", action)
    other.call(f"public/visits/{visit['id']}/events", "POST", dict(action, id=uuid.uuid4().hex), expected=404)
    download_id = admin.upload("traffic.pdf", b"%PDF-1.4\n% traffic test\n%%EOF")["id"]
    browser.call(f"public/visits/{visit['id']}/events", "POST", dict(id=uuid.uuid4().hex, kind="download", targetId=download_id), expected=404)
    attachment_draft = admin.call("admin/contents/" + article["id"])
    attachment_draft["html"] += f'<p><a href="/media/{download_id}">下载资料</a></p>'
    attachment_draft = admin.call("admin/contents/" + article["id"], "PUT", attachment_draft)
    admin.call(f"admin/contents/{article['id']}/publish", "POST", {"version": attachment_draft["version"]})
    browser.call(f"public/visits/{visit['id']}/events", "POST", dict(id=uuid.uuid4().hex, kind="download", targetId=download_id))
    lead = dict(id=uuid.uuid4().hex, path=path, visitId=visit["id"], name="验收客户", contact="test@example.test",
        organization="验收学校", need="希望预约演示", consent=True, website="")
    browser.call("public/leads", "POST", dict(lead, consent=False), expected=400)
    receipt = browser.call("public/leads", "POST", lead)
    assert set(receipt) == {"id"} and receipt["id"] == lead["id"]
    assert browser.call("public/leads", "POST", lead) == receipt
    browser.call("public/leads", "POST", dict(lead, name="另一个请求"), expected=409)
    for route in ("admin/traffic", "admin/visitors", "admin/leads"):
        browser.call(route, expected=401)
        editor.call(route, expected=403)
    saved = admin.call("admin/leads?q=" + "test%40example.test")["items"][0]
    assert saved["source"] == "search.example" and saved["contentId"] == article["id"]
    assert saved["contact"] == lead["contact"] and saved["status"] == "new"
    updated = admin.call("admin/leads/" + saved["id"], "PUT", dict(status="following", notes="已约演示", version=saved["version"]))
    assert updated["version"] == saved["version"] + 1
    admin.call("admin/leads/" + saved["id"], "PUT", dict(status="completed", notes="旧数据", version=saved["version"]), expected=409)
    assert admin.call("admin/leads?status=following")["items"][0]["notes"] == "已约演示"
    report = admin.call("admin/traffic")
    assert report["today"]["views"] - before["today"]["views"] == 3
    assert report["today"]["visitors"] - before["today"]["visitors"] == 2
    assert report["todayLeads"] - before["todayLeads"] == 1
    assert report["consultationClicks"] - before["consultationClicks"] == 1
    assert report["downloadClicks"] - before["downloadClicks"] == 1
    assert len(report["days"]) == 7 and report["days"][-1]["leads"] >= 1
    assert sum(d["views"] for d in report["days"]) == report["period"]["views"]
    assert all("secret" not in s["name"] for s in report["sources"])
    assert any(p["contentId"] == article["id"] and p["visitors"] == 2 for p in report["popular"])
    admin.call("admin/traffic?from=2026-01-01&to=2026-12-31", expected=400)
    admin.call("admin/traffic?from=bad", expected=400)
    admin.call("admin/traffic?from=0001-01-01", expected=400)
    admin.call("admin/traffic?to=9999-12-31", expected=400)
    draft = admin.call("admin/contents/" + article["id"])
    admin.call(f"admin/contents/{article['id']}/publish", "POST", {"version": draft["version"]})
    assert browser.call("public/contents/" + article["slug"])["views"] == 3
    browser.call("public/leads", "POST", dict(lead, id=uuid.uuid4().hex, website="spam"), expected=400)
    browser.call("public/leads", "POST", dict(lead, id=uuid.uuid4().hex), expected=429)
    record("traffic: CSRF, crawler/staff/preview exclusions, concurrent replay dedupe, PV/UV, monotonic reading, private attribution, role restrictions, follow-up concurrency, report totals and publication isolation")
    return dict(article=article, lead=updated, report=report, visitor=profile)
