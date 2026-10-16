"""Dependências das rotas: sessão do banco, relógio, configuração e usuária autenticada."""

from collections.abc import Iterator
from datetime import timedelta
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.domain.dates import Clock
from app.domain.errors import Unauthenticated
from app.models import Actor, User
from app.services import auth
from app.services.context import RequestContext

COOKIE_NAME = "pf_session"


def get_db(request: Request) -> Iterator[Session]:
    factory: sessionmaker[Session] = request.app.state.sessionmaker
    with factory() as session:
        yield session


def get_settings_dep(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def get_clock(request: Request) -> Clock:
    clock: Clock = request.app.state.clock
    return clock


DbDep = Annotated[Session, Depends(get_db)]
SettingsDep = Annotated[Settings, Depends(get_settings_dep)]
ClockDep = Annotated[Clock, Depends(get_clock)]


def get_policy(settings: SettingsDep) -> auth.SessionPolicy:
    return auth.SessionPolicy(
        secret_key=settings.secret_key.get_secret_value().encode(),
        idle=timedelta(days=settings.session_idle_days),
        max_age=timedelta(days=settings.session_max_days),
    )


PolicyDep = Annotated[auth.SessionPolicy, Depends(get_policy)]


def get_current_user(request: Request, db: DbDep, policy: PolicyDep, clock: ClockDep) -> User:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise Unauthenticated()
    user = auth.authenticate(db, policy, token, clock.now())
    if user is None:
        raise Unauthenticated()
    db.commit()  # persiste a renovação de last_seen_at
    return user


CurrentUserDep = Annotated[User, Depends(get_current_user)]


def get_ctx(request: Request, user: CurrentUserDep, clock: ClockDep) -> RequestContext:
    return RequestContext(
        user_id=user.id,
        timezone=user.timezone,
        actor=Actor.USER,
        request_id=str(getattr(request.state, "request_id", "")),
        clock=clock,
    )


CtxDep = Annotated[RequestContext, Depends(get_ctx)]
