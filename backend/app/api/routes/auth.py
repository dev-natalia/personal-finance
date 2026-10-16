from fastapi import APIRouter, Request, Response

from app.api.deps import COOKIE_NAME, ClockDep, CurrentUserDep, DbDep, PolicyDep, SettingsDep
from app.api.schemas.auth import LoginIn, UserOut
from app.domain.errors import TooManyAttempts, Unauthenticated
from app.models import User
from app.services import auth

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=UserOut)
def login(
    body: LoginIn,
    request: Request,
    response: Response,
    db: DbDep,
    policy: PolicyDep,
    clock: ClockDep,
    settings: SettingsDep,
) -> User:
    ip = request.client.host if request.client else "unknown"
    outcome = auth.login(db, policy, body.email, body.password, ip, clock.now())
    db.commit()  # a tentativa fica registrada mesmo quando o login falha
    if outcome.blocked:
        raise TooManyAttempts()
    if outcome.user is None or outcome.token is None:
        raise Unauthenticated("invalid_credentials", "E-mail ou senha incorretos.")
    response.set_cookie(
        COOKIE_NAME,
        outcome.token,
        max_age=int(policy.max_age.total_seconds()),
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/",
    )
    return outcome.user


@router.post("/logout", status_code=204)
def logout(
    request: Request, db: DbDep, policy: PolicyDep, clock: ClockDep, settings: SettingsDep
) -> Response:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        auth.logout(db, policy, token, clock.now())
        db.commit()
    response = Response(status_code=204)
    response.delete_cookie(
        COOKIE_NAME, path="/", secure=settings.cookie_secure, httponly=True, samesite="strict"
    )
    return response


@router.get("/me", response_model=UserOut)
def me(user: CurrentUserDep) -> User:
    return user
