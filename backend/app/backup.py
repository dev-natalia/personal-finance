"""Backup diário: pg_dump → gzip → age, enviado ao Cloudflare R2, e o aviso ao app.

Roda numa máquina agendada do Fly (`python -m app.backup`). O dump sem criptografia nunca
toca o disco (tudo por pipe), e nenhum segredo vai na linha de comando: a senha do banco
segue por variável de ambiente do processo e as do R2 e do app pela entrada do curl (-K -).
"""

import json
import os
import subprocess
import sys
import tempfile
from collections.abc import Callable, Mapping
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlsplit

REQUIRED = (
    "BACKUP_DATABASE_URL",
    "BACKUP_AGE_RECIPIENT",
    "R2_ENDPOINT",
    "R2_BUCKET",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "APP_URL",
    "BACKUP_REPORT_TOKEN",
)
DUMP_SCRIPT = (
    'pg_dump --no-owner --no-privileges | gzip | age -r "$BACKUP_AGE_RECIPIENT" -o "$BACKUP_OUT"'
)
# Parâmetros da URL do banco que viram variáveis do libpq.
QUERY_TO_ENV = {"sslmode": "PGSSLMODE", "channel_binding": "PGCHANNELBINDING"}

Runner = Callable[..., subprocess.CompletedProcess[Any]]


def object_keys(day: date) -> list[str]:
    """Um diário por dia; no dia 1 o mesmo arquivo também vira o mensal."""
    keys = [f"daily/{day.isoformat()}.sql.gz.age"]
    if day.day == 1:
        keys.append(f"monthly/{day:%Y-%m}.sql.gz.age")
    return keys


def _libpq_env(database_url: str) -> dict[str, str]:
    url = urlsplit(database_url)
    env = {
        "PGHOST": url.hostname or "",
        "PGUSER": unquote(url.username or ""),
        "PGPASSWORD": unquote(url.password or ""),
        "PGDATABASE": unquote(url.path.lstrip("/")),
    }
    if url.port:
        env["PGPORT"] = str(url.port)
    for name, values in parse_qs(url.query).items():
        if name in QUERY_TO_ENV:
            env[QUERY_TO_ENV[name]] = values[-1]
    return env


def _curl_config(**options: str) -> bytes:
    return "".join(f'{name} = "{value}"\n' for name, value in options.items()).encode()


def run(env: Mapping[str, str], runner: Runner = subprocess.run, *, today: date) -> int:
    missing = [name for name in REQUIRED if not env.get(name, "").strip()]
    if missing:
        print(f"Backup não configurado; faltam: {', '.join(missing)}", file=sys.stderr)
        return 2

    keys = object_keys(today)
    try:
        with tempfile.TemporaryDirectory(prefix="backup-") as workdir:
            out = Path(workdir) / f"{today.isoformat()}.sql.gz.age"
            dump_env = {
                "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
                **_libpq_env(env["BACKUP_DATABASE_URL"]),
                "BACKUP_AGE_RECIPIENT": env["BACKUP_AGE_RECIPIENT"],
                "BACKUP_OUT": str(out),
            }
            dumped = runner(
                ["bash", "-o", "pipefail", "-c", DUMP_SCRIPT], env=dump_env, timeout=1800
            )
            if dumped.returncode != 0:
                print("Backup falhou no pg_dump/age.", file=sys.stderr)
                return 1

            credentials = _curl_config(
                user=f"{env['R2_ACCESS_KEY_ID']}:{env['R2_SECRET_ACCESS_KEY']}"
            )
            base = f"{env['R2_ENDPOINT'].rstrip('/')}/{env['R2_BUCKET']}"
            for key in keys:
                uploaded = runner(
                    ["curl", "--fail", "--silent", "--show-error", "-K", "-",
                     "--aws-sigv4", "aws:amz:auto:s3", "-T", str(out), f"{base}/{key}"],
                    input=credentials,
                    timeout=600,
                )  # fmt: skip
                if uploaded.returncode != 0:
                    print(f"Backup falhou no envio de {key}.", file=sys.stderr)
                    return 1

            body = json.dumps({"object_key": keys[0], "size_bytes": out.stat().st_size})
            reported = runner(
                ["curl", "--fail", "--silent", "--show-error", "-K", "-",
                 "-H", "Content-Type: application/json", "--data", body,
                 f"{env['APP_URL'].rstrip('/')}/api/v1/internal/backup-report"],
                input=_curl_config(header=f"Authorization: Bearer {env['BACKUP_REPORT_TOKEN']}"),
                timeout=60,
            )  # fmt: skip
            if reported.returncode != 0:
                print("Backup enviado, mas o aviso ao app falhou.", file=sys.stderr)
                return 1
    except (OSError, subprocess.SubprocessError) as error:
        print(f"Backup falhou: {type(error).__name__}", file=sys.stderr)
        return 1
    print(f"Backup concluído: {', '.join(keys)}")
    return 0


def main() -> None:
    raise SystemExit(run(os.environ, today=date.today()))


if __name__ == "__main__":
    main()
