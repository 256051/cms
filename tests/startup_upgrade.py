"""Check startup failure and recovery on an isolated SQLite database after a Release build."""
import json
import os
import secrets
import sqlite3
import subprocess

os.environ.setdefault("CMS_TEST_CONFIGURATION", "Release")
import run_matrix as matrix


def main():
    path = matrix.LOCAL / "startup.db"
    env = dict(os.environ, Database__Type="Sqlite", Database__ConnectionString="Data Source=" + str(path),
               Setup__Username="startupadmin", Setup__Password="Startup!" + secrets.token_hex(18),
               ASPNETCORE_ENVIRONMENT="Development", Urls=f"http://127.0.0.1:{matrix.port()}",
               Security__KeyPath=str(matrix.LOCAL / "keys"), Storage__Path=str(matrix.LOCAL / "uploads"), Consul__Enabled="false")
    checks = []

    def rejected(name, message=None):
        result = subprocess.run(["dotnet", str(matrix.API)], env=env, cwd=matrix.ROOT, capture_output=True,
                                text=True, encoding="utf-8", errors="replace", timeout=30, creationflags=matrix.CREATION)
        output = result.stdout + result.stderr
        (matrix.ARTIFACTS / (name + ".log")).write_text(output, encoding="utf-8")
        assert result.returncode != 0 and "Now listening on" not in output, "Invalid database was served"
        if message:
            assert message in output, output[-1000:]
        checks.append(name)

    rejected("uninitialized-database", "--initialize")
    with sqlite3.connect(path) as db:
        assert not db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    matrix.command(["dotnet", str(matrix.API), "--initialize"], env)
    with sqlite3.connect(path) as db:
        db.execute("UPDATE cms_schema SET Version=999")
    rejected("newer-database", "InvalidOperationException")
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT Version FROM cms_schema").fetchone()[0] == 999
        db.execute("DELETE FROM cms_schema")
    rejected("missing-version-record", "InvalidOperationException")
    with sqlite3.connect(path) as db:
        db.execute("INSERT INTO cms_schema (Id, CreatedAt, Version) VALUES ('schema', CURRENT_TIMESTAMP, 6)")
        db.execute("DROP TABLE cms_page_visits")
        db.execute("CREATE VIEW cms_page_visits AS SELECT 1 AS Id")
    rejected("interrupted-migration")
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT Version FROM cms_schema").fetchone()[0] == 6
        db.execute("DROP VIEW cms_page_visits")
    with (matrix.ARTIFACTS / "recovered.log").open("w", encoding="utf-8") as log:
        process = matrix.start(env, log)
        matrix.stop(process)
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT Version FROM cms_schema").fetchone()[0] == 15
        assert db.execute("SELECT COUNT(*) FROM cms_users").fetchone()[0] == 1
    checks.append("repair-and-restart-resumes-migration-without-recreating-admin")
    for version in range(1, 6):
        legacy = dict(env, Database__ConnectionString="Data Source=" + str(matrix.LOCAL / f"v{version}.db"))
        matrix.command(["dotnet", str(matrix.CHECKS), f"--create-v{version}"], legacy)
        with (matrix.ARTIFACTS / f"v{version}-startup.log").open("w", encoding="utf-8") as log:
            process = matrix.start(legacy, log)
            matrix.stop(process)
        verify = "--verify-upgrade" if version == 1 else f"--verify-v{version}-upgrade"
        matrix.command(["dotnet", str(matrix.CHECKS), verify], legacy)
        checks.append(f"v{version}-automatically-upgrades-before-readiness-and-preserves-data")
    (matrix.ARTIFACTS / "startup-results.json").write_text(json.dumps(dict(status="passed", checks=checks), indent=2), encoding="utf-8")
    print("PASS: startup failure and recovery; results:", matrix.ARTIFACTS / "startup-results.json")


if __name__ == "__main__":
    main()
