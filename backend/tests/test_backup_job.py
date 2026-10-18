import json
import os
import subprocess
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from app.backup import object_keys, run

DB_PASSWORD = "senha-do-banco-XYZ"
R2_SECRET = "segredo-do-r2-XYZ"
REPORT_TOKEN = "token-do-relatorio-XYZ"
SECRETS = (DB_PASSWORD, R2_SECRET, REPORT_TOKEN)
ENV = {
    "BACKUP_DATABASE_URL": (
        f"postgresql://backup_reader:{DB_PASSWORD}@ep-x.sa-east-1.aws.neon.tech/neondb"
        "?sslmode=require&channel_binding=require"
    ),
    "BACKUP_AGE_RECIPIENT": "age1publickey",
    "R2_ENDPOINT": "https://conta.r2.cloudflarestorage.com/",
    "R2_BUCKET": "financas-backup",
    "R2_ACCESS_KEY_ID": "AKID",
    "R2_SECRET_ACCESS_KEY": R2_SECRET,
    "APP_URL": "https://caderno-de-gastos.fly.dev",
    "BACKUP_REPORT_TOKEN": REPORT_TOKEN,
}
ENCRYPTED = b"age-encrypted-bytes"


@dataclass
class Call:
    cmd: list[str]
    env: dict[str, str] | None
    input: bytes | None
    files_seen: list[str]


@dataclass
class FakeRunner:
    fail_at: str | None = None
    calls: list[Call] = field(default_factory=list)
    workdirs: set[Path] = field(default_factory=set)

    def step(self, cmd: list[str]) -> str:
        if cmd[0] == "bash":
            return "dump"
        return "report" if any("backup-report" in a for a in cmd) else "upload"

    def __call__(self, cmd: list[str], **kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        env = kwargs.get("env")
        step = self.step(cmd)
        if step == "dump":
            assert env is not None
            out = Path(env["BACKUP_OUT"])
            self.workdirs.add(out.parent)
            out.write_bytes(ENCRYPTED)
        seen = sorted(p.name for d in self.workdirs for p in d.iterdir())
        self.calls.append(Call(cmd, env, kwargs.get("input"), seen))
        if self.fail_at == "raise" and step == "upload":
            raise FileNotFoundError("curl")
        if step == self.fail_at:
            return subprocess.CompletedProcess(cmd, 1)
        return subprocess.CompletedProcess(cmd, 0)


def test_daily_and_monthly_keys() -> None:
    assert object_keys(date(2026, 10, 15)) == ["daily/2026-10-15.sql.gz.age"]
    assert object_keys(date(2026, 11, 1)) == [
        "daily/2026-11-01.sql.gz.age",
        "monthly/2026-11.sql.gz.age",
    ]


def test_runs_dump_encrypt_upload_and_report_in_order() -> None:
    runner = FakeRunner()
    assert run(ENV, runner=runner, today=date(2026, 11, 1)) == 0
    assert [runner.step(c.cmd) for c in runner.calls] == ["dump", "upload", "upload", "report"]

    dump = runner.calls[0]
    script = dump.cmd[-1]
    assert dump.cmd[:3] == ["bash", "-o", "pipefail"]
    assert "pg_dump --no-owner --no-privileges" in script
    assert '| gzip | age -r "$BACKUP_AGE_RECIPIENT" -o "$BACKUP_OUT"' in script
    assert dump.env is not None
    assert dump.env["PGPASSWORD"] == DB_PASSWORD
    assert dump.env["PGHOST"] == "ep-x.sa-east-1.aws.neon.tech"
    assert dump.env["PGUSER"] == "backup_reader"
    assert dump.env["PGDATABASE"] == "neondb"
    assert dump.env["PGSSLMODE"] == "require"
    assert dump.env["PGCHANNELBINDING"] == "require"

    urls = [c.cmd[-1] for c in runner.calls[1:3]]
    assert urls == [
        "https://conta.r2.cloudflarestorage.com/financas-backup/daily/2026-11-01.sql.gz.age",
        "https://conta.r2.cloudflarestorage.com/financas-backup/monthly/2026-11.sql.gz.age",
    ]
    for upload in runner.calls[1:3]:
        assert upload.cmd[0] == "curl"
        assert "--fail" in upload.cmd
        assert upload.cmd[upload.cmd.index("--aws-sigv4") + 1] == "aws:amz:auto:s3"
        assert upload.cmd[upload.cmd.index("-T") + 1].endswith(".sql.gz.age")
        assert upload.input == f'user = "AKID:{R2_SECRET}"\n'.encode()

    report = runner.calls[3]
    assert report.cmd[-1] == "https://caderno-de-gastos.fly.dev/api/v1/internal/backup-report"
    body = json.loads(report.cmd[report.cmd.index("--data") + 1])
    assert body == {"object_key": "daily/2026-11-01.sql.gz.age", "size_bytes": len(ENCRYPTED)}
    assert report.input == f'header = "Authorization: Bearer {REPORT_TOKEN}"\n'.encode()

    for call in runner.calls:
        command_line = " ".join(call.cmd)
        assert not any(secret in command_line for secret in SECRETS)
    assert all(not d.exists() for d in runner.workdirs)


@pytest.mark.parametrize("fail_at", ["dump", "upload", "raise", "report"])
def test_failed_step_reports_nothing_and_leaves_no_plaintext(fail_at: str) -> None:
    runner = FakeRunner(fail_at=fail_at)
    assert run(ENV, runner=runner, today=date(2026, 10, 15)) == 1
    steps = [runner.step(c.cmd) for c in runner.calls]
    if fail_at != "report":
        assert "report" not in steps
    for call in runner.calls:
        assert all(name.endswith(".age") for name in call.files_seen), call.files_seen
    assert all(not d.exists() for d in runner.workdirs)


def test_missing_variables_exit_with_2(capsys: pytest.CaptureFixture[str]) -> None:
    runner = FakeRunner()
    env = {k: v for k, v in ENV.items() if k not in {"R2_BUCKET", "BACKUP_REPORT_TOKEN"}}
    env["APP_URL"] = "  "
    assert run(env, runner=runner, today=date(2026, 10, 15)) == 2
    assert runner.calls == []
    err = capsys.readouterr().err
    assert "R2_BUCKET" in err
    assert "BACKUP_REPORT_TOKEN" in err
    assert "APP_URL" in err
    assert os.environ.get("PGPASSWORD") is None
