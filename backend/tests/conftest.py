import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session

from app.domain.dates import FixedClock
from app.models import Actor, User
from app.services.context import RequestContext
from app.services.users import create_user
from tests.support import FIXED_NOW, PASSWORD

BACKEND_DIR = Path(__file__).resolve().parents[1]
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://finance:finance@127.0.0.1:5433/finance_test"
)


def alembic_config(url: str) -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", url)
    return config


@pytest.fixture(scope="session")
def engine() -> Iterator[Engine]:
    """Recria o schema do banco de testes e aplica as migrações uma vez por sessão."""
    test_engine = create_engine(TEST_DATABASE_URL)
    with test_engine.begin() as conn:
        conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    command.upgrade(alembic_config(TEST_DATABASE_URL), "head")
    yield test_engine
    test_engine.dispose()


@pytest.fixture
def db(engine: Engine) -> Iterator[Session]:
    """Sessão isolada: tudo que o teste grava (inclusive commits) é desfeito no final."""
    connection = engine.connect()
    outer = connection.begin()
    session = Session(
        bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False
    )
    try:
        yield session
    finally:
        session.close()
        outer.rollback()
        connection.close()


@pytest.fixture
def clock() -> FixedClock:
    return FixedClock(FIXED_NOW)


@pytest.fixture
def user(db: Session) -> User:
    return create_user(db, "ana@example.com", PASSWORD)


@pytest.fixture
def ctx(user: User, clock: FixedClock) -> RequestContext:
    return RequestContext(
        user_id=user.id, timezone=user.timezone, actor=Actor.USER, request_id="test", clock=clock
    )


@pytest.fixture
def other_ctx(db: Session, clock: FixedClock) -> RequestContext:
    other = create_user(db, "bia@example.com", PASSWORD)
    return RequestContext(
        user_id=other.id, timezone=other.timezone, actor=Actor.USER, request_id="test", clock=clock
    )
