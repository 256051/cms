"""Start the local SQLite API and production Next.js preview without visible terminal windows."""
import json
import os
from pathlib import Path
import subprocess
import secrets

root = Path(__file__).resolve().parents[1]
local = root / ".local"
local.mkdir(exist_ok=True)
credential_file = local / "preview-credentials.json"
if not credential_file.exists():
    credential_file.write_text(json.dumps({"username":"cmsadmin","password":"Cms!" + secrets.token_hex(20)}), encoding="utf-8")
credentials = json.loads(credential_file.read_text(encoding="utf-8-sig"))
env = dict(os.environ, Database__Type="Sqlite", Database__ConnectionString="Data Source=" + str(local / "preview.db"), Setup__Username=credentials["username"], Setup__Password=credentials["password"], ASPNETCORE_ENVIRONMENT="Development", Urls="http://127.0.0.1:5080", Storage__Path=str(local / "preview-uploads"), Security__KeyPath=str(local / "preview-keys"), NEXT_TELEMETRY_DISABLED="1", API_INTERNAL_URL="http://127.0.0.1:5080", SITE_URL="http://localhost:3000")
flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
api = str(root / "src/Cms.Api/bin/Debug/net10.0/Cms.Api.dll")
with (local / "preview-api.log").open("a", encoding="utf-8") as log:
    subprocess.run(["dotnet", api, "--initialize"], env=env, cwd=root, stdout=log, stderr=log, check=True, creationflags=flags)
    backend = subprocess.Popen(["dotnet", api], env=env, cwd=root, stdout=log, stderr=log, creationflags=flags)
with (local / "preview-web.log").open("a", encoding="utf-8") as log:
    frontend = subprocess.Popen(["node", str(root / "web/node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1"], env=env, cwd=root / "web", stdout=log, stderr=log, creationflags=flags)
(local / "preview-processes.json").write_text(json.dumps({"api":backend.pid,"web":frontend.pid}), encoding="utf-8")
print("Local preview started on http://localhost:3000")
