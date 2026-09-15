"""Build a versioned offline Docker bundle without local data or credentials."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]


def run(args, capture=False):
    result = subprocess.run(args, cwd=ROOT, check=True, text=True, encoding="utf-8", errors="replace",
                            stdout=subprocess.PIPE if capture else None,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    return result.stdout.strip() if capture else None


def main():
    parser = argparse.ArgumentParser(description="Build and export CMS with SQLite and Nginx for offline deployment.")
    parser.add_argument("--platform", choices=["linux/amd64", "linux/arm64"], default="linux/amd64")
    args = parser.parse_args()
    revision = run(["git", "rev-parse", "HEAD"], True)
    # The manifest must identify the actual application source, not an older committed version.
    if run(["git", "status", "--porcelain", "--untracked-files=all", "--", "src", "web", "deploy/Dockerfile.api", "deploy/Dockerfile.web"], True):
        raise RuntimeError("Commit application and Dockerfile changes before packaging.")
    version = datetime.datetime.now().strftime("%Y%m%d") + "-" + revision[:7]
    name = "cms-" + version + "-" + args.platform.replace("/", "-") + "-sqlite"
    bundle = ROOT / "artifacts/releases" / name
    bundle.mkdir(parents=True, exist_ok=False)
    images = {}
    for service in ["api", "web"]:
        tag = f"itmao/cms-{service}:{version}"
        run(["docker", "build", "--platform", args.platform, "--label", "org.opencontainers.image.revision=" + revision,
             "--label", "org.opencontainers.image.source=https://github.com/256051/cms", "-f", f"deploy/Dockerfile.{service}", "-t", tag, "."])
        images[service] = tag
    for service, base in [("gateway", "nginx:1.28-alpine")]:
        inspect = subprocess.run(["docker", "image", "inspect", base], capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        if inspect.returncode or json.loads(inspect.stdout)[0]["Architecture"] != args.platform.split("/")[1]:
            run(["docker", "pull", "--platform", args.platform, base])
        tag = f"itmao/cms-{service}:{version}"
        run(["docker", "tag", base, tag])
        images[service] = tag

    compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")
    for service in ["api", "web"]:
        pattern = rf"(  {service}:\n)    build:\n      context: \.\n      dockerfile: deploy/Dockerfile\.{service}\n"
        compose, count = re.subn(pattern, rf"\g<1>    image: {images[service]}\n    pull_policy: never\n", compose)
        if count != 1:
            raise RuntimeError("Compose build layout changed; update the packager before exporting.")
    for service, base in [("gateway", "nginx:1.28-alpine")]:
        compose = compose.replace("    image: " + base + "\n", "    image: " + images[service] + "\n    pull_policy: never\n")
    (bundle / "compose.yaml").write_text(compose, encoding="utf-8")
    for name in ["compose.https.yaml", "compose.host-nginx.yaml", "LICENSE", "THIRD_PARTY_NOTICES.md", "CHANGELOG.md"]:
        shutil.copy2(ROOT / name, bundle / name)
    for name in ["deploy/nginx.conf", "deploy/nginx.https.conf", "deploy/nginx.host.conf", "scripts/publish-article.py"]:
        target = bundle / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / name, target)
    shutil.copytree(ROOT / "docs", bundle / "docs")
    shutil.copytree(ROOT / "licenses", bundle / "licenses")
    shutil.copy2(ROOT / "docs/docker-package.md", bundle / "README.md")
    shutil.copy2(ROOT / "deploy/package.env.example", bundle / ".env.example")
    metadata = json.loads(run(["docker", "image", "inspect", *images.values()], True))
    if any(item["Os"] + "/" + item["Architecture"] != args.platform for item in metadata):
        raise RuntimeError("An image does not match the requested platform.")
    manifest = {"version": version, "sourceRevision": revision, "platform": args.platform, "database": "Sqlite", "schema": 6,
                "images": [{"service": service, "tag": tag, "id": item["Id"]} for (service, tag), item in zip(images.items(), metadata)]}
    (bundle / "release.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    run(["docker", "image", "save", "--output", str(bundle / "images.tar"), *images.values()])
    sums = []
    for path in sorted(bundle.rglob("*")):
        if path.is_file():
            with path.open("rb") as stream:
                sums.append(hashlib.file_digest(stream, "sha256").hexdigest() + "  " + path.relative_to(bundle).as_posix())
    (bundle / "SHA256SUMS").write_text("\n".join(sums) + "\n", encoding="utf-8")
    archive = bundle.with_suffix(".tar.gz")
    with tarfile.open(archive, "w:gz", compresslevel=6) as output:
        output.add(bundle, arcname=bundle.name)
    with archive.open("rb") as stream:
        checksum = hashlib.file_digest(stream, "sha256").hexdigest()
    Path(str(archive) + ".sha256").write_text(checksum + "  " + archive.name + "\n", encoding="utf-8")
    print("Bundle:", archive)
    print("SHA256:", checksum)


if __name__ == "__main__":
    main()
