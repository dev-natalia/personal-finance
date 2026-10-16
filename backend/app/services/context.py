"""Contexto de cada operação: quem pede, em que fuso, com que relógio."""

from dataclasses import dataclass
from datetime import date, datetime
from uuid import UUID

from app.domain.dates import Clock, today
from app.models import Actor


@dataclass(frozen=True)
class RequestContext:
    user_id: UUID
    timezone: str
    actor: Actor
    request_id: str
    clock: Clock

    def today(self) -> date:
        return today(self.clock, self.timezone)

    def now(self) -> datetime:
        return self.clock.now()
