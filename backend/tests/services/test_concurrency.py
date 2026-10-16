"""Corridas reais entre duas conexões (clique duplo chegando em paralelo).

Estes testes usam sessões próprias com commit de verdade, porque uma conexão só enxerga o
que a outra já confirmou. Os dados criados são apagados ao final.
"""

import threading
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from sqlalchemy import Engine, delete, select
from sqlalchemy.orm import Session

from app.domain.dates import FixedClock
from app.models import Actor, PaymentMethod, User
from app.services import accounts, transactions
from app.services.context import RequestContext
from app.services.transactions import NewExpense, NewRefund, WriteResult
from tests.support import FIXED_NOW, PASSWORD

HOLD_SECONDS = 0.5


@dataclass(frozen=True)
class Setup:
    ctx: RequestContext
    account_id: UUID


@pytest.fixture
def committed(engine: Engine) -> Iterator[Setup]:
    with Session(engine, expire_on_commit=False) as session:
        from app.services.users import create_user

        user = create_user(session, f"corrida-{uuid4().hex[:8]}@example.com", PASSWORD)
        ctx = RequestContext(
            user_id=user.id,
            timezone=user.timezone,
            actor=Actor.USER,
            request_id="race",
            clock=FixedClock(FIXED_NOW),
        )
        account = accounts.create_account(
            session,
            ctx,
            name="Itaú",
            account_type=accounts.AccountType.CHECKING,
            opening_balance=Decimal("1000.00"),
            opening_date=date(2026, 10, 1),
        )
        session.commit()
    yield Setup(ctx=ctx, account_id=account.id)
    with engine.begin() as conn:
        conn.execute(delete(User).where(User.id == ctx.user_id))


def _race(
    engine: Engine,
    first: Callable[[Session], WriteResult],
    second: Callable[[Session], WriteResult],
) -> tuple[WriteResult, WriteResult | BaseException]:
    """`first` grava e segura o commit; `second` começa enquanto o primeiro ainda não confirmou."""
    inserted = threading.Event()
    outcome: dict[str, WriteResult | BaseException] = {}

    def run_first() -> None:
        with Session(engine, expire_on_commit=False) as session:
            outcome["first"] = first(session)
            inserted.set()
            time.sleep(HOLD_SECONDS)
            session.commit()

    def run_second() -> None:
        inserted.wait(timeout=10)
        with Session(engine, expire_on_commit=False) as session:
            try:
                outcome["second"] = second(session)
                session.commit()
            except BaseException as exc:  # registrado para a asserção do teste
                outcome["second"] = exc

    threads = [threading.Thread(target=run_first), threading.Thread(target=run_second)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    result = outcome["first"]
    assert isinstance(result, WriteResult)
    return result, outcome["second"]


def _expense(setup: Setup, description: str) -> NewExpense:
    return NewExpense(
        amount=Decimal("42.00"),
        occurred_on=date(2026, 10, 15),
        description=description,
        account_id=setup.account_id,
        payment_method=PaymentMethod.PIX,
    )


def test_double_click_with_new_merchant_replays(engine: Engine, committed: Setup) -> None:
    data = _expense(committed, "Padaria Nova")

    def create(session: Session) -> WriteResult:
        return transactions.create_transaction(
            session, committed.ctx, data, idempotency_key="corrida-0001"
        )

    first, second = _race(engine, create, create)
    assert isinstance(second, WriteResult), repr(second)
    assert second.replayed
    assert second.transaction.id == first.transaction.id


def test_batch_items_sharing_a_new_merchant_both_succeed(engine: Engine, committed: Setup) -> None:
    def create_with(key: str) -> Callable[[Session], WriteResult]:
        def create(session: Session) -> WriteResult:
            return transactions.create_transaction(
                session, committed.ctx, _expense(committed, "Feira Livre"), idempotency_key=key
            )

        return create

    first, second = _race(engine, create_with("lote-0001"), create_with("lote-0002"))
    assert isinstance(second, WriteResult), repr(second)
    assert not second.replayed
    assert second.transaction.id != first.transaction.id
    assert second.transaction.merchant_id == first.transaction.merchant_id


def test_double_click_on_full_refund_replays(engine: Engine, committed: Setup) -> None:
    with Session(engine, expire_on_commit=False) as session:
        expense = transactions.create_transaction(
            session, committed.ctx, _expense(committed, "Loja")
        ).transaction
        session.commit()
    data = NewRefund(amount=Decimal("42.00"), occurred_on=date(2026, 10, 15))

    def refund(session: Session) -> WriteResult:
        return transactions.create_refund(
            session, committed.ctx, expense.id, data, idempotency_key="estorno-corrida-1"
        )

    first, second = _race(engine, refund, refund)
    assert isinstance(second, WriteResult), repr(second)
    assert second.replayed
    assert second.transaction.id == first.transaction.id


def test_parallel_wrong_passwords_cannot_bypass_login_limit(engine: Engine) -> None:
    """10 tentativas erradas disparadas juntas: no máximo 5 chegam a ser avaliadas."""
    from app.models import LoginAttempt
    from app.services import auth
    from app.services.users import create_user
    from tests.support import POLICY

    email = f"rajada-{uuid4().hex[:8]}@example.com"
    with Session(engine) as session:
        user_id = create_user(session, email, PASSWORD).id
        session.commit()

    start = threading.Barrier(10)

    def attempt(index: int) -> None:
        with Session(engine) as session:
            start.wait(timeout=10)
            auth.login(session, POLICY, email, "senha-errada-123", f"10.9.0.{index}", FIXED_NOW)
            session.commit()

    try:
        threads = [threading.Thread(target=attempt, args=(i,)) for i in range(10)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)
        with Session(engine) as session:
            recorded = session.scalars(
                select(LoginAttempt).where(LoginAttempt.email_normalized == email)
            ).all()
        assert len(recorded) == auth.MAX_FAILURES
    finally:
        with engine.begin() as conn:
            conn.execute(delete(LoginAttempt).where(LoginAttempt.email_normalized == email))
            conn.execute(delete(User).where(User.id == user_id))
