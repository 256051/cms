"""Local-only SMTP and WeCom receivers; no external messages or daily-site data."""
import json
import os
import secrets
import socketserver
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

os.environ.setdefault("CMS_TEST_CONFIGURATION", "Release")
import run_matrix as matrix
from integration import Client


class Webhook(BaseHTTPRequestHandler):
    messages = []
    seen = {}

    def log_message(self, *args):
        pass

    def do_POST(self):
        if self.headers.get("Transfer-Encoding") == "chunked":
            chunks = []
            while size := int(self.rfile.readline().strip(), 16):
                chunks.append(self.rfile.read(size)); self.rfile.read(2)
            self.rfile.read(2)
            raw = b"".join(chunks)
        else:
            raw = self.rfile.read(int(self.headers["Content-Length"]))
        message = json.loads(raw)
        assert message["msgtype"] == "text"
        body = message["text"]["content"]
        self.messages.append(body)
        self.seen[body] = self.seen.get(body, 0) + 1
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(dict(errcode=40001 if self.seen[body] == 1 else 0)).encode())


class Smtp(socketserver.StreamRequestHandler):
    messages = []

    def handle(self):
        self.wfile.write(b"220 localhost test smtp\r\n")
        while line := self.rfile.readline():
            command = line.decode("ascii", "replace").strip().upper()
            if command.startswith("EHLO"):
                self.wfile.write(b"250-localhost\r\n250 8BITMIME\r\n")
            elif command.startswith("DATA"):
                self.wfile.write(b"354 end with dot\r\n")
                lines = []
                while (line := self.rfile.readline()) not in (b".\r\n", b""):
                    lines.append(line)
                self.messages.append(b"".join(lines))
                self.wfile.write(b"250 accepted\r\n")
            elif command.startswith("QUIT"):
                self.wfile.write(b"221 bye\r\n")
                break
            else:
                self.wfile.write(b"250 ok\r\n")


def main():
    http = ThreadingHTTPServer(("127.0.0.1", 0), Webhook)
    smtp = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Smtp)
    for server in [http, smtp]:
        threading.Thread(target=server.serve_forever, daemon=True).start()
    owned, results = [], {}
    kinds = ["Sqlite", "PostgreSQL", "MySql", "SqlServer"] if "all" in sys.argv else ["Sqlite"]
    try:
        for kind in kinds:
            print("DATABASE:", kind, flush=True)
            password = "Notify!" + secrets.token_hex(18)
            env = dict(os.environ, Database__Type=kind, Database__ConnectionString=matrix.database(kind, password, owned),
                Setup__Username="notifyadmin", Setup__Password=password, ASPNETCORE_ENVIRONMENT="Development", Consul__Enabled="false",
                Urls=f"http://127.0.0.1:{matrix.port()}", Security__KeyPath=str(matrix.LOCAL / kind / "keys"), Storage__Path=str(matrix.LOCAL / kind / "uploads"),
                Maintenance__BackupIntervalHours="0", Maintenance__TrafficRetentionDays="0",
                Notifications__Enabled="true", Notifications__SiteUrl="http://127.0.0.1:9999",
                Notifications__Email__Enabled="true", Notifications__Email__Host="127.0.0.1", Notifications__Email__Port=str(smtp.server_address[1]),
                Notifications__Email__EnableSsl="false", Notifications__Email__From="cms@local.invalid", Notifications__Email__To="admin@local.invalid",
                Notifications__Email__Username="", Notifications__Email__Password="",
                Notifications__WeCom__Enabled="true", Notifications__WeCom__WebhookUrl=f"http://127.0.0.1:{http.server_port}/webhook")
            matrix.command(["dotnet", str(matrix.API), "--initialize"], env)
            result = matrix.command(["dotnet", str(matrix.CHECKS), "--notifications"], env)
            (matrix.ARTIFACTS / (kind + "-notifications.log")).write_text(result, encoding="utf-8")
            print(result, flush=True)
            env["Notifications__Enabled"] = "false"
            env["Maintenance__BackupPath"] = str(matrix.LOCAL / kind / "backups")
            with (matrix.ARTIFACTS / (kind + "-api.log")).open("w", encoding="utf-8") as log:
                process = matrix.start(env, log)
                try:
                    admin, guest = Client(env["Urls"]), Client(env["Urls"])
                    admin.login("notifyadmin", password)
                    guest.call("admin/notifications", expected=401)
                    records = admin.call("admin/notifications")
                    assert records["total"] == 9
                    status = admin.call("admin/notifications/settings")
                    assert "webhook" not in json.dumps(status).lower() and "password" not in json.dumps(status).lower()
                    if kind == "Sqlite":
                        (matrix.ROOT / "docs/openapi.json").write_text(json.dumps(admin.call("/openapi/v1.json"), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                    admin.call("admin/maintenance/backup", "POST")
                    archive = matrix.LOCAL / kind / "notifications.zip"
                    archive.write_bytes(admin.call("admin/maintenance/download"))
                finally:
                    matrix.stop(process)
                restored = dict(env, Database__Type="Sqlite", Database__ConnectionString="Data Source=" + str(matrix.LOCAL / kind / "restored.db"),
                    Security__KeyPath=str(matrix.LOCAL / kind / "restored-keys"), Storage__Path=str(matrix.LOCAL / kind / "restored-uploads"))
                matrix.command(["dotnet", str(matrix.API), "--restore=" + str(archive)], restored)
                process = matrix.start(restored, log)
                try:
                    admin = Client(restored["Urls"]); admin.login("notifyadmin", password)
                    assert admin.call("admin/notifications")["total"] == 9
                finally:
                    matrix.stop(process)
            results[kind] = "passed"
        assert len(Smtp.messages) == 4 * len(kinds) and len(Webhook.messages) == 8 * len(kinds)
        assert all("private@example.invalid" not in body and "不会发送的姓名" not in body for body in Webhook.messages)
    finally:
        for server in [http, smtp]:
            server.shutdown(); server.server_close()
        for name in owned:
            matrix.command(["docker", "rm", "-f", name])
        (matrix.ARTIFACTS / "notifications-results.json").write_text(json.dumps(results), encoding="utf-8")
        print("Artifacts:", matrix.ARTIFACTS)


if __name__ == "__main__":
    main()
