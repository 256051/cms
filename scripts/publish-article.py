"""Publish via the generic API. Credentials come from the process environment, never command arguments."""
import argparse
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, new_url):
        return None  # Never forward the bearer credential to a redirected destination.


def main():
    parser = argparse.ArgumentParser(description="创建 CMS 草稿，或使用 --publish 直接发布。相同任务重试时保留 --request-id。")
    parser.add_argument("--title", required=True)
    parser.add_argument("--slug", required=True)
    parser.add_argument("--html", required=True, type=Path)
    parser.add_argument("--request-id", required=True)
    parser.add_argument("--summary", default="")
    parser.add_argument("--kind", choices=["post", "page"], default="post")
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    base = os.environ.get("CMS_URL", "").rstrip("/")
    token = os.environ.get("CMS_ACCESS_TOKEN", "")
    url = urllib.parse.urlsplit(base)
    if url.scheme not in ("https", "http") or not url.netloc or url.username or url.password or url.query or url.fragment or url.path or (url.scheme == "http" and url.hostname not in ("localhost", "127.0.0.1", "::1")):
        parser.error("CMS_URL 必须是 HTTPS 站点源地址；仅本地开发允许 HTTP。")
    if not re.fullmatch(r"cms_[a-f0-9]{32}\.[a-f0-9]{64}", token):
        parser.error("请通过 CMS_ACCESS_TOKEN 环境变量提供有效令牌。")
    if not re.fullmatch(r"[A-Za-z0-9_.-]{8,100}", args.request_id):
        parser.error("--request-id 需为 8–100 位字母、数字、点、连字符或下划线。")
    opener = urllib.request.build_opener(NoRedirect())

    def post(path, data, operation):
        request = urllib.request.Request(base + "/api/v1/integration/" + path, data=json.dumps(data, ensure_ascii=False).encode(), headers={"Authorization": "Bearer " + token, "Content-Type": "application/json", "Idempotency-Key": args.request_id + "." + operation}, method="POST")
        try:
            with opener.open(request, timeout=60) as response:
                return json.load(response)["data"]
        except urllib.error.HTTPError as error:
            try:
                failure = json.load(error)
                detail = f'{failure.get("code", "ERROR")}: {failure.get("message", "请求失败")} / traceId={failure.get("traceId", "")}'
            except (ValueError, TypeError): detail = "请求未完成，请检查站点地址与服务状态。"
            raise SystemExit(f"HTTP {error.code}: {detail}") from None
        except urllib.error.URLError:
            raise SystemExit("连接失败。确认服务可用后，使用相同参数和 --request-id 重试。") from None

    draft = post("contents", {"kind":args.kind, "title":args.title, "slug":args.slug, "summary":args.summary, "html":args.html.read_text(encoding="utf-8-sig"), "coverId":"", "categoryId":"", "tagIds":[], "version":0}, "draft")
    if args.publish:
        result = post(f'contents/{draft["id"]}/publish', {"version":draft["version"]}, "publish")
        print(json.dumps({"id":result["content"]["id"], "url":base + result["path"], "published":True}, ensure_ascii=False))
    else:
        print(json.dumps({"id":draft["id"], "version":draft["version"], "published":False}, ensure_ascii=False))


if __name__ == "__main__":
    main()
