"""Administração pelo terminal do servidor. Não existe cadastro público de usuárias."""

import argparse
import getpass
import os
import sys
from collections.abc import Sequence

from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import make_engine, make_sessionmaker
from app.domain.dates import SystemClock
from app.domain.errors import DomainError
from app.services import auth, users


def _read_password() -> str:
    from_env = os.environ.get("PF_NEW_PASSWORD")
    if from_env:
        return from_env
    first = getpass.getpass("Nova senha: ")
    second = getpass.getpass("Repita a senha: ")
    if first != second:
        raise SystemExit("As senhas não conferem.")
    return first


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create-user", help="Cria uma usuária.")
    create.add_argument("--email", required=True)
    create.add_argument("--timezone", default="America/Sao_Paulo")
    password = commands.add_parser("set-password", help="Troca a senha e encerra as sessões.")
    password.add_argument("--email", required=True)
    revoke = commands.add_parser("revoke-sessions", help="Encerra todas as sessões.")
    revoke.add_argument("--email", required=True)
    return parser


def run(argv: Sequence[str] | None, session: Session) -> int:
    args = _parser().parse_args(argv)
    now = SystemClock().now()
    try:
        if args.command == "create-user":
            user = users.create_user(session, args.email, _read_password(), args.timezone)
            print(f"Usuária criada: {user.email}")
        elif args.command == "set-password":
            user = users.set_password(session, args.email, _read_password())
            auth.revoke_all(session, user.id, now)
            print(f"Senha alterada e sessões encerradas para {user.email}.")
        else:
            user = users.get_by_email(session, args.email)
            count = auth.revoke_all(session, user.id, now)
            print(f"{count} sessão(ões) revogada(s).")
        session.commit()
    except DomainError as exc:
        session.rollback()
        print(f"Erro: {exc.detail}", file=sys.stderr)
        return 1
    return 0


def main() -> None:
    settings = get_settings()
    factory = make_sessionmaker(make_engine(settings.database_url))
    with factory() as session:
        raise SystemExit(run(None, session))


if __name__ == "__main__":
    main()
