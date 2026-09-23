"""Production browser verification on a disposable site with local SMTP/Webhook sinks."""
import os
import socketserver
import threading
from http.server import ThreadingHTTPServer
from notification_acceptance import Smtp, Webhook
from geolocation_browser import main

if __name__ == "__main__":
    smtp = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Smtp)
    http = ThreadingHTTPServer(("127.0.0.1", 0), Webhook)
    for server in [smtp, http]: threading.Thread(target=server.serve_forever, daemon=True).start()
    os.environ.update(Notifications__Enabled="true", Notifications__SiteUrl="http://127.0.0.1:9999",
        Notifications__Email__Enabled="true", Notifications__Email__Host="127.0.0.1", Notifications__Email__Port=str(smtp.server_address[1]),
        Notifications__Email__EnableSsl="false", Notifications__Email__From="cms@local.invalid", Notifications__Email__To="admin@local.invalid",
        Notifications__Email__Username="", Notifications__Email__Password="", Maintenance__BackupKeepCount="2",
        Notifications__WeCom__Enabled="true", Notifications__WeCom__WebhookUrl=f"http://127.0.0.1:{http.server_port}/webhook")
    try: main("operations.spec.ts", isolated_build=True)
    finally:
        for server in [smtp, http]: server.shutdown(); server.server_close()
