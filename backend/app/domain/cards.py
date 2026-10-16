"""Regras puras do cartão de crédito: ciclo da fatura e parcelas.

Cada fatura é identificada pelo mês de vencimento (`reference_month`, sempre dia 1).
"""

import calendar
from datetime import date
from decimal import ROUND_DOWN, Decimal

from app.domain.money import CENT

MIN_INSTALLMENTS = 2
MAX_INSTALLMENTS = 24


def add_months(month: date, n: int) -> date:
    """Soma `n` meses a um mês (dia 1)."""
    index = month.year * 12 + (month.month - 1) + n
    return date(index // 12, index % 12 + 1, 1)


def _day_in_month(month: date, day: int) -> date:
    """O dia pedido no mês; se ele não existe (31 em novembro), o último dia do mês (A7)."""
    last = calendar.monthrange(month.year, month.month)[1]
    return date(month.year, month.month, min(day, last))


def invoice_dates(reference_month: date, closing_day: int, due_day: int) -> tuple[date, date]:
    """(fechamento, vencimento) da fatura que vence em `reference_month`.

    O vencimento é no próprio mês; o fechamento também, se o dia de vencimento vier depois do
    de fechamento. Senão (fecha 28, vence 5), o fechamento é no mês anterior.
    """
    due = _day_in_month(reference_month, due_day)
    closing_month = reference_month if due_day > closing_day else add_months(reference_month, -1)
    return _day_in_month(closing_month, closing_day), due


def invoice_month_for(purchase_date: date, closing_day: int, due_day: int) -> date:
    """Mês da fatura que recebe a compra: a primeira que fecha depois da data da compra (A6).

    Compra no próprio dia do fechamento já cai na fatura seguinte.
    """
    month = add_months(date(purchase_date.year, purchase_date.month, 1), -1)
    while invoice_dates(month, closing_day, due_day)[0] <= purchase_date:
        month = add_months(month, 1)
    return month


def split_installments(total: Decimal, count: int) -> list[Decimal]:
    """Divide em parcelas truncadas nos centavos; o resto vai na primeira (A10)."""
    if not MIN_INSTALLMENTS <= count <= MAX_INSTALLMENTS:
        raise ValueError(f"Parcelas devem estar entre {MIN_INSTALLMENTS} e {MAX_INSTALLMENTS}.")
    part = (total / count).quantize(CENT, rounding=ROUND_DOWN)
    first = total - part * (count - 1)
    return [first, *([part] * (count - 1))]


def consumption_month(purchase_date: date, installment_number: int) -> date:
    """Mês em que a parcela k conta no consumo: o mês da compra mais k−1 meses (A3)."""
    return add_months(date(purchase_date.year, purchase_date.month, 1), installment_number - 1)
