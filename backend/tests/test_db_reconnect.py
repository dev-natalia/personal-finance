"""O Neon gratuito "dorme" e derruba as conexões abertas; a primeira consulta depois disso
deve só esperar uma conexão nova, nunca falhar."""

from sqlalchemy import Engine, text

from app.db import make_engine
from tests.conftest import TEST_DATABASE_URL


def test_dropped_connection_is_replaced_transparently(engine: Engine) -> None:
    app_engine = make_engine(TEST_DATABASE_URL)
    try:
        with app_engine.connect() as conn:
            pid = conn.execute(text("select pg_backend_pid()")).scalar_one()
        # A conexão volta ao pool; o "banco dormindo" a derruba por fora.
        with engine.connect() as admin:
            admin.execute(text("select pg_terminate_backend(:pid)"), {"pid": pid})
            admin.commit()
        with app_engine.connect() as conn:
            assert conn.execute(text("select 1")).scalar_one() == 1
            assert conn.execute(text("select pg_backend_pid()")).scalar_one() != pid
    finally:
        app_engine.dispose()
