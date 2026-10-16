"""Engine e fábrica de sessões do SQLAlchemy."""

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker


def make_engine(url: str) -> Engine:
    # hide_parameters: valores financeiros nunca aparecem em mensagens de erro/log do SQLAlchemy.
    return create_engine(url, pool_pre_ping=True, hide_parameters=True)


def make_sessionmaker(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)
