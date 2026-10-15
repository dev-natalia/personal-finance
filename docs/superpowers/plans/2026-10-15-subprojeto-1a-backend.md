# Subprojeto 1A — Backend de fundação e lançamentos: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o backend do subprojeto 1 — autenticação, contas, categorias, lançamentos via conta (receita, despesa, transferência, estorno), idempotência, auditoria, consultas e API REST — testado contra PostgreSQL real.

**Architecture:** Monorepo com `backend/` em camadas: `app/domain` (regras puras, sem I/O) → `app/services` (casos de uso; cada chamada roda dentro da transação do banco aberta pela rota, com auditoria na mesma transação) → `app/repositories.py` (escopo por usuária) → `app/api` (rotas finas, schemas Pydantic, erros em Problem Details). O frontend (plano 1B) virá depois e consumirá esta API.

**Tech Stack:** Python ≥ 3.14, uv, FastAPI, SQLAlchemy 2 (síncrono) + psycopg 3, Alembic, Pydantic 2 + pydantic-settings, pwdlib (argon2id), pytest + Hypothesis, ruff, mypy, PostgreSQL 17 via docker compose.

**Spec:** `docs/superpowers/specs/2026-10-15-fundacao-e-lancamentos-design.md` (e as decisões globais em `docs/superpowers/specs/2026-10-15-visao-geral-design.md`).

## Global Constraints

- Python `>=3.14`; dependências com os pisos de versão listados em `backend/pyproject.toml` (Tarefa 1).
- Dinheiro: `Decimal` no Python, `NUMERIC(14,2)` no banco, **string** no JSON (`"42.50"`); arredondamento `ROUND_HALF_UP` só via `app.domain.money.quantize`; nenhum `float` em `app/domain`.
- Valores de transação sempre positivos (`CHECK (amount > 0)`); o tipo define a direção.
- Nada é apagado fisicamente: transações são anuladas (`VOIDED`), contas e categorias arquivadas.
- Todo acesso a dados filtra por `user_id`; recurso de outra usuária responde 404 (`not_found`), nunca 403.
- Identificadores (código, tabelas, colunas, `code` de erro) em inglês; mensagens para a usuária (`detail`) em português.
- Variáveis de ambiente: `DATABASE_URL`, `SECRET_KEY` (≥ 32 caracteres), `APP_ORIGIN`, `COOKIE_SECURE`, `ENABLE_DOCS`, `LOG_LEVEL`. A aplicação não inicia sem as três primeiras.
- Logs nunca contêm corpo de requisição, valores, descrições, cookies ou parâmetros SQL (`hide_parameters=True`).
- Erros HTTP em Problem Details (`application/problem+json`) com `code` estável.
- Banco de desenvolvimento: `finance` na porta **5433**; banco de testes: `finance_test` (criado pelo docker compose).
- Comandos `uv run ...` são executados a partir de `backend/`; comandos `docker compose` e `git` a partir da raiz. No Windows, use o Git Bash.
- Antes de cada verificação completa, rode `uv run ruff format . && uv run ruff check --fix .` (em `backend/`): o código deste plano pode não estar exatamente na formatação do ruff, e o `check.sh` usa `ruff format --check`.
- Todo commit termina com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (passe um segundo `-m` com ela).

### Ajustes de implementação em relação à spec (deliberados)

- `users.email` é guardado já normalizado em minúsculas em coluna `VARCHAR` única, em vez de `citext` — evita depender de extensão em Postgres gerenciado; o efeito (e-mail sem diferenciar maiúsculas) é o mesmo.
- `sessions.token_hash` é `HMAC-SHA256(SECRET_KEY, token)` em vez de SHA-256 puro — mais forte e dá uso ao `SECRET_KEY` exigido pela spec.
- `login_attempts.ip` é `VARCHAR(64)` em vez de `inet` — o valor vem do servidor ASGI e só é comparado por igualdade.
- Para receitas e despesas, quando `merchant` não é enviado, a **descrição** é usada como nome do estabelecimento — é o que o interpretador da tela inicial produz (`42 mercado` → descrição e estabelecimento "mercado") e é o que faz a memória de categoria funcionar.
- A memória de categoria só aprende quando `category_id` é enviado explicitamente e a categoria não é de sistema. O frontend (plano 1B) só envia `category_id` quando a usuária altera a sugestão — isso cumpre "sugestão aceita sem alteração não muda nada".
- Ao alterar a categoria de uma despesa, os estornos dela passam para a nova categoria (com auditoria), para que o consumo por categoria continue coerente.

## Review Focus

1. **Lançamento perto da meia-noite** — às 23h30 em São Paulo (02h30 UTC do dia seguinte), "hoje" deve ser o dia local. Teste: Tarefa 3 (`test_today_uses_user_timezone_near_midnight`) e Tarefa 14 (`test_entry_hints_today_uses_user_timezone`).
2. **Clique duplo / corrida com a mesma `Idempotency-Key`** — a segunda requisição que perde a corrida no `INSERT` deve devolver o lançamento existente, não um 409 genérico nem um 500. Teste: Tarefa 10 (`test_idempotency_race_returns_existing`).
3. **Categoria memorizada que foi arquivada** — um estabelecimento cuja categoria padrão foi arquivada deve cair em "A classificar", nunca gravar em categoria arquivada. Teste: Tarefa 10 (`test_archived_default_category_falls_back_to_unclassified`).
4. **Valor monetário gigante ou malformado na API** — `"1000000000000.00"`, `42` (número JSON) ou `"1.005"` devem dar 422, nunca 500 por estouro de `NUMERIC(14,2)`. Teste: Tarefa 13 (`test_money_must_be_string_with_two_decimals`) e Tarefa 14 (`test_amount_too_large_is_422`).
5. **E-mail com maiúsculas/espaços no login** — `"  ANA@Example.com"` deve autenticar a mesma usuária. Teste: Tarefa 6 (`test_login_is_case_insensitive_on_email`).

---

## Mapa de arquivos

```
docker-compose.yml                      Postgres 17 (dev + testes)
docker/postgres-init/01-create-test-db.sql
.gitattributes
scripts/check.sh                        lint + tipos + testes
README.md                               como rodar (Tarefa 15)
backend/
  pyproject.toml  alembic.ini  .env.example
  migrations/env.py  migrations/script.py.mako  migrations/versions/0001_initial_schema.py
  app/
    __init__.py            versão
    config.py              Settings (pydantic-settings)
    db.py                  engine e sessionmaker
    main.py                create_app()
    cli.py                 create-user, set-password, revoke-sessions
    repositories.py        owned_select, get_owned
    domain/
      money.py  dates.py  merchants.py  categorization.py  errors.py
    models/
      __init__.py  base.py  user.py  account.py  category.py  merchant.py  transaction.py  audit.py
    services/
      context.py   RequestContext
      audit.py     snapshot, jsonable, record
      users.py     create_user, set_password, hash/verify
      auth.py      login, authenticate, logout, revoke_all
      categories.py  accounts.py  merchants.py
      ledger.py    saldos, consumo, lista, duplicatas, atalhos (única fonte de indicadores)
      transactions.py  criar, estornar, editar, anular
    api/
      deps.py  errors.py  middleware.py
      schemas/  common.py auth.py accounts.py categories.py merchants.py transactions.py entry.py summaries.py
      routes/   __init__.py health.py auth.py accounts.py categories.py merchants.py transactions.py entry.py summaries.py
  tests/
    conftest.py  support.py
    domain/   test_money.py test_dates.py test_merchants.py test_categorization.py
    services/ test_users.py test_auth.py test_cli.py test_accounts.py test_categories.py test_ledger.py
              test_transactions_create.py test_transactions_changes.py
    api/      conftest.py test_auth_api.py test_accounts_api.py test_transactions_api.py
    test_smoke.py  test_config.py  test_migrations.py
```

---

### Task 1: Fundação do repositório

**Files:**
- Create: `docker-compose.yml`, `docker/postgres-init/01-create-test-db.sql`, `.gitattributes`, `scripts/check.sh`
- Create: `backend/pyproject.toml`, `backend/.env.example`, `backend/app/__init__.py`
- Create: `backend/tests/__init__.py`, `backend/tests/domain/__init__.py`, `backend/tests/services/__init__.py`, `backend/tests/api/__init__.py`
- Test: `backend/tests/test_smoke.py`

**Interfaces:**
- Produces: pacote `app` com `app.__version__ == "0.1.0"`; Postgres em `localhost:5433` com bancos `finance` e `finance_test` (usuário/senha `finance`); `bash scripts/check.sh` roda ruff, mypy e pytest.

- [ ] **Step 1: Criar `docker-compose.yml` (raiz)**

```yaml
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_USER: finance
      POSTGRES_PASSWORD: finance
      POSTGRES_DB: finance
    ports:
      - "5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/postgres-init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U finance -d finance"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  pgdata:
```

- [ ] **Step 2: Criar `docker/postgres-init/01-create-test-db.sql`**

```sql
CREATE DATABASE finance_test;
```

- [ ] **Step 3: Criar `.gitattributes` (raiz)**

```
* text=auto eol=lf
*.ps1 text eol=crlf
```

- [ ] **Step 4: Criar `backend/pyproject.toml`**

```toml
[project]
name = "personal-finance-backend"
version = "0.1.0"
description = "Backend do Assistente Financeiro Pessoal"
requires-python = ">=3.14"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.32",
  "sqlalchemy>=2.0.40",
  "alembic>=1.16",
  "psycopg[binary]>=3.2.10",
  "pydantic>=2.12",
  "pydantic-settings>=2.6",
  "pwdlib[argon2]>=0.2.1",
  "tzdata>=2025.2",
]

[dependency-groups]
dev = [
  "pytest>=8.3",
  "hypothesis>=6.120",
  "httpx>=0.28",
  "ruff>=0.12",
  "mypy>=1.13",
]

[tool.uv]
package = false

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
addopts = "-ra"

[tool.ruff]
line-length = 100
target-version = "py314"
extend-exclude = ["migrations/versions"]

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "SIM", "RUF"]
# E501: o formatter cuida das linhas de código; textos em português podem passar de 100.
# RUF001-003: caracteres como "º" e "±" são intencionais nos textos em português.
ignore = ["E501", "RUF001", "RUF002", "RUF003"]

[tool.mypy]
python_version = "3.14"
plugins = ["pydantic.mypy"]
check_untyped_defs = true

[[tool.mypy.overrides]]
module = "app.domain.*"
disallow_untyped_defs = true
disallow_incomplete_defs = true
disallow_any_generics = true
warn_return_any = true
```

`tzdata` é obrigatório: no Windows o `zoneinfo` não encontra os fusos sem ele.

- [ ] **Step 5: Criar `backend/.env.example`**

```
DATABASE_URL=postgresql+psycopg://finance:finance@localhost:5433/finance
SECRET_KEY=troque-por-uma-chave-aleatoria-com-pelo-menos-32-caracteres
APP_ORIGIN=http://localhost:8000
COOKIE_SECURE=false
ENABLE_DOCS=true
LOG_LEVEL=INFO
```

- [ ] **Step 6: Criar o pacote e os pacotes de teste**

`backend/app/__init__.py`:

```python
"""Assistente Financeiro Pessoal — backend."""

__version__ = "0.1.0"
```

Criar vazios: `backend/tests/__init__.py`, `backend/tests/domain/__init__.py`, `backend/tests/services/__init__.py`, `backend/tests/api/__init__.py`.

- [ ] **Step 7: Escrever o teste de fumaça `backend/tests/test_smoke.py`**

```python
import app


def test_package_version() -> None:
    assert app.__version__ == "0.1.0"
```

- [ ] **Step 8: Criar `scripts/check.sh`**

```bash
#!/usr/bin/env bash
# Roda lint, checagem de tipos e testes do backend. Requer o Postgres do docker compose no ar.
set -euo pipefail
cd "$(dirname "$0")/../backend"
uv run ruff check .
uv run ruff format --check .
uv run mypy app
uv run pytest -q
```

- [ ] **Step 9: Instalar dependências e subir o banco**

Run (em `backend/`): `uv sync`
Expected: cria `backend/.venv` e `backend/uv.lock` sem erros.

Run (na raiz): `docker compose up -d db` e depois `docker compose ps`
Expected: serviço `db` com status `healthy` (repita o `ps` até ficar healthy).

- [ ] **Step 10: Rodar a verificação completa**

Run (na raiz): `bash scripts/check.sh`
Expected: ruff sem erros, mypy `Success`, pytest `1 passed`.

- [ ] **Step 11: Commit**

```bash
git add docker-compose.yml docker .gitattributes scripts backend/pyproject.toml backend/uv.lock backend/.env.example backend/app backend/tests
git commit -m "chore: fundação do backend (uv, docker compose, check)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Domínio — dinheiro

**Files:**
- Create: `backend/app/domain/__init__.py` (vazio), `backend/app/domain/money.py`
- Test: `backend/tests/domain/test_money.py`

**Interfaces:**
- Produces: `CENT: Decimal`, `MAX_AMOUNT: Decimal` (`999999999999.99`), `class InvalidMoney(ValueError)`, `quantize(value: Decimal) -> Decimal`, `parse_money(text: str) -> Decimal`, `format_brl(value: Decimal) -> str` (`"R$ 1.234,56"`, negativo `"-R$ 1.234,56"`), `to_api(value: Decimal) -> str` (`"1234.56"`).

- [ ] **Step 1: Escrever os testes que falham**

`backend/tests/domain/test_money.py`:

```python
from decimal import Decimal
from pathlib import Path

import pytest
from hypothesis import given
from hypothesis import strategies as st

from app.domain.money import MAX_AMOUNT, InvalidMoney, format_brl, parse_money, quantize, to_api


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("42", "42.00"),
        ("42,5", "42.50"),
        ("42,50", "42.50"),
        ("42.50", "42.50"),
        ("42.5", "42.50"),
        ("1.234", "1234.00"),
        ("1.234,56", "1234.56"),
        ("12.345.678,90", "12345678.90"),
        ("R$ 42", "42.00"),
        ("r$42,10", "42.10"),
        ("  7 ", "7.00"),
        ("0,01", "0.01"),
        ("1234", "1234.00"),
        ("1234,5", "1234.50"),
    ],
)
def test_parse_money_accepts(text: str, expected: str) -> None:
    assert parse_money(text) == Decimal(expected)


@pytest.mark.parametrize(
    "text",
    [
        "",
        "abc",
        "42,505",
        "42.505.1",
        "1.2345",
        "1234.567",
        ",50",
        "42,",
        "42.",
        "1,2,3",
        "-5",
        "12.34,56",
        "1.23.456",
        "999.999.999.999,991",
        "1.000.000.000.000,00",
        "٤٢",
    ],
)
def test_parse_money_rejects(text: str) -> None:
    with pytest.raises(InvalidMoney):
        parse_money(text)


def test_quantize_rounds_half_up() -> None:
    assert quantize(Decimal("0.005")) == Decimal("0.01")
    assert quantize(Decimal("2.345")) == Decimal("2.35")
    assert quantize(Decimal("-2.345")) == Decimal("-2.35")


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("0", "R$ 0,00"),
        ("42.5", "R$ 42,50"),
        ("1234.56", "R$ 1.234,56"),
        ("-1234.56", "-R$ 1.234,56"),
        ("1000000", "R$ 1.000.000,00"),
    ],
)
def test_format_brl(value: str, expected: str) -> None:
    assert format_brl(Decimal(value)) == expected


def test_to_api() -> None:
    assert to_api(Decimal("42.5")) == "42.50"
    assert to_api(Decimal("-3")) == "-3.00"
    assert to_api(Decimal("-0.001")) == "0.00"


@given(st.decimals(min_value=Decimal("0"), max_value=MAX_AMOUNT, places=2))
def test_format_then_parse_roundtrip(value: Decimal) -> None:
    assert parse_money(format_brl(value)) == value


def test_domain_never_uses_binary_floating_point() -> None:
    domain_dir = Path(__file__).resolve().parents[2] / "app" / "domain"
    offenders = [p.name for p in domain_dir.glob("*.py") if "float" in p.read_text(encoding="utf-8")]
    assert offenders == []
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `uv run pytest tests/domain/test_money.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.domain'`.

- [ ] **Step 3: Implementar `backend/app/domain/money.py`**

Atenção: a palavra "float" não pode aparecer em nenhum arquivo de `app/domain` (o último teste verifica isso).

```python
"""Operações com dinheiro. Sempre Decimal, nunca ponto flutuante binário."""

import re
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

CENT = Decimal("0.01")
MAX_AMOUNT = Decimal("999999999999.99")

_PREFIX = re.compile(r"^r\$\s*", re.IGNORECASE)
_ALLOWED = re.compile(r"[0-9.,]+")
_DIGITS = re.compile(r"[0-9]+")
_THOUSANDS = re.compile(r"[0-9]{1,3}(?:\.[0-9]{3})+")


class InvalidMoney(ValueError):
    """Texto que não representa um valor monetário válido."""


def quantize(value: Decimal) -> Decimal:
    """Arredonda para centavos com ROUND_HALF_UP (meio centavo arredonda para longe do zero)."""
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def _integer_part(text: str) -> str:
    if _DIGITS.fullmatch(text):
        return text
    if _THOUSANDS.fullmatch(text):
        return text.replace(".", "")
    raise InvalidMoney(f"Parte inteira inválida: {text!r}.")


def parse_money(text: str) -> Decimal:
    """Interpreta valores digitados em pt-BR: 42 · 42,50 · 42.50 · 1.234,56 · R$ 42.

    Regras: com vírgula, ela é o separador decimal e pontos são de milhar. Sem vírgula,
    um único ponto seguido de 1 ou 2 dígitos é decimal; seguido de 3 dígitos é milhar.
    Mais de 2 casas decimais é rejeitado (nunca arredondado em silêncio).
    """
    cleaned = _PREFIX.sub("", text.strip())
    if not cleaned or not _ALLOWED.fullmatch(cleaned):
        raise InvalidMoney(f"Valor inválido: {text!r}.")

    if "," in cleaned:
        integer, _, decimals = cleaned.partition(",")
        if not decimals or not _DIGITS.fullmatch(decimals):
            raise InvalidMoney(f"Valor inválido: {text!r}.")
        if len(decimals) > 2:
            raise InvalidMoney("O valor tem mais de 2 casas decimais.")
        normalized = f"{_integer_part(integer)}.{decimals}"
    elif cleaned.count(".") == 1:
        integer, _, fraction = cleaned.partition(".")
        if not integer:
            raise InvalidMoney(f"Valor inválido: {text!r}.")
        if len(fraction) in (1, 2):
            normalized = f"{integer}.{fraction}"
        elif len(fraction) == 3 and len(integer) <= 3:
            normalized = integer + fraction
        else:
            raise InvalidMoney(f"Valor inválido: {text!r}.")
    else:
        normalized = _integer_part(cleaned)

    try:
        value = Decimal(normalized)
    except InvalidOperation as exc:
        raise InvalidMoney(f"Valor inválido: {text!r}.") from exc
    if value > MAX_AMOUNT:
        raise InvalidMoney("Valor acima do máximo permitido.")
    return quantize(value)


def format_brl(value: Decimal) -> str:
    """Formata em reais: R$ 1.234,56 (negativos com '-' antes de 'R$')."""
    q = quantize(value) + Decimal(0)
    sign = "-" if q < 0 else ""
    integer, _, cents = f"{abs(q):.2f}".partition(".")
    groups: list[str] = []
    while len(integer) > 3:
        groups.insert(0, integer[-3:])
        integer = integer[:-3]
    groups.insert(0, integer)
    return f"{sign}R$ {'.'.join(groups)},{cents}"


def to_api(value: Decimal) -> str:
    """Representação canônica para JSON: '1234.56'."""
    return f"{quantize(value) + Decimal(0):.2f}"
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `uv run pytest tests/domain/test_money.py -v`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add backend/app/domain backend/tests/domain/test_money.py
git commit -m "feat(domain): interpretação, arredondamento e formatação de dinheiro" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Domínio — datas, estabelecimentos, categorização e erros

**Files:**
- Create: `backend/app/domain/dates.py`, `backend/app/domain/merchants.py`, `backend/app/domain/categorization.py`, `backend/app/domain/errors.py`
- Test: `backend/tests/domain/test_dates.py`, `backend/tests/domain/test_merchants.py`, `backend/tests/domain/test_categorization.py`

**Interfaces:**
- Produces (`dates`): `class Clock(Protocol): def now(self) -> datetime`, `SystemClock`, `FixedClock(at: datetime)` (exige fuso), `today(clock: Clock, timezone: str) -> date`, `month_range(year: int, month: int) -> tuple[date, date]` (inclusivo), `parse_month(text: str) -> tuple[int, int]` (levanta `ValueError`).
- Produces (`merchants`): `normalize(name: str) -> str`.
- Produces (`categorization`): `resolve_category(explicit: UUID | None, merchant_default: UUID | None, unclassified: UUID) -> UUID`.
- Produces (`errors`): `DomainError(code: str, detail: str)` com atributos `code`, `detail`; subclasses `NotFound(what: str)` (detail `"Não encontramos {what}."`), `RuleViolation(code, detail)`, `Conflict(code, detail)`, `Unauthenticated(code="unauthenticated", detail=...)`, `TooManyAttempts()`; `@dataclass(frozen=True) Notice(code: str, detail: str)`.

- [ ] **Step 1: Escrever os testes que falham**

`backend/tests/domain/test_dates.py`:

```python
from datetime import UTC, date, datetime

import pytest

from app.domain.dates import FixedClock, SystemClock, month_range, parse_month, today


def test_today_uses_user_timezone_near_midnight() -> None:
    clock = FixedClock(datetime(2026, 10, 16, 2, 30, tzinfo=UTC))  # 23h30 de 15/10 em São Paulo
    assert today(clock, "America/Sao_Paulo") == date(2026, 10, 15)
    assert today(clock, "UTC") == date(2026, 10, 16)


def test_fixed_clock_requires_timezone() -> None:
    with pytest.raises(ValueError):
        FixedClock(datetime(2026, 10, 15, 12, 0))


def test_system_clock_is_timezone_aware() -> None:
    assert SystemClock().now().tzinfo is not None


@pytest.mark.parametrize(
    ("year", "month", "expected"),
    [
        (2026, 10, (date(2026, 10, 1), date(2026, 10, 31))),
        (2026, 2, (date(2026, 2, 1), date(2026, 2, 28))),
        (2028, 2, (date(2028, 2, 1), date(2028, 2, 29))),
    ],
)
def test_month_range(year: int, month: int, expected: tuple[date, date]) -> None:
    assert month_range(year, month) == expected


def test_parse_month_accepts_iso_month() -> None:
    assert parse_month("2026-10") == (2026, 10)


@pytest.mark.parametrize("text", ["2026-13", "2026-00", "26-10", "2026/10", "abc", ""])
def test_parse_month_rejects(text: str) -> None:
    with pytest.raises(ValueError):
        parse_month(text)
```

`backend/tests/domain/test_merchants.py`:

```python
import pytest

from app.domain.merchants import normalize


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("DROGASIL", "drogasil"),
        ("drogasil", "drogasil"),
        ("Pão de Açúcar", "pao de acucar"),
        ("  Uber   Eats! ", "uber eats"),
        ("D'Ávila", "d avila"),
        ("!!!", ""),
        ("Drogasil SP", "drogasil sp"),
    ],
)
def test_normalize(raw: str, expected: str) -> None:
    assert normalize(raw) == expected


def test_different_names_stay_different() -> None:
    assert normalize("Drogasil SP") != normalize("Drogasil")
```

`backend/tests/domain/test_categorization.py`:

```python
from uuid import uuid4

from app.domain.categorization import resolve_category

EXPLICIT, DEFAULT, UNCLASSIFIED = uuid4(), uuid4(), uuid4()


def test_explicit_wins() -> None:
    assert resolve_category(EXPLICIT, DEFAULT, UNCLASSIFIED) == EXPLICIT


def test_merchant_default_when_no_explicit() -> None:
    assert resolve_category(None, DEFAULT, UNCLASSIFIED) == DEFAULT


def test_unclassified_as_last_resort() -> None:
    assert resolve_category(None, None, UNCLASSIFIED) == UNCLASSIFIED
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `uv run pytest tests/domain -v`
Expected: FAIL — `ModuleNotFoundError` para `app.domain.dates`, `app.domain.merchants`, `app.domain.categorization`.

- [ ] **Step 3: Implementar os módulos**

`backend/app/domain/dates.py`:

```python
"""Datas no fuso da usuária e relógio injetável."""

import calendar
import re
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Protocol
from zoneinfo import ZoneInfo

_MONTH = re.compile(r"([0-9]{4})-([0-9]{2})")


class Clock(Protocol):
    def now(self) -> datetime: ...


class SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


@dataclass(frozen=True)
class FixedClock:
    at: datetime

    def __post_init__(self) -> None:
        if self.at.tzinfo is None:
            raise ValueError("FixedClock exige datetime com fuso horário.")

    def now(self) -> datetime:
        return self.at


def today(clock: Clock, timezone: str) -> date:
    """Data local da usuária no instante atual do relógio."""
    return clock.now().astimezone(ZoneInfo(timezone)).date()


def month_range(year: int, month: int) -> tuple[date, date]:
    """Primeiro e último dia do mês (inclusivos)."""
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last_day)


def parse_month(text: str) -> tuple[int, int]:
    """Converte 'AAAA-MM' em (ano, mês)."""
    match = _MONTH.fullmatch(text)
    if match is None:
        raise ValueError("O mês deve estar no formato AAAA-MM.")
    year, month = int(match.group(1)), int(match.group(2))
    if not 1 <= month <= 12:
        raise ValueError("Mês inválido.")
    return year, month
```

`backend/app/domain/merchants.py`:

```python
"""Normalização determinística de nomes de estabelecimento."""

import re
import unicodedata

_PUNCTUATION = re.compile(r"[^\w\s]")
_SPACES = re.compile(r"\s+")


def normalize(name: str) -> str:
    """Minúsculas, sem acentos, sem pontuação e com espaços compactados.

    'DROGASIL' e 'drogasil' viram o mesmo; 'Drogasil SP' continua diferente de 'Drogasil'.
    """
    decomposed = unicodedata.normalize("NFKD", name.casefold())
    without_accents = "".join(c for c in decomposed if not unicodedata.combining(c))
    without_punctuation = _PUNCTUATION.sub(" ", without_accents)
    return _SPACES.sub(" ", without_punctuation).strip()
```

`backend/app/domain/categorization.py`:

```python
"""Ordem de escolha da categoria de um lançamento."""

from uuid import UUID


def resolve_category(
    explicit: UUID | None, merchant_default: UUID | None, unclassified: UUID
) -> UUID:
    """Explícita → padrão do estabelecimento → 'A classificar'."""
    if explicit is not None:
        return explicit
    if merchant_default is not None:
        return merchant_default
    return unclassified
```

`backend/app/domain/errors.py`:

```python
"""Erros de domínio com código estável e avisos não bloqueantes."""

from dataclasses import dataclass


class DomainError(Exception):
    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail


class NotFound(DomainError):
    def __init__(self, what: str = "o recurso") -> None:
        super().__init__("not_found", f"Não encontramos {what}.")


class RuleViolation(DomainError):
    """Regra de negócio violada (HTTP 422)."""


class Conflict(DomainError):
    """Conflito com dados existentes (HTTP 409)."""


class Unauthenticated(DomainError):
    def __init__(
        self, code: str = "unauthenticated", detail: str = "Sessão inválida ou expirada."
    ) -> None:
        super().__init__(code, detail)


class TooManyAttempts(DomainError):
    def __init__(self) -> None:
        super().__init__(
            "too_many_attempts", "Muitas tentativas. Tente novamente em alguns minutos."
        )


@dataclass(frozen=True)
class Notice:
    """Aviso que acompanha uma operação bem-sucedida (ex.: saldo negativo)."""

    code: str
    detail: str
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `uv run pytest tests/domain -v`
Expected: PASS (todos, incluindo os de dinheiro).

- [ ] **Step 5: Commit**

```bash
git add backend/app/domain backend/tests/domain
git commit -m "feat(domain): datas no fuso da usuária, estabelecimentos, categorização e erros" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Configuração, banco, modelos e migração inicial

**Files:**
- Create: `backend/app/config.py`, `backend/app/db.py`
- Create: `backend/app/models/__init__.py`, `base.py`, `user.py`, `account.py`, `category.py`, `merchant.py`, `transaction.py`, `audit.py`
- Create: `backend/alembic.ini`, `backend/migrations/env.py`, `backend/migrations/script.py.mako`, `backend/migrations/versions/0001_initial_schema.py` (gerado)
- Create: `backend/tests/conftest.py`
- Test: `backend/tests/test_config.py`, `backend/tests/test_migrations.py`

**Interfaces:**
- Produces: `Settings` (`database_url: str`, `secret_key: SecretStr`, `app_origin: str`, `cookie_secure: bool = True`, `enable_docs: bool = False`, `session_idle_days: int = 30`, `session_max_days: int = 90`, `log_level: str = "INFO"`), `get_settings() -> Settings`.
- Produces: `make_engine(url: str) -> Engine`, `make_sessionmaker(engine: Engine) -> sessionmaker[Session]`.
- Produces (models, todos exportados por `app.models`): `Base`, `OwnedModel` (abstrata: `id: UUID` uuid7, `user_id: UUID`, `created_at`, `updated_at`), `User`, `UserSession`, `LoginAttempt`, `Account`, `AccountType`, `Category`, `CategoryKind`, `Merchant`, `Transaction`, `TransactionType`, `PaymentMethod`, `TransactionStatus`, `TransactionSource`, `AuditLog`, `AuditAction`, `Actor`, `DEFAULT_TIMEZONE`.
- Produces (testes): fixtures `engine` (sessão de teste; banco recriado e migrado) e `db` (uma `Session` por teste, desfeita ao final); `TEST_DATABASE_URL`; `alembic_config(url) -> Config`.

- [ ] **Step 1: Escrever os testes de configuração que falham**

`backend/tests/test_config.py`:

```python
import pytest
from pydantic import ValidationError

from app.config import Settings

VALID = {
    "database_url": "postgresql+psycopg://u:p@localhost:5433/db",
    "secret_key": "x" * 32,
    "app_origin": "https://financas.example.com",
}


def test_settings_load_with_required_values() -> None:
    settings = Settings(_env_file=None, **VALID)
    assert settings.cookie_secure is True
    assert settings.enable_docs is False
    assert settings.session_idle_days == 30
    assert settings.session_max_days == 90


def test_settings_require_database_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DATABASE_URL", raising=False)
    values = {k: v for k, v in VALID.items() if k != "database_url"}
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **values)


def test_settings_reject_short_secret() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **{**VALID, "secret_key": "curta"})
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `uv run pytest tests/test_config.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.config'`.

- [ ] **Step 3: Implementar `backend/app/config.py` e `backend/app/db.py`**

`backend/app/config.py`:

```python
"""Configuração por variáveis de ambiente (ou arquivo .env em desenvolvimento)."""

from functools import lru_cache

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    secret_key: SecretStr
    app_origin: str
    cookie_secure: bool = True
    enable_docs: bool = False
    session_idle_days: int = 30
    session_max_days: int = 90
    log_level: str = "INFO"

    @field_validator("secret_key")
    @classmethod
    def _secret_long_enough(cls, value: SecretStr) -> SecretStr:
        if len(value.get_secret_value()) < 32:
            raise ValueError("SECRET_KEY deve ter pelo menos 32 caracteres.")
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
```

`backend/app/db.py`:

```python
"""Engine e fábrica de sessões do SQLAlchemy."""

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker


def make_engine(url: str) -> Engine:
    # hide_parameters: valores financeiros nunca aparecem em mensagens de erro/log do SQLAlchemy.
    return create_engine(url, pool_pre_ping=True, hide_parameters=True)


def make_sessionmaker(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)
```

- [ ] **Step 4: Rodar os testes de configuração**

Run: `uv run pytest tests/test_config.py -v`
Expected: PASS (3).

- [ ] **Step 5: Implementar os modelos**

`backend/app/models/base.py`:

```python
"""Base declarativa, convenções de nomes e mixins."""

import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import DateTime, Enum, ForeignKey, MetaData, Numeric, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    type_annotation_map = {
        Decimal: Numeric(14, 2),
        datetime: DateTime(timezone=True),
    }


def enum_type(enum_cls: type[StrEnum], name: str) -> Enum:
    """Enum guardado como VARCHAR + CHECK (mais simples de migrar que tipos nativos)."""
    return Enum(
        enum_cls,
        native_enum=False,
        length=20,
        name=name,
        create_constraint=True,
        validate_strings=True,
    )


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class OwnedModel(TimestampMixin, Base):
    """Entidade com id UUID (v7, ordenado no tempo) que pertence a uma usuária."""

    __abstract__ = True

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid7)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
```

`backend/app/models/user.py`:

```python
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, ForeignKey, Identity, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

DEFAULT_TIMEZONE = "America/Sao_Paulo"


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid7)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    timezone: Mapped[str] = mapped_column(
        String(64), default=DEFAULT_TIMEZONE, server_default=DEFAULT_TIMEZONE
    )


class UserSession(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid7)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[bytes] = mapped_column(LargeBinary(32), unique=True)
    created_at: Mapped[datetime]
    expires_at: Mapped[datetime]
    last_seen_at: Mapped[datetime]
    revoked_at: Mapped[datetime | None]


class LoginAttempt(Base):
    __tablename__ = "login_attempts"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    email_normalized: Mapped[str] = mapped_column(String(320), index=True)
    ip: Mapped[str] = mapped_column(String(64), index=True)
    succeeded: Mapped[bool]
    attempted_at: Mapped[datetime] = mapped_column(index=True)
```

`backend/app/models/account.py`:

```python
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import OwnedModel, enum_type


class AccountType(StrEnum):
    CHECKING = "CHECKING"
    SAVINGS = "SAVINGS"
    CASH = "CASH"


class Account(OwnedModel):
    __tablename__ = "accounts"
    __table_args__ = (UniqueConstraint("user_id", "name"),)

    name: Mapped[str] = mapped_column(String(80))
    type: Mapped[AccountType] = mapped_column(enum_type(AccountType, "account_type"))
    opening_balance: Mapped[Decimal]
    opening_date: Mapped[date]
    archived_at: Mapped[datetime | None]
```

`backend/app/models/category.py`:

```python
from datetime import datetime
from enum import StrEnum

from sqlalchemy import String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import OwnedModel, enum_type


class CategoryKind(StrEnum):
    EXPENSE = "EXPENSE"
    INCOME = "INCOME"


class Category(OwnedModel):
    __tablename__ = "categories"
    __table_args__ = (UniqueConstraint("user_id", "kind", "name"),)

    name: Mapped[str] = mapped_column(String(60))
    kind: Mapped[CategoryKind] = mapped_column(enum_type(CategoryKind, "category_kind"))
    is_essential: Mapped[bool] = mapped_column(default=False)
    is_system: Mapped[bool] = mapped_column(default=False)
    archived_at: Mapped[datetime | None]
```

`backend/app/models/merchant.py`:

```python
import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import OwnedModel


class Merchant(OwnedModel):
    __tablename__ = "merchants"
    __table_args__ = (UniqueConstraint("user_id", "normalized_name"),)

    name: Mapped[str] = mapped_column(String(120))
    normalized_name: Mapped[str] = mapped_column(String(120))
    default_category_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL")
    )
```

`backend/app/models/transaction.py`:

```python
import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import CheckConstraint, ForeignKey, Index, LargeBinary, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import OwnedModel, enum_type


class TransactionType(StrEnum):
    INCOME = "INCOME"
    EXPENSE = "EXPENSE"
    TRANSFER = "TRANSFER"
    REFUND = "REFUND"


class PaymentMethod(StrEnum):
    PIX = "PIX"
    DEBIT = "DEBIT"
    CASH = "CASH"
    BOLETO = "BOLETO"
    OTHER = "OTHER"


class TransactionStatus(StrEnum):
    CONFIRMED = "CONFIRMED"
    VOIDED = "VOIDED"


class TransactionSource(StrEnum):
    MANUAL = "MANUAL"
    AI = "AI"
    IMPORT = "IMPORT"


# Colunas obrigatórias/proibidas por tipo. O service valida antes; isto é a rede de segurança.
SHAPE_BY_TYPE = """
(type = 'INCOME' AND category_id IS NOT NULL AND destination_account_id IS NULL
    AND payment_method IS NULL AND refund_of_id IS NULL)
OR (type = 'EXPENSE' AND category_id IS NOT NULL AND payment_method IS NOT NULL
    AND destination_account_id IS NULL AND refund_of_id IS NULL)
OR (type = 'TRANSFER' AND destination_account_id IS NOT NULL
    AND destination_account_id <> account_id AND category_id IS NULL
    AND payment_method IS NULL AND refund_of_id IS NULL AND merchant_id IS NULL)
OR (type = 'REFUND' AND refund_of_id IS NOT NULL AND category_id IS NOT NULL
    AND destination_account_id IS NULL AND payment_method IS NULL)
"""


class Transaction(OwnedModel):
    __tablename__ = "transactions"
    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint(SHAPE_BY_TYPE, name="shape_by_type"),
        CheckConstraint(
            "(idempotency_key IS NULL) = (idempotency_payload_hash IS NULL)",
            name="idempotency_pair",
        ),
        CheckConstraint(
            "(status = 'VOIDED') = (voided_at IS NOT NULL)", name="voided_at_matches_status"
        ),
        UniqueConstraint("user_id", "idempotency_key"),
        Index("ix_transactions_user_date", "user_id", "occurred_on", "id"),
        Index("ix_transactions_user_account_date", "user_id", "account_id", "occurred_on"),
        Index("ix_transactions_user_destination", "user_id", "destination_account_id"),
        Index("ix_transactions_user_category_date", "user_id", "category_id", "occurred_on"),
    )

    type: Mapped[TransactionType] = mapped_column(enum_type(TransactionType, "transaction_type"))
    amount: Mapped[Decimal]
    occurred_on: Mapped[date]
    description: Mapped[str] = mapped_column(String(200))
    notes: Mapped[str | None] = mapped_column(String(1000))
    merchant_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("merchants.id"))
    category_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("categories.id"))
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id"))
    destination_account_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("accounts.id"))
    payment_method: Mapped[PaymentMethod | None] = mapped_column(
        enum_type(PaymentMethod, "payment_method")
    )
    refund_of_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("transactions.id"), index=True
    )
    status: Mapped[TransactionStatus] = mapped_column(
        enum_type(TransactionStatus, "transaction_status"), default=TransactionStatus.CONFIRMED
    )
    source: Mapped[TransactionSource] = mapped_column(
        enum_type(TransactionSource, "transaction_source"), default=TransactionSource.MANUAL
    )
    idempotency_key: Mapped[str | None] = mapped_column(String(100))
    idempotency_payload_hash: Mapped[bytes | None] = mapped_column(LargeBinary(32))
    voided_at: Mapped[datetime | None]
```

`backend/app/models/audit.py`:

```python
import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import BigInteger, ForeignKey, Identity, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, enum_type


class AuditAction(StrEnum):
    CREATE = "CREATE"
    UPDATE = "UPDATE"
    VOID = "VOID"
    ARCHIVE = "ARCHIVE"


class Actor(StrEnum):
    USER = "USER"
    AI = "AI"
    SYSTEM = "SYSTEM"


class AuditLog(Base):
    """Registro somente de inserção das alterações relevantes."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    entity_type: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[uuid.UUID] = mapped_column(index=True)
    action: Mapped[AuditAction] = mapped_column(enum_type(AuditAction, "audit_action"))
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    actor: Mapped[Actor] = mapped_column(enum_type(Actor, "audit_actor"))
    request_id: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
```

`backend/app/models/__init__.py`:

```python
from app.models.account import Account, AccountType
from app.models.audit import Actor, AuditAction, AuditLog
from app.models.base import Base, OwnedModel
from app.models.category import Category, CategoryKind
from app.models.merchant import Merchant
from app.models.transaction import (
    PaymentMethod,
    Transaction,
    TransactionSource,
    TransactionStatus,
    TransactionType,
)
from app.models.user import DEFAULT_TIMEZONE, LoginAttempt, User, UserSession

__all__ = [
    "DEFAULT_TIMEZONE",
    "Account",
    "AccountType",
    "Actor",
    "AuditAction",
    "AuditLog",
    "Base",
    "Category",
    "CategoryKind",
    "LoginAttempt",
    "Merchant",
    "OwnedModel",
    "PaymentMethod",
    "Transaction",
    "TransactionSource",
    "TransactionStatus",
    "TransactionType",
    "User",
    "UserSession",
]
```

- [ ] **Step 6: Configurar o Alembic**

`backend/alembic.ini`:

```ini
[alembic]
script_location = %(here)s/migrations
prepend_sys_path = .
path_separator = os
file_template = %%(rev)s_%%(slug)s
# sqlalchemy.url fica vazio: vem de DATABASE_URL (.env) ou é definido pelos testes.
sqlalchemy.url =
```

`backend/migrations/env.py`:

```python
"""Ambiente do Alembic. A URL vem da configuração (testes) ou de DATABASE_URL."""

from alembic import context
from sqlalchemy import engine_from_config, pool

from app.config import get_settings
from app.models import Base

config = context.config
target_metadata = Base.metadata


def _url() -> str:
    return config.get_main_option("sqlalchemy.url") or get_settings().database_url


def run_migrations_offline() -> None:
    context.configure(
        url=_url(), target_metadata=target_metadata, literal_binds=True, compare_type=True
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        {"sqlalchemy.url": _url()}, prefix="sqlalchemy.", poolclass=pool.NullPool
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

`backend/migrations/script.py.mako`:

```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
${imports if imports else ""}

revision: str = ${repr(up_revision)}
down_revision: str | None = ${repr(down_revision)}
branch_labels: str | Sequence[str] | None = ${repr(branch_labels)}
depends_on: str | Sequence[str] | None = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

Criar `backend/.env` copiando o exemplo: `cp .env.example .env` (o `.env` está no `.gitignore`).

- [ ] **Step 7: Gerar a migração inicial**

Run (em `backend/`, com o banco no ar): `uv run alembic revision --autogenerate -m "initial schema" --rev-id 0001`
Expected: cria `migrations/versions/0001_initial_schema.py` com `op.create_table` para `users`, `sessions`, `login_attempts`, `accounts`, `categories`, `merchants`, `transactions`, `audit_log`.

Abra o arquivo e confira que ele contém: `sa.CheckConstraint('amount > 0', name=op.f('ck_transactions_amount_positive'))`, a constraint `ck_transactions_shape_by_type`, `uq_transactions_user_id_idempotency_key` e os quatro índices `ix_transactions_user_*`. Se `users` aparecer depois de uma tabela que referencia `users.id`, reordene manualmente para `users` vir primeiro.

Run: `uv run alembic upgrade head`
Expected: `Running upgrade  -> 0001, initial schema` (ou sem saída, sem erro).

- [ ] **Step 8: Escrever `backend/tests/conftest.py`**

```python
import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session

BACKEND_DIR = Path(__file__).resolve().parents[1]
TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://finance:finance@localhost:5433/finance_test"
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
```

- [ ] **Step 9: Escrever os testes de migração e constraints**

`backend/tests/test_migrations.py`:

```python
from datetime import date
from decimal import Decimal

import pytest
from alembic import command
from sqlalchemy import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    Account,
    AccountType,
    Category,
    CategoryKind,
    PaymentMethod,
    Transaction,
    TransactionType,
    User,
)
from tests.conftest import TEST_DATABASE_URL, alembic_config


def test_migrations_match_models(engine: Engine) -> None:
    command.check(alembic_config(TEST_DATABASE_URL))


def _seed(db: Session) -> tuple[User, Account, Category]:
    user = User(email="constraints@example.com", password_hash="x")
    db.add(user)
    db.flush()
    account = Account(
        user_id=user.id,
        name="Conta",
        type=AccountType.CHECKING,
        opening_balance=Decimal("0"),
        opening_date=date(2026, 10, 1),
    )
    category = Category(user_id=user.id, name="Mercado", kind=CategoryKind.EXPENSE)
    db.add_all([account, category])
    db.flush()
    return user, account, category


def test_amount_must_be_positive(db: Session) -> None:
    user, account, category = _seed(db)
    db.add(
        Transaction(
            user_id=user.id,
            type=TransactionType.EXPENSE,
            amount=Decimal("0"),
            occurred_on=date(2026, 10, 2),
            description="x",
            account_id=account.id,
            category_id=category.id,
            payment_method=PaymentMethod.PIX,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_transfer_requires_distinct_accounts(db: Session) -> None:
    user, account, _ = _seed(db)
    db.add(
        Transaction(
            user_id=user.id,
            type=TransactionType.TRANSFER,
            amount=Decimal("10"),
            occurred_on=date(2026, 10, 2),
            description="x",
            account_id=account.id,
            destination_account_id=account.id,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()


def test_expense_requires_payment_method(db: Session) -> None:
    user, account, category = _seed(db)
    db.add(
        Transaction(
            user_id=user.id,
            type=TransactionType.EXPENSE,
            amount=Decimal("10"),
            occurred_on=date(2026, 10, 2),
            description="x",
            account_id=account.id,
            category_id=category.id,
        )
    )
    with pytest.raises(IntegrityError):
        db.flush()
```

- [ ] **Step 10: Rodar os testes**

Run: `uv run pytest tests/test_config.py tests/test_migrations.py -v`
Expected: PASS (7). Se `test_migrations_match_models` falhar com diferenças, a migração gerada não corresponde aos modelos — gere de novo (apague o arquivo, `uv run alembic downgrade base`, repita o Step 7).

- [ ] **Step 11: Verificação completa e commit**

Run (na raiz): `bash scripts/check.sh`
Expected: tudo verde.

```bash
git add backend/app backend/alembic.ini backend/migrations backend/tests
git commit -m "feat(db): configuração, modelos e migração inicial" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Contexto, auditoria, escopo por usuária e criação de usuárias

**Files:**
- Create: `backend/app/services/__init__.py` (vazio), `backend/app/services/context.py`, `backend/app/services/audit.py`, `backend/app/services/categories.py`, `backend/app/services/users.py`, `backend/app/repositories.py`
- Create: `backend/tests/support.py`
- Modify: `backend/tests/conftest.py` (adicionar fixtures `clock`, `user`, `ctx`, `other_ctx`)
- Test: `backend/tests/services/test_users.py`

**Interfaces:**
- Consumes: modelos da Tarefa 4; `Clock`, `today` (Tarefa 3); `NotFound`, `Conflict`, `RuleViolation` (Tarefa 3); `to_api` (Tarefa 2).
- Produces (`context`): `@dataclass(frozen=True) RequestContext(user_id: UUID, timezone: str, actor: Actor, request_id: str, clock: Clock)` com `today() -> date` e `now() -> datetime`.
- Produces (`audit`): `jsonable(value: object) -> object`, `snapshot(entity: OwnedModel) -> dict[str, Any]` (sem `idempotency_payload_hash`), `record(session, ctx, entity: OwnedModel, action: AuditAction, before: dict[str, Any] | None) -> None` (faz `flush` e grava `after`).
- Produces (`repositories`): `owned_select(model: type[M], user_id: UUID) -> Select[tuple[M]]`, `get_owned(session, model: type[M], obj_id: UUID, user_id: UUID, what: str, *, for_update: bool = False) -> M` (levanta `NotFound(what)`).
- Produces (`categories`, parte 1): `UNCLASSIFIED = "A classificar"`, `FINANCIAL_CHARGES = "Encargos financeiros"`, `seed_default_categories(session, user_id: UUID) -> None`, `get_unclassified(session, user_id: UUID, kind: CategoryKind) -> Category`.
- Produces (`users`): `MIN_PASSWORD_LENGTH = 12`, `normalize_email(email: str) -> str`, `hash_password(password: str) -> str`, `verify_password(password: str, password_hash: str) -> bool`, `DUMMY_HASH: str`, `create_user(session, email: str, password: str, timezone: str = DEFAULT_TIMEZONE) -> User`, `get_by_email(session, email: str) -> User` (levanta `NotFound("a usuária")`), `set_password(session, email: str, password: str) -> User`.
- Produces (testes): `tests/support.py` com `PASSWORD = "senha-super-secreta"`, `FIXED_NOW = datetime(2026, 10, 15, 15, 0, tzinfo=UTC)` (12h00 em São Paulo), `POLICY` (definida na Tarefa 6); fixtures `clock`, `user` (`ana@example.com`), `ctx`, `other_ctx` (`bia@example.com`).

- [ ] **Step 1: Escrever `backend/tests/support.py`**

```python
"""Constantes e fábricas compartilhadas pelos testes."""

from datetime import UTC, datetime

PASSWORD = "senha-super-secreta"
FIXED_NOW = datetime(2026, 10, 15, 15, 0, tzinfo=UTC)  # 12h00 em São Paulo
```

- [ ] **Step 2: Escrever os testes que falham**

`backend/tests/services/test_users.py`:

```python
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.errors import Conflict, NotFound, RuleViolation
from app.models import Category, CategoryKind
from app.repositories import get_owned
from app.services.audit import snapshot
from app.services.users import create_user, set_password, verify_password
from tests.support import PASSWORD


def test_create_user_normalizes_email_and_hashes_password(db: Session) -> None:
    user = create_user(db, "  Ana@Example.COM ", PASSWORD)
    assert user.email == "ana@example.com"
    assert user.password_hash != PASSWORD
    assert verify_password(PASSWORD, user.password_hash)
    assert not verify_password("outra-senha-qualquer", user.password_hash)


def test_create_user_seeds_default_categories(db: Session) -> None:
    user = create_user(db, "ana@example.com", PASSWORD)
    categories = db.scalars(select(Category).where(Category.user_id == user.id)).all()
    expense = {c.name for c in categories if c.kind is CategoryKind.EXPENSE}
    income = {c.name for c in categories if c.kind is CategoryKind.INCOME}
    assert len(expense) == 14
    assert {"A classificar", "Encargos financeiros", "Mercado", "Saúde"} <= expense
    assert income == {"Salário", "13º salário", "Receitas extras", "Reembolsos", "A classificar"}
    assert {c.name for c in categories if c.is_essential} == {
        "Moradia",
        "Contas da casa",
        "Saúde",
        "Pets",
    }
    assert {(c.name, c.kind) for c in categories if c.is_system} == {
        ("A classificar", CategoryKind.EXPENSE),
        ("Encargos financeiros", CategoryKind.EXPENSE),
        ("A classificar", CategoryKind.INCOME),
    }


def test_duplicate_email_conflicts(db: Session) -> None:
    create_user(db, "ana@example.com", PASSWORD)
    with pytest.raises(Conflict) as exc:
        create_user(db, "ANA@example.com", PASSWORD)
    assert exc.value.code == "email_already_exists"


@pytest.mark.parametrize(
    ("email", "password", "timezone", "code"),
    [
        ("ana@example.com", "curta", "America/Sao_Paulo", "weak_password"),
        ("sem-arroba", PASSWORD, "America/Sao_Paulo", "invalid_email"),
        ("ana@example.com", PASSWORD, "Marte/Olympus", "invalid_timezone"),
    ],
)
def test_create_user_validations(
    db: Session, email: str, password: str, timezone: str, code: str
) -> None:
    with pytest.raises(RuleViolation) as exc:
        create_user(db, email, password, timezone)
    assert exc.value.code == code


def test_set_password(db: Session) -> None:
    create_user(db, "ana@example.com", PASSWORD)
    user = set_password(db, "ana@example.com", "uma-nova-senha-longa")
    assert verify_password("uma-nova-senha-longa", user.password_hash)


def test_set_password_unknown_email(db: Session) -> None:
    with pytest.raises(NotFound):
        set_password(db, "ninguem@example.com", "uma-nova-senha-longa")


def test_get_owned_hides_other_users_data(db: Session) -> None:
    ana = create_user(db, "ana@example.com", PASSWORD)
    bia = create_user(db, "bia@example.com", PASSWORD)
    category = db.scalars(select(Category).where(Category.user_id == ana.id)).first()
    assert category is not None
    assert get_owned(db, Category, category.id, ana.id, "a categoria") is category
    with pytest.raises(NotFound):
        get_owned(db, Category, category.id, bia.id, "a categoria")


def test_snapshot_is_json_friendly(db: Session) -> None:
    ana = create_user(db, "ana@example.com", PASSWORD)
    category = db.scalars(select(Category).where(Category.name == "Saúde")).one()
    data = snapshot(category)
    assert data["name"] == "Saúde"
    assert data["kind"] == "EXPENSE"
    assert data["is_essential"] is True
    assert data["user_id"] == str(ana.id)
```

- [ ] **Step 3: Rodar e confirmar a falha**

Run: `uv run pytest tests/services/test_users.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.repositories'`.

- [ ] **Step 4: Implementar contexto, auditoria e repositórios**

`backend/app/services/context.py`:

```python
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
```

`backend/app/services/audit.py`:

```python
"""Registro de auditoria gravado na mesma transação da alteração."""

from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any
from uuid import UUID

from sqlalchemy import inspect
from sqlalchemy.orm import Session

from app.domain.money import to_api
from app.models import AuditAction, AuditLog, OwnedModel
from app.services.context import RequestContext

_EXCLUDED = frozenset({"idempotency_payload_hash"})


def jsonable(value: object) -> object:
    """Converte valores de coluna para tipos aceitos em JSON."""
    match value:
        case None:
            return None
        case Decimal():
            return to_api(value)
        case datetime() | date():
            return value.isoformat()
        case UUID():
            return str(value)
        case StrEnum():
            return value.value
        case bytes():
            return value.hex()
        case _:
            return value


def snapshot(entity: OwnedModel) -> dict[str, Any]:
    mapper = inspect(entity).mapper
    return {
        attr.key: jsonable(getattr(entity, attr.key))
        for attr in mapper.column_attrs
        if attr.key not in _EXCLUDED
    }


def record(
    session: Session,
    ctx: RequestContext,
    entity: OwnedModel,
    action: AuditAction,
    before: dict[str, Any] | None,
) -> None:
    session.flush()  # garante id e valores padrão antes do snapshot
    session.add(
        AuditLog(
            user_id=ctx.user_id,
            entity_type=str(type(entity).__tablename__),
            entity_id=entity.id,
            action=action,
            before=before,
            after=snapshot(entity),
            actor=ctx.actor,
            request_id=ctx.request_id,
        )
    )
```

`backend/app/repositories.py`:

```python
"""Acesso a dados sempre restrito à usuária dona do registro."""

from uuid import UUID

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.domain.errors import NotFound
from app.models import OwnedModel


def owned_select[M: OwnedModel](model: type[M], user_id: UUID) -> Select[tuple[M]]:
    return select(model).where(model.user_id == user_id)


def get_owned[M: OwnedModel](
    session: Session,
    model: type[M],
    obj_id: UUID,
    user_id: UUID,
    what: str,
    *,
    for_update: bool = False,
) -> M:
    """Busca por id; registro inexistente ou de outra usuária é tratado igual (404)."""
    obj = session.get(model, obj_id, with_for_update=for_update)
    if obj is None or obj.user_id != user_id:
        raise NotFound(what)
    return obj
```

- [ ] **Step 5: Implementar categorias padrão e usuárias**

`backend/app/services/categories.py` (parte 1; a Tarefa 8 acrescenta o restante):

```python
"""Categorias: lista padrão, consultas e regras de edição."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Category, CategoryKind

UNCLASSIFIED = "A classificar"
FINANCIAL_CHARGES = "Encargos financeiros"

# (nome, essencial)
DEFAULT_EXPENSE_CATEGORIES: tuple[tuple[str, bool], ...] = (
    ("Alimentação", False),
    ("Mercado", False),
    ("Transporte", False),
    ("Moradia", True),
    ("Contas da casa", True),
    ("Saúde", True),
    ("Pets", True),
    ("Assinaturas", False),
    ("Compras diversas", False),
    ("Lazer", False),
    ("Hábitos pessoais", False),
    ("Educação", False),
)
DEFAULT_INCOME_CATEGORIES: tuple[str, ...] = (
    "Salário",
    "13º salário",
    "Receitas extras",
    "Reembolsos",
)


def seed_default_categories(session: Session, user_id: UUID) -> None:
    expense = CategoryKind.EXPENSE
    income = CategoryKind.INCOME
    rows = [
        Category(user_id=user_id, name=name, kind=expense, is_essential=essential)
        for name, essential in DEFAULT_EXPENSE_CATEGORIES
    ]
    rows += [Category(user_id=user_id, name=name, kind=income) for name in DEFAULT_INCOME_CATEGORIES]
    rows += [
        Category(user_id=user_id, name=UNCLASSIFIED, kind=expense, is_system=True),
        Category(user_id=user_id, name=FINANCIAL_CHARGES, kind=expense, is_system=True),
        Category(user_id=user_id, name=UNCLASSIFIED, kind=income, is_system=True),
    ]
    session.add_all(rows)
    session.flush()


def get_unclassified(session: Session, user_id: UUID, kind: CategoryKind) -> Category:
    return session.scalars(
        select(Category).where(
            Category.user_id == user_id,
            Category.kind == kind,
            Category.is_system.is_(True),
            Category.name == UNCLASSIFIED,
        )
    ).one()
```

`backend/app/services/users.py`:

```python
"""Criação de usuárias e senhas (argon2id). Não há cadastro público: só via CLI."""

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.errors import Conflict, NotFound, RuleViolation
from app.models import DEFAULT_TIMEZONE, User
from app.services.categories import seed_default_categories

MIN_PASSWORD_LENGTH = 12

_hasher = PasswordHash((Argon2Hasher(),))
# Usado quando o e-mail não existe, para o login levar o mesmo tempo nos dois casos.
DUMMY_HASH = _hasher.hash("senha-ficticia-para-tempo-constante")


def normalize_email(email: str) -> str:
    return email.strip().lower()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _hasher.verify(password, password_hash)


def _validate_password(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise RuleViolation(
            "weak_password", f"A senha deve ter pelo menos {MIN_PASSWORD_LENGTH} caracteres."
        )


def create_user(
    session: Session, email: str, password: str, timezone: str = DEFAULT_TIMEZONE
) -> User:
    normalized = normalize_email(email)
    if "@" not in normalized or len(normalized) > 320:
        raise RuleViolation("invalid_email", "E-mail inválido.")
    _validate_password(password)
    try:
        ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise RuleViolation("invalid_timezone", f"Fuso horário desconhecido: {timezone}.") from exc
    if session.scalar(select(User.id).where(User.email == normalized)) is not None:
        raise Conflict("email_already_exists", "Já existe uma usuária com esse e-mail.")

    user = User(email=normalized, password_hash=hash_password(password), timezone=timezone)
    session.add(user)
    session.flush()
    seed_default_categories(session, user.id)
    return user


def get_by_email(session: Session, email: str) -> User:
    user = session.scalar(select(User).where(User.email == normalize_email(email)))
    if user is None:
        raise NotFound("a usuária")
    return user


def set_password(session: Session, email: str, password: str) -> User:
    user = get_by_email(session, email)
    _validate_password(password)
    user.password_hash = hash_password(password)
    session.flush()
    return user
```

- [ ] **Step 6: Acrescentar as fixtures ao final de `backend/tests/conftest.py`**

Adicione estes imports ao bloco de imports do arquivo:

```python
from app.domain.dates import FixedClock
from app.models import Actor, User
from app.services.context import RequestContext
from app.services.users import create_user
from tests.support import FIXED_NOW, PASSWORD
```

E estas fixtures ao final:

```python
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
```

- [ ] **Step 7: Rodar e confirmar que passa**

Run: `uv run pytest tests/services/test_users.py -v`
Expected: PASS (9).

- [ ] **Step 8: Verificação completa e commit**

Run (na raiz): `bash scripts/check.sh`
Expected: tudo verde.

```bash
git add backend/app backend/tests
git commit -m "feat: contexto, auditoria, escopo por usuária e criação de usuárias" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Autenticação — login, limite de tentativas e sessões

**Files:**
- Create: `backend/app/services/auth.py`
- Modify: `backend/tests/support.py` (adicionar `POLICY`)
- Test: `backend/tests/services/test_auth.py`

**Interfaces:**
- Consumes: `User`, `UserSession`, `LoginAttempt`; `normalize_email`, `verify_password`, `DUMMY_HASH` (Tarefa 5).
- Produces: `MAX_FAILURES = 5`, `FAILURE_WINDOW = timedelta(minutes=15)`, `@dataclass(frozen=True) SessionPolicy(secret_key: bytes, idle: timedelta, max_age: timedelta)`, `@dataclass(frozen=True) LoginOutcome(user: User | None, token: str | None, blocked: bool = False)`, `hash_token(token: str, secret_key: bytes) -> bytes`, `login(session, policy, email: str, password: str, ip: str, now: datetime) -> LoginOutcome`, `authenticate(session, policy, token: str, now: datetime) -> User | None` (renova `last_seen_at`), `logout(session, policy, token: str, now: datetime) -> None`, `revoke_all(session, user_id: UUID, now: datetime) -> int`.

- [ ] **Step 1: Acrescentar `POLICY` a `backend/tests/support.py`**

O arquivo completo fica:

```python
"""Constantes e fábricas compartilhadas pelos testes."""

from datetime import UTC, datetime, timedelta

from app.services.auth import SessionPolicy

PASSWORD = "senha-super-secreta"
FIXED_NOW = datetime(2026, 10, 15, 15, 0, tzinfo=UTC)  # 12h00 em São Paulo
POLICY = SessionPolicy(secret_key=b"k" * 32, idle=timedelta(days=30), max_age=timedelta(days=90))
```

- [ ] **Step 2: Escrever os testes que falham**

`backend/tests/services/test_auth.py`:

```python
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import LoginAttempt, User, UserSession
from app.services import auth
from tests.support import FIXED_NOW, PASSWORD, POLICY

NOW = FIXED_NOW


def _login(
    db: Session,
    email: str = "ana@example.com",
    password: str = PASSWORD,
    ip: str = "1.1.1.1",
    now: datetime = NOW,
) -> auth.LoginOutcome:
    return auth.login(db, POLICY, email, password, ip, now)


def test_login_success_creates_hashed_session(db: Session, user: User) -> None:
    outcome = _login(db)
    assert outcome.user is not None and outcome.user.id == user.id
    assert outcome.token and not outcome.blocked
    stored = db.scalars(select(UserSession).where(UserSession.user_id == user.id)).one()
    assert stored.token_hash == auth.hash_token(outcome.token, POLICY.secret_key)
    assert stored.token_hash != outcome.token.encode()
    assert stored.expires_at == NOW + timedelta(days=90)


def test_login_is_case_insensitive_on_email(db: Session, user: User) -> None:
    outcome = _login(db, email="  ANA@Example.com")
    assert outcome.user is not None and outcome.user.id == user.id


def test_wrong_password_records_failure(db: Session, user: User) -> None:
    outcome = _login(db, password="senha-errada-123")
    assert outcome.user is None and outcome.token is None and not outcome.blocked
    assert [a.succeeded for a in db.scalars(select(LoginAttempt)).all()] == [False]


def test_unknown_email_fails_like_wrong_password(db: Session) -> None:
    outcome = _login(db, email="ninguem@example.com")
    assert outcome.user is None and outcome.token is None and not outcome.blocked


def test_blocks_after_five_failures_by_email(db: Session, user: User) -> None:
    for i in range(5):
        _login(db, password="senha-errada-123", ip=f"10.0.0.{i}")
    outcome = _login(db, ip="10.0.0.99")
    assert outcome.blocked and outcome.token is None


def test_blocks_after_five_failures_by_ip(db: Session, user: User) -> None:
    for i in range(5):
        _login(db, email=f"x{i}@example.com", ip="2.2.2.2")
    assert _login(db, ip="2.2.2.2").blocked


def test_old_failures_do_not_count(db: Session, user: User) -> None:
    for _ in range(5):
        _login(db, password="senha-errada-123", now=NOW - timedelta(minutes=16))
    assert _login(db).token is not None


def test_authenticate_slides_while_in_use(db: Session, user: User) -> None:
    token = _login(db).token
    assert token is not None
    first = auth.authenticate(db, POLICY, token, NOW + timedelta(days=20))
    assert first is not None and first.id == user.id
    assert auth.authenticate(db, POLICY, token, NOW + timedelta(days=45)) is not None


def test_authenticate_rejects_idle_session(db: Session, user: User) -> None:
    token = _login(db).token
    assert token is not None
    assert auth.authenticate(db, POLICY, token, NOW + timedelta(days=31)) is None


def test_authenticate_rejects_after_absolute_expiry(db: Session, user: User) -> None:
    token = _login(db).token
    assert token is not None
    for day in (20, 40, 60, 80):
        assert auth.authenticate(db, POLICY, token, NOW + timedelta(days=day)) is not None
    assert auth.authenticate(db, POLICY, token, NOW + timedelta(days=91)) is None


def test_logout_revokes(db: Session, user: User) -> None:
    token = _login(db).token
    assert token is not None
    auth.logout(db, POLICY, token, NOW)
    assert auth.authenticate(db, POLICY, token, NOW) is None


def test_revoke_all(db: Session, user: User) -> None:
    tokens = [_login(db).token, _login(db).token]
    assert auth.revoke_all(db, user.id, NOW) == 2
    for token in tokens:
        assert token is not None
        assert auth.authenticate(db, POLICY, token, NOW) is None


def test_unknown_token(db: Session) -> None:
    assert auth.authenticate(db, POLICY, "nao-existe", NOW) is None
```

- [ ] **Step 3: Rodar e confirmar a falha**

Run: `uv run pytest tests/services/test_auth.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.auth'`.

- [ ] **Step 4: Implementar `backend/app/services/auth.py`**

```python
"""Login com limite de tentativas e sessões guardadas no banco (revogáveis)."""

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.orm import InstrumentedAttribute, Session

from app.models import LoginAttempt, User, UserSession
from app.services.users import DUMMY_HASH, normalize_email, verify_password

MAX_FAILURES = 5
FAILURE_WINDOW = timedelta(minutes=15)


@dataclass(frozen=True)
class SessionPolicy:
    secret_key: bytes
    idle: timedelta
    max_age: timedelta


@dataclass(frozen=True)
class LoginOutcome:
    user: User | None
    token: str | None
    blocked: bool = False


def hash_token(token: str, secret_key: bytes) -> bytes:
    """O banco guarda só o HMAC do token: quem lê o banco não consegue usar a sessão."""
    return hmac.new(secret_key, token.encode(), hashlib.sha256).digest()


def _recent_failures(
    session: Session, column: InstrumentedAttribute[str], value: str, since: datetime
) -> int:
    count = session.scalar(
        select(func.count())
        .select_from(LoginAttempt)
        .where(
            column == value,
            LoginAttempt.succeeded.is_(False),
            LoginAttempt.attempted_at >= since,
        )
    )
    return count or 0


def login(
    session: Session, policy: SessionPolicy, email: str, password: str, ip: str, now: datetime
) -> LoginOutcome:
    normalized = normalize_email(email)[:320]
    ip = ip[:64]
    since = now - FAILURE_WINDOW
    if (
        _recent_failures(session, LoginAttempt.email_normalized, normalized, since) >= MAX_FAILURES
        or _recent_failures(session, LoginAttempt.ip, ip, since) >= MAX_FAILURES
    ):
        return LoginOutcome(user=None, token=None, blocked=True)

    user = session.scalar(select(User).where(User.email == normalized))
    # Verifica um hash fictício quando o e-mail não existe: o tempo de resposta não revela nada.
    password_ok = verify_password(password, user.password_hash if user else DUMMY_HASH)
    succeeded = user is not None and password_ok
    session.add(
        LoginAttempt(email_normalized=normalized, ip=ip, succeeded=succeeded, attempted_at=now)
    )
    if not succeeded or user is None:
        session.flush()
        return LoginOutcome(user=None, token=None)

    token = secrets.token_urlsafe(32)
    session.add(
        UserSession(
            user_id=user.id,
            token_hash=hash_token(token, policy.secret_key),
            created_at=now,
            expires_at=now + policy.max_age,
            last_seen_at=now,
        )
    )
    session.flush()
    return LoginOutcome(user=user, token=token)


def _find(session: Session, policy: SessionPolicy, token: str) -> UserSession | None:
    return session.scalar(
        select(UserSession).where(UserSession.token_hash == hash_token(token, policy.secret_key))
    )


def authenticate(
    session: Session, policy: SessionPolicy, token: str, now: datetime
) -> User | None:
    stored = _find(session, policy, token)
    if (
        stored is None
        or stored.revoked_at is not None
        or now >= stored.expires_at
        or now - stored.last_seen_at > policy.idle
    ):
        return None
    stored.last_seen_at = now
    session.flush()
    return session.get(User, stored.user_id)


def logout(session: Session, policy: SessionPolicy, token: str, now: datetime) -> None:
    stored = _find(session, policy, token)
    if stored is not None and stored.revoked_at is None:
        stored.revoked_at = now
        session.flush()


def revoke_all(session: Session, user_id: UUID, now: datetime) -> int:
    sessions = session.scalars(
        select(UserSession).where(
            UserSession.user_id == user_id, UserSession.revoked_at.is_(None)
        )
    ).all()
    for stored in sessions:
        stored.revoked_at = now
    session.flush()
    return len(sessions)
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `uv run pytest tests/services/test_auth.py -v`
Expected: PASS (13).

- [ ] **Step 6: Verificação completa e commit**

Run (na raiz): `bash scripts/check.sh`
Expected: tudo verde.

```bash
git add backend/app/services/auth.py backend/tests
git commit -m "feat(auth): login com limite de tentativas e sessões revogáveis" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Comandos de administração (CLI)

**Files:**
- Create: `backend/app/cli.py`
- Test: `backend/tests/services/test_cli.py`

**Interfaces:**
- Consumes: `users.create_user`, `users.set_password`, `users.get_by_email` (Tarefa 5); `auth.revoke_all` (Tarefa 6); `make_engine`, `make_sessionmaker` (Tarefa 4).
- Produces: `run(argv: Sequence[str] | None, session: Session) -> int` (0 = sucesso, 1 = erro de domínio) e `main()`. Uso: `uv run python -m app.cli create-user --email X [--timezone Y]`, `set-password --email X`, `revoke-sessions --email X`. A senha vem de `PF_NEW_PASSWORD` ou é pedida duas vezes no terminal.

- [ ] **Step 1: Escrever os testes que falham**

`backend/tests/services/test_cli.py`:

```python
import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import cli
from app.models import User
from app.services import auth
from app.services.users import verify_password
from tests.support import FIXED_NOW, PASSWORD, POLICY


def test_create_user_command(
    db: Session, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("PF_NEW_PASSWORD", "senha-da-cli-bem-longa")
    assert cli.run(["create-user", "--email", "cli@example.com"], db) == 0
    assert "cli@example.com" in capsys.readouterr().out
    assert db.scalar(select(User).where(User.email == "cli@example.com")) is not None


def test_create_user_duplicate_returns_error(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("PF_NEW_PASSWORD", "senha-da-cli-bem-longa")
    assert cli.run(["create-user", "--email", "ana@example.com"], db) == 1
    assert "Erro:" in capsys.readouterr().err


def test_set_password_revokes_sessions(
    db: Session, user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    token = auth.login(db, POLICY, "ana@example.com", PASSWORD, "ip", FIXED_NOW).token
    assert token is not None
    monkeypatch.setenv("PF_NEW_PASSWORD", "nova-senha-bem-longa")
    assert cli.run(["set-password", "--email", "ana@example.com"], db) == 0
    assert verify_password("nova-senha-bem-longa", user.password_hash)
    assert auth.authenticate(db, POLICY, token, FIXED_NOW) is None


def test_revoke_sessions_command(
    db: Session, user: User, capsys: pytest.CaptureFixture[str]
) -> None:
    for _ in range(2):
        auth.login(db, POLICY, "ana@example.com", PASSWORD, "ip", FIXED_NOW)
    assert cli.run(["revoke-sessions", "--email", "ana@example.com"], db) == 0
    assert "2 sessão(ões) revogada(s)." in capsys.readouterr().out


def test_unknown_email_returns_error(db: Session) -> None:
    assert cli.run(["revoke-sessions", "--email", "ninguem@example.com"], db) == 1
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `uv run pytest tests/services/test_cli.py -v`
Expected: FAIL — `ImportError: cannot import name 'cli' from 'app'`.

- [ ] **Step 3: Implementar `backend/app/cli.py`**

```python
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
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `uv run pytest tests/services/test_cli.py -v`
Expected: PASS (5).

- [ ] **Step 5: Verificação completa e commit**

Run (na raiz): `bash scripts/check.sh`
Expected: tudo verde.

```bash
git add backend/app/cli.py backend/tests/services/test_cli.py
git commit -m "feat(cli): criar usuária, trocar senha e revogar sessões" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Contas e categorias

**Files:**
- Create: `backend/app/services/accounts.py`
- Modify: `backend/app/services/categories.py` (substituir pelo arquivo completo abaixo)
- Modify: `backend/tests/support.py` (adicionar `make_account`, `find_category`)
- Test: `backend/tests/services/test_accounts.py`, `backend/tests/services/test_categories.py`

**Interfaces:**
- Consumes: `RequestContext`, `record`, `snapshot`, `owned_select`, `get_owned` (Tarefa 5).
- Produces (`accounts`): `@dataclass(frozen=True) ArchiveResult(account: Account, notices: list[Notice] = [])`, `list_accounts(session, ctx, *, include_archived: bool = False) -> list[Account]`, `get_active_account(session, ctx, account_id: UUID) -> Account` (levanta `RuleViolation("account_archived")`), `create_account(session, ctx, *, name: str, account_type: AccountType, opening_balance: Decimal, opening_date: date) -> Account`, `update_account(session, ctx, account_id: UUID, *, name: str | None = None, account_type: AccountType | None = None, opening_balance: Decimal | None = None, opening_date: date | None = None) -> Account`, `archive_account(session, ctx, account_id: UUID) -> ArchiveResult`.
- Produces (`categories`, além da parte 1): `list_categories(session, ctx, *, kind: CategoryKind | None = None, include_archived: bool = False) -> list[Category]`, `get_active_category(session, ctx, category_id: UUID, kind: CategoryKind) -> Category` (códigos `category_kind_mismatch`, `category_archived`), `create_category(session, ctx, *, name: str, kind: CategoryKind, is_essential: bool = False) -> Category`, `update_category(session, ctx, category_id: UUID, *, name: str | None = None, is_essential: bool | None = None) -> Category`, `archive_category(session, ctx, category_id: UUID) -> Category` (código `system_category_locked`).
- Produces (testes): `make_account(db, ctx, name="Itaú", opening_balance="1000.00", opening_date=date(2026, 10, 1), account_type=AccountType.CHECKING) -> Account`, `find_category(db, ctx, name, kind=CategoryKind.EXPENSE) -> Category`.

- [ ] **Step 1: Acrescentar fábricas a `backend/tests/support.py`**

O arquivo completo fica:

```python
"""Constantes e fábricas compartilhadas pelos testes."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, AccountType, Category, CategoryKind
from app.services import accounts
from app.services.auth import SessionPolicy
from app.services.context import RequestContext

PASSWORD = "senha-super-secreta"
FIXED_NOW = datetime(2026, 10, 15, 15, 0, tzinfo=UTC)  # 12h00 em São Paulo
POLICY = SessionPolicy(secret_key=b"k" * 32, idle=timedelta(days=30), max_age=timedelta(days=90))


def make_account(
    db: Session,
    ctx: RequestContext,
    name: str = "Itaú",
    opening_balance: str = "1000.00",
    opening_date: date = date(2026, 10, 1),
    account_type: AccountType = AccountType.CHECKING,
) -> Account:
    return accounts.create_account(
        db,
        ctx,
        name=name,
        account_type=account_type,
        opening_balance=Decimal(opening_balance),
        opening_date=opening_date,
    )


def find_category(
    db: Session, ctx: RequestContext, name: str, kind: CategoryKind = CategoryKind.EXPENSE
) -> Category:
    return db.scalars(
        select(Category).where(
            Category.user_id == ctx.user_id, Category.kind == kind, Category.name == name
        )
    ).one()
```

- [ ] **Step 2: Escrever os testes que falham**

`backend/tests/services/test_accounts.py`:

```python
from decimal import Decimal
from uuid import UUID

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.errors import Conflict, NotFound, RuleViolation
from app.models import Actor, AuditAction, AuditLog
from app.services import accounts
from app.services.context import RequestContext
from tests.support import make_account


def _audit(db: Session, entity_id: UUID) -> list[AuditLog]:
    return list(
        db.scalars(select(AuditLog).where(AuditLog.entity_id == entity_id).order_by(AuditLog.id))
    )


def test_create_account_quantizes_and_audits(db: Session, ctx: RequestContext) -> None:
    account = make_account(db, ctx, opening_balance="1000.5")
    assert account.opening_balance == Decimal("1000.50")
    [log] = _audit(db, account.id)
    assert log.action is AuditAction.CREATE
    assert log.actor is Actor.USER
    assert log.before is None
    assert log.after is not None
    assert log.after["opening_balance"] == "1000.50"
    assert log.after["name"] == "Itaú"


def test_negative_opening_balance_allowed(db: Session, ctx: RequestContext) -> None:
    assert make_account(db, ctx, opening_balance="-250.00").opening_balance == Decimal("-250.00")


def test_duplicate_name_conflicts(db: Session, ctx: RequestContext) -> None:
    make_account(db, ctx)
    with pytest.raises(Conflict) as exc:
        make_account(db, ctx)
    assert exc.value.code == "name_already_exists"


def test_same_name_allowed_for_other_user(
    db: Session, ctx: RequestContext, other_ctx: RequestContext
) -> None:
    make_account(db, ctx)
    make_account(db, other_ctx)


def test_update_account_records_before_and_after(db: Session, ctx: RequestContext) -> None:
    account = make_account(db, ctx)
    accounts.update_account(db, ctx, account.id, name="Itaú PF")
    log = _audit(db, account.id)[-1]
    assert log.action is AuditAction.UPDATE
    assert log.before is not None and log.before["name"] == "Itaú"
    assert log.after is not None and log.after["name"] == "Itaú PF"


def test_other_users_account_is_not_found(
    db: Session, ctx: RequestContext, other_ctx: RequestContext
) -> None:
    foreign = make_account(db, other_ctx)
    with pytest.raises(NotFound):
        accounts.update_account(db, ctx, foreign.id, name="Invasão")


def test_archive_is_idempotent_and_blocks_new_use(db: Session, ctx: RequestContext) -> None:
    account = make_account(db, ctx)
    first = accounts.archive_account(db, ctx, account.id)
    archived_at = first.account.archived_at
    assert archived_at is not None
    second = accounts.archive_account(db, ctx, account.id)
    assert second.account.archived_at == archived_at
    assert [log.action for log in _audit(db, account.id)].count(AuditAction.ARCHIVE) == 1
    with pytest.raises(RuleViolation) as exc:
        accounts.get_active_account(db, ctx, account.id)
    assert exc.value.code == "account_archived"


def test_list_hides_archived_by_default(db: Session, ctx: RequestContext) -> None:
    kept = make_account(db, ctx, name="Itaú")
    archived = make_account(db, ctx, name="Antiga")
    accounts.archive_account(db, ctx, archived.id)
    assert [a.id for a in accounts.list_accounts(db, ctx)] == [kept.id]
    assert len(accounts.list_accounts(db, ctx, include_archived=True)) == 2
```

`backend/tests/services/test_categories.py`:

```python
import pytest
from sqlalchemy.orm import Session

from app.domain.errors import Conflict, RuleViolation
from app.models import CategoryKind
from app.services import categories
from app.services.context import RequestContext
from tests.support import find_category


def test_list_default_categories(db: Session, ctx: RequestContext) -> None:
    assert len(categories.list_categories(db, ctx)) == 19
    assert len(categories.list_categories(db, ctx, kind=CategoryKind.EXPENSE)) == 14


def test_create_and_duplicate(db: Session, ctx: RequestContext) -> None:
    created = categories.create_category(db, ctx, name="Viagens", kind=CategoryKind.EXPENSE)
    assert created.is_essential is False
    with pytest.raises(Conflict):
        categories.create_category(db, ctx, name="Viagens", kind=CategoryKind.EXPENSE)
    categories.create_category(db, ctx, name="Viagens", kind=CategoryKind.INCOME)


def test_system_category_cannot_be_renamed_or_archived(db: Session, ctx: RequestContext) -> None:
    unclassified = categories.get_unclassified(db, ctx.user_id, CategoryKind.EXPENSE)
    with pytest.raises(RuleViolation) as exc:
        categories.update_category(db, ctx, unclassified.id, name="Outros")
    assert exc.value.code == "system_category_locked"
    with pytest.raises(RuleViolation):
        categories.archive_category(db, ctx, unclassified.id)


def test_system_category_essential_flag_can_change(db: Session, ctx: RequestContext) -> None:
    charges = find_category(db, ctx, "Encargos financeiros")
    assert categories.update_category(db, ctx, charges.id, is_essential=True).is_essential


def test_get_active_category_checks_kind_and_archive(db: Session, ctx: RequestContext) -> None:
    salary = find_category(db, ctx, "Salário", CategoryKind.INCOME)
    with pytest.raises(RuleViolation) as exc:
        categories.get_active_category(db, ctx, salary.id, CategoryKind.EXPENSE)
    assert exc.value.code == "category_kind_mismatch"

    trips = categories.create_category(db, ctx, name="Viagens", kind=CategoryKind.EXPENSE)
    categories.archive_category(db, ctx, trips.id)
    with pytest.raises(RuleViolation) as exc:
        categories.get_active_category(db, ctx, trips.id, CategoryKind.EXPENSE)
    assert exc.value.code == "category_archived"
```

- [ ] **Step 3: Rodar e confirmar a falha**

Run: `uv run pytest tests/services/test_accounts.py tests/services/test_categories.py -v`
Expected: FAIL — `ImportError` (`accounts` não existe em `app.services`).

- [ ] **Step 4: Implementar `backend/app/services/accounts.py`**

```python
"""Contas: cadastro com saldo e data de abertura, edição e arquivamento."""

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.domain.errors import Conflict, Notice, RuleViolation
from app.domain.money import quantize
from app.models import Account, AccountType, AuditAction, Transaction, TransactionStatus
from app.repositories import get_owned, owned_select
from app.services.audit import record, snapshot
from app.services.context import RequestContext


@dataclass(frozen=True)
class ArchiveResult:
    account: Account
    notices: list[Notice] = field(default_factory=list)


def list_accounts(
    session: Session, ctx: RequestContext, *, include_archived: bool = False
) -> list[Account]:
    stmt = owned_select(Account, ctx.user_id).order_by(Account.name)
    if not include_archived:
        stmt = stmt.where(Account.archived_at.is_(None))
    return list(session.scalars(stmt))


def get_active_account(session: Session, ctx: RequestContext, account_id: UUID) -> Account:
    account = get_owned(session, Account, account_id, ctx.user_id, "a conta")
    if account.archived_at is not None:
        raise RuleViolation("account_archived", f"A conta {account.name} está arquivada.")
    return account


def _ensure_unique_name(
    session: Session, user_id: UUID, name: str, exclude_id: UUID | None = None
) -> None:
    stmt = select(Account.id).where(Account.user_id == user_id, Account.name == name)
    if exclude_id is not None:
        stmt = stmt.where(Account.id != exclude_id)
    if session.scalar(stmt) is not None:
        raise Conflict("name_already_exists", "Já existe uma conta com esse nome.")


def create_account(
    session: Session,
    ctx: RequestContext,
    *,
    name: str,
    account_type: AccountType,
    opening_balance: Decimal,
    opening_date: date,
) -> Account:
    _ensure_unique_name(session, ctx.user_id, name)
    account = Account(
        user_id=ctx.user_id,
        name=name,
        type=account_type,
        opening_balance=quantize(opening_balance),
        opening_date=opening_date,
    )
    session.add(account)
    record(session, ctx, account, AuditAction.CREATE, before=None)
    return account


def update_account(
    session: Session,
    ctx: RequestContext,
    account_id: UUID,
    *,
    name: str | None = None,
    account_type: AccountType | None = None,
    opening_balance: Decimal | None = None,
    opening_date: date | None = None,
) -> Account:
    account = get_owned(session, Account, account_id, ctx.user_id, "a conta", for_update=True)
    before = snapshot(account)
    if name is not None and name != account.name:
        _ensure_unique_name(session, ctx.user_id, name, exclude_id=account.id)
        account.name = name
    if account_type is not None:
        account.type = account_type
    if opening_balance is not None:
        account.opening_balance = quantize(opening_balance)
    if opening_date is not None:
        earliest = session.scalar(
            select(func.min(Transaction.occurred_on)).where(
                Transaction.user_id == ctx.user_id,
                Transaction.status == TransactionStatus.CONFIRMED,
                or_(
                    Transaction.account_id == account.id,
                    Transaction.destination_account_id == account.id,
                ),
            )
        )
        if earliest is not None and earliest < opening_date:
            raise RuleViolation(
                "date_before_account_opening",
                f"Há lançamentos em {earliest:%d/%m/%Y}, antes da nova data de abertura.",
            )
        account.opening_date = opening_date
    record(session, ctx, account, AuditAction.UPDATE, before)
    return account


def archive_account(session: Session, ctx: RequestContext, account_id: UUID) -> ArchiveResult:
    account = get_owned(session, Account, account_id, ctx.user_id, "a conta", for_update=True)
    if account.archived_at is not None:
        return ArchiveResult(account)
    before = snapshot(account)
    account.archived_at = ctx.now()
    record(session, ctx, account, AuditAction.ARCHIVE, before)
    return ArchiveResult(account)
```

- [ ] **Step 5: Substituir `backend/app/services/categories.py` pelo arquivo completo**

```python
"""Categorias: lista padrão, consultas e regras de edição."""

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.errors import Conflict, RuleViolation
from app.models import AuditAction, Category, CategoryKind
from app.repositories import get_owned, owned_select
from app.services.audit import record, snapshot
from app.services.context import RequestContext

UNCLASSIFIED = "A classificar"
FINANCIAL_CHARGES = "Encargos financeiros"

# (nome, essencial)
DEFAULT_EXPENSE_CATEGORIES: tuple[tuple[str, bool], ...] = (
    ("Alimentação", False),
    ("Mercado", False),
    ("Transporte", False),
    ("Moradia", True),
    ("Contas da casa", True),
    ("Saúde", True),
    ("Pets", True),
    ("Assinaturas", False),
    ("Compras diversas", False),
    ("Lazer", False),
    ("Hábitos pessoais", False),
    ("Educação", False),
)
DEFAULT_INCOME_CATEGORIES: tuple[str, ...] = (
    "Salário",
    "13º salário",
    "Receitas extras",
    "Reembolsos",
)


def seed_default_categories(session: Session, user_id: UUID) -> None:
    expense = CategoryKind.EXPENSE
    income = CategoryKind.INCOME
    rows = [
        Category(user_id=user_id, name=name, kind=expense, is_essential=essential)
        for name, essential in DEFAULT_EXPENSE_CATEGORIES
    ]
    rows += [Category(user_id=user_id, name=name, kind=income) for name in DEFAULT_INCOME_CATEGORIES]
    rows += [
        Category(user_id=user_id, name=UNCLASSIFIED, kind=expense, is_system=True),
        Category(user_id=user_id, name=FINANCIAL_CHARGES, kind=expense, is_system=True),
        Category(user_id=user_id, name=UNCLASSIFIED, kind=income, is_system=True),
    ]
    session.add_all(rows)
    session.flush()


def get_unclassified(session: Session, user_id: UUID, kind: CategoryKind) -> Category:
    return session.scalars(
        select(Category).where(
            Category.user_id == user_id,
            Category.kind == kind,
            Category.is_system.is_(True),
            Category.name == UNCLASSIFIED,
        )
    ).one()


def list_categories(
    session: Session,
    ctx: RequestContext,
    *,
    kind: CategoryKind | None = None,
    include_archived: bool = False,
) -> list[Category]:
    stmt = owned_select(Category, ctx.user_id).order_by(Category.kind, Category.name)
    if kind is not None:
        stmt = stmt.where(Category.kind == kind)
    if not include_archived:
        stmt = stmt.where(Category.archived_at.is_(None))
    return list(session.scalars(stmt))


def get_active_category(
    session: Session, ctx: RequestContext, category_id: UUID, kind: CategoryKind
) -> Category:
    category = get_owned(session, Category, category_id, ctx.user_id, "a categoria")
    if category.kind is not kind:
        raise RuleViolation(
            "category_kind_mismatch", "A categoria não é do tipo esperado (despesa ou receita)."
        )
    if category.archived_at is not None:
        raise RuleViolation("category_archived", f"A categoria {category.name} está arquivada.")
    return category


def _ensure_unique(
    session: Session,
    user_id: UUID,
    kind: CategoryKind,
    name: str,
    exclude_id: UUID | None = None,
) -> None:
    stmt = select(Category.id).where(
        Category.user_id == user_id, Category.kind == kind, Category.name == name
    )
    if exclude_id is not None:
        stmt = stmt.where(Category.id != exclude_id)
    if session.scalar(stmt) is not None:
        raise Conflict("name_already_exists", "Já existe uma categoria com esse nome.")


def _ensure_not_system(category: Category) -> None:
    if category.is_system:
        raise RuleViolation(
            "system_category_locked",
            "Categorias do sistema não podem ser renomeadas nem arquivadas.",
        )


def create_category(
    session: Session,
    ctx: RequestContext,
    *,
    name: str,
    kind: CategoryKind,
    is_essential: bool = False,
) -> Category:
    _ensure_unique(session, ctx.user_id, kind, name)
    category = Category(user_id=ctx.user_id, name=name, kind=kind, is_essential=is_essential)
    session.add(category)
    record(session, ctx, category, AuditAction.CREATE, before=None)
    return category


def update_category(
    session: Session,
    ctx: RequestContext,
    category_id: UUID,
    *,
    name: str | None = None,
    is_essential: bool | None = None,
) -> Category:
    category = get_owned(session, Category, category_id, ctx.user_id, "a categoria")
    before = snapshot(category)
    if name is not None and name != category.name:
        _ensure_not_system(category)
        _ensure_unique(session, ctx.user_id, category.kind, name, exclude_id=category.id)
        category.name = name
    if is_essential is not None:
        category.is_essential = is_essential
    record(session, ctx, category, AuditAction.UPDATE, before)
    return category


def archive_category(session: Session, ctx: RequestContext, category_id: UUID) -> Category:
    category = get_owned(session, Category, category_id, ctx.user_id, "a categoria")
    _ensure_not_system(category)
    if category.archived_at is not None:
        return category
    before = snapshot(category)
    category.archived_at = ctx.now()
    record(session, ctx, category, AuditAction.ARCHIVE, before)
    return category
```

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `uv run pytest tests/services -v`
Expected: PASS (todos os testes de services até aqui).

- [ ] **Step 7: Verificação completa e commit**

Run (na raiz): `bash scripts/check.sh`
Expected: tudo verde.

```bash
git add backend/app/services backend/tests
git commit -m "feat: contas e categorias com auditoria e arquivamento" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Consultas financeiras (ledger)

**Files:**
- Create: `backend/app/services/ledger.py`
- Modify: `backend/app/services/accounts.py` (`archive_account` passa a avisar saldo diferente de zero)
- Modify: `backend/tests/support.py` (adicionar `insert_tx`)
- Test: `backend/tests/services/test_ledger.py`

**Interfaces:**
- Consumes: modelos; `owned_select`; `month_range`; `normalize`; `quantize`, `format_brl`; `RuleViolation`, `Notice`.
- Produces: `ZERO = Decimal("0.00")`; `account_balances(session, user_id: UUID, as_of: date, account_ids: Sequence[UUID] | None = None) -> dict[UUID, Decimal]`; `total_balance(session, user_id, as_of) -> Decimal`; `@dataclass CategoryAmount(category_id: UUID, name: str, amount: Decimal)`; `@dataclass MonthSummary(year: int, month: int, income: Decimal, consumption_total: Decimal, by_category: list[CategoryAmount])`; `month_summary(session, user_id, year: int, month: int) -> MonthSummary`; `@dataclass TransactionFilters(date_from, date_to, account_id, category_id, merchant_id, payment_method, type, status=TransactionStatus.CONFIRMED)` (todos opcionais; `status=None` = todos); `@dataclass Page(items: list[Transaction], next_cursor: str | None)`; `list_transactions(session, user_id, filters, *, cursor: str | None = None, limit: int = 50) -> Page`; `possible_duplicates(session, user_id, *, amount: Decimal, merchant: str | None, occurred_on: date) -> list[Transaction]`; `@dataclass PaymentOption(account_id: UUID, account_name: str, payment_method: PaymentMethod)`; `top_payment_options(session, user_id, today: date, limit: int = 3) -> list[PaymentOption]`.
- Produces (testes): `insert_tx(db, ctx, *, type, amount: str, account, occurred_on=date(2026, 10, 10), category=None, destination=None, payment_method=None, refund_of=None, merchant=None, voided=False, description="teste") -> Transaction` (grava direto pelo ORM, sem regras de negócio).

- [ ] **Step 1: Acrescentar `insert_tx` a `backend/tests/support.py`**

O arquivo completo fica:

```python
"""Constantes e fábricas compartilhadas pelos testes."""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Account,
    AccountType,
    Category,
    CategoryKind,
    Merchant,
    PaymentMethod,
    Transaction,
    TransactionStatus,
    TransactionType,
)
from app.services import accounts
from app.services.auth import SessionPolicy
from app.services.context import RequestContext

PASSWORD = "senha-super-secreta"
FIXED_NOW = datetime(2026, 10, 15, 15, 0, tzinfo=UTC)  # 12h00 em São Paulo
POLICY = SessionPolicy(secret_key=b"k" * 32, idle=timedelta(days=30), max_age=timedelta(days=90))


def make_account(
    db: Session,
    ctx: RequestContext,
    name: str = "Itaú",
    opening_balance: str = "1000.00",
    opening_date: date = date(2026, 10, 1),
    account_type: AccountType = AccountType.CHECKING,
) -> Account:
    return accounts.create_account(
        db,
        ctx,
        name=name,
        account_type=account_type,
        opening_balance=Decimal(opening_balance),
        opening_date=opening_date,
    )


def find_category(
    db: Session, ctx: RequestContext, name: str, kind: CategoryKind = CategoryKind.EXPENSE
) -> Category:
    return db.scalars(
        select(Category).where(
            Category.user_id == ctx.user_id, Category.kind == kind, Category.name == name
        )
    ).one()


def insert_tx(
    db: Session,
    ctx: RequestContext,
    *,
    type: TransactionType,
    amount: str,
    account: Account,
    occurred_on: date = date(2026, 10, 10),
    category: Category | None = None,
    destination: Account | None = None,
    payment_method: PaymentMethod | None = None,
    refund_of: Transaction | None = None,
    merchant: Merchant | None = None,
    voided: bool = False,
    description: str = "teste",
) -> Transaction:
    """Grava um lançamento direto pelo ORM (sem regras) para testar consultas."""
    tx = Transaction(
        user_id=ctx.user_id,
        type=type,
        amount=Decimal(amount),
        occurred_on=occurred_on,
        description=description,
        account_id=account.id,
        category_id=category.id if category else None,
        destination_account_id=destination.id if destination else None,
        payment_method=payment_method,
        refund_of_id=refund_of.id if refund_of else None,
        merchant_id=merchant.id if merchant else None,
        status=TransactionStatus.VOIDED if voided else TransactionStatus.CONFIRMED,
        voided_at=FIXED_NOW if voided else None,
    )
    db.add(tx)
    db.flush()
    return tx
```

- [ ] **Step 2: Escrever os testes que falham**

`backend/tests/services/test_ledger.py`:

```python
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from app.domain.errors import RuleViolation
from app.models import (
    Account,
    CategoryKind,
    Merchant,
    PaymentMethod,
    Transaction,
    TransactionStatus,
    TransactionType,
)
from app.services import accounts, ledger
from app.services.context import RequestContext
from tests.support import find_category, insert_tx, make_account

INCOME, EXPENSE = TransactionType.INCOME, TransactionType.EXPENSE
TRANSFER, REFUND = TransactionType.TRANSFER, TransactionType.REFUND
PIX, DEBIT = PaymentMethod.PIX, PaymentMethod.DEBIT
AS_OF = date(2026, 10, 15)


def test_account_balance_combines_all_movement_types(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx, "Itaú", "1000.00")
    nubank = make_account(db, ctx, "Nubank", "0.00")
    mercado = find_category(db, ctx, "Mercado")
    salario = find_category(db, ctx, "Salário", CategoryKind.INCOME)

    insert_tx(db, ctx, type=INCOME, amount="3000.00", account=itau, category=salario)
    spent = insert_tx(
        db, ctx, type=EXPENSE, amount="200.00", account=itau, category=mercado, payment_method=PIX
    )
    insert_tx(db, ctx, type=REFUND, amount="50.00", account=itau, category=mercado, refund_of=spent)
    insert_tx(db, ctx, type=TRANSFER, amount="500.00", account=itau, destination=nubank)
    insert_tx(
        db, ctx, type=EXPENSE, amount="999.00", account=itau, category=mercado,
        payment_method=PIX, voided=True,
    )
    insert_tx(
        db, ctx, type=EXPENSE, amount="10.00", account=itau, category=mercado,
        payment_method=PIX, occurred_on=date(2026, 10, 20),
    )

    balances = ledger.account_balances(db, ctx.user_id, AS_OF)
    assert balances[itau.id] == Decimal("3350.00")  # 1000 + 3000 - 200 + 50 - 500
    assert balances[nubank.id] == Decimal("500.00")


def test_transfers_do_not_change_total(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx, "Itaú", "1000.00")
    nubank = make_account(db, ctx, "Nubank", "200.00")
    before = ledger.total_balance(db, ctx.user_id, AS_OF)
    insert_tx(db, ctx, type=TRANSFER, amount="300.00", account=itau, destination=nubank)
    assert ledger.total_balance(db, ctx.user_id, AS_OF) == before == Decimal("1200.00")


def test_account_opened_after_as_of_has_zero_balance(db: Session, ctx: RequestContext) -> None:
    future = make_account(db, ctx, "Nova", "500.00", opening_date=date(2026, 11, 1))
    assert ledger.account_balances(db, ctx.user_id, AS_OF)[future.id] == Decimal("0.00")


def test_month_summary_nets_refunds_and_ignores_other_types(
    db: Session, ctx: RequestContext
) -> None:
    itau = make_account(db, ctx, "Itaú", "1000.00")
    nubank = make_account(db, ctx, "Nubank", "0.00")
    mercado = find_category(db, ctx, "Mercado")
    saude = find_category(db, ctx, "Saúde")
    salario = find_category(db, ctx, "Salário", CategoryKind.INCOME)

    spent = insert_tx(
        db, ctx, type=EXPENSE, amount="200.00", account=itau, category=mercado, payment_method=PIX
    )
    insert_tx(db, ctx, type=REFUND, amount="50.00", account=itau, category=mercado, refund_of=spent)
    insert_tx(
        db, ctx, type=EXPENSE, amount="80.00", account=itau, category=saude, payment_method=DEBIT
    )
    insert_tx(db, ctx, type=TRANSFER, amount="500.00", account=itau, destination=nubank)
    insert_tx(db, ctx, type=INCOME, amount="3000.00", account=itau, category=salario)
    insert_tx(
        db, ctx, type=EXPENSE, amount="999.00", account=itau, category=mercado,
        payment_method=PIX, voided=True,
    )
    insert_tx(
        db, ctx, type=EXPENSE, amount="70.00", account=itau, category=mercado,
        payment_method=PIX, occurred_on=date(2026, 11, 2),
    )

    summary = ledger.month_summary(db, ctx.user_id, 2026, 10)
    assert {c.name: c.amount for c in summary.by_category} == {
        "Mercado": Decimal("150.00"),
        "Saúde": Decimal("80.00"),
    }
    assert summary.consumption_total == Decimal("230.00")
    assert summary.income == Decimal("3000.00")


def test_list_transactions_paginates_with_stable_cursor(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx)
    mercado = find_category(db, ctx, "Mercado")
    created = [
        insert_tx(
            db, ctx, type=EXPENSE, amount="10.00", account=itau, category=mercado,
            payment_method=PIX, occurred_on=date(2026, 10, day),
        )
        for day in (1, 2, 3, 4, 5)
    ]
    seen = []
    cursor = None
    while True:
        page = ledger.list_transactions(
            db, ctx.user_id, ledger.TransactionFilters(), cursor=cursor, limit=2
        )
        seen += [t.id for t in page.items]
        if page.next_cursor is None:
            break
        cursor = page.next_cursor
    assert seen == [t.id for t in reversed(created)]


def test_list_filter_by_account_includes_incoming_transfers(
    db: Session, ctx: RequestContext
) -> None:
    itau = make_account(db, ctx, "Itaú")
    nubank = make_account(db, ctx, "Nubank")
    transfer = insert_tx(db, ctx, type=TRANSFER, amount="10.00", account=itau, destination=nubank)
    page = ledger.list_transactions(
        db, ctx.user_id, ledger.TransactionFilters(account_id=nubank.id)
    )
    assert [t.id for t in page.items] == [transfer.id]


def test_list_excludes_voided_by_default(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx)
    mercado = find_category(db, ctx, "Mercado")
    insert_tx(
        db, ctx, type=EXPENSE, amount="10.00", account=itau, category=mercado,
        payment_method=PIX, voided=True,
    )
    assert ledger.list_transactions(db, ctx.user_id, ledger.TransactionFilters()).items == []
    everything = ledger.TransactionFilters(status=None)
    assert len(ledger.list_transactions(db, ctx.user_id, everything).items) == 1
    voided = ledger.TransactionFilters(status=TransactionStatus.VOIDED)
    assert len(ledger.list_transactions(db, ctx.user_id, voided).items) == 1


def test_invalid_cursor(db: Session, ctx: RequestContext) -> None:
    with pytest.raises(RuleViolation) as exc:
        ledger.list_transactions(db, ctx.user_id, ledger.TransactionFilters(), cursor="lixo!")
    assert exc.value.code == "invalid_cursor"


def test_possible_duplicates_window(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx)
    saude = find_category(db, ctx, "Saúde")
    drogasil = Merchant(user_id=ctx.user_id, name="Drogasil", normalized_name="drogasil")
    db.add(drogasil)
    db.flush()
    original = insert_tx(
        db, ctx, type=EXPENSE, amount="42.00", account=itau, category=saude,
        payment_method=PIX, merchant=drogasil, occurred_on=date(2026, 10, 10),
    )

    def find(amount: str, day: int) -> list[Transaction]:
        return ledger.possible_duplicates(
            db, ctx.user_id, amount=Decimal(amount), merchant="DROGASIL",
            occurred_on=date(2026, 10, day),
        )

    assert [t.id for t in find("42.00", 12)] == [original.id]
    assert find("42.00", 13) == []
    assert find("43.00", 10) == []


def test_top_payment_options(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx, "Itaú")
    nubank = make_account(db, ctx, "Nubank")
    mercado = find_category(db, ctx, "Mercado")

    def spend(
        account: Account, method: PaymentMethod, times: int, day: date = date(2026, 10, 10)
    ) -> None:
        for _ in range(times):
            insert_tx(
                db, ctx, type=EXPENSE, amount="1.00", account=account, category=mercado,
                payment_method=method, occurred_on=day,
            )

    spend(itau, PIX, 3)
    spend(itau, DEBIT, 2)
    spend(nubank, DEBIT, 1)
    spend(nubank, PIX, 5, day=date(2026, 6, 1))  # fora da janela de 90 dias

    options = ledger.top_payment_options(db, ctx.user_id, AS_OF)
    assert [(o.account_name, o.payment_method) for o in options] == [
        ("Itaú", PIX),
        ("Itaú", DEBIT),
        ("Nubank", DEBIT),
    ]


def test_other_users_data_is_invisible(
    db: Session, ctx: RequestContext, other_ctx: RequestContext
) -> None:
    mine = make_account(db, ctx, "Itaú")
    theirs = make_account(db, other_ctx, "Itaú")
    salario = find_category(db, other_ctx, "Salário", CategoryKind.INCOME)
    insert_tx(db, other_ctx, type=INCOME, amount="100.00", account=theirs, category=salario)
    assert set(ledger.account_balances(db, ctx.user_id, AS_OF)) == {mine.id}
    assert ledger.list_transactions(db, ctx.user_id, ledger.TransactionFilters()).items == []


def test_archive_account_warns_when_balance_not_zero(db: Session, ctx: RequestContext) -> None:
    with_money = make_account(db, ctx, "Itaú", "100.00")
    empty = make_account(db, ctx, "Vazia", "0.00")
    [notice] = accounts.archive_account(db, ctx, with_money.id).notices
    assert notice.code == "archived_with_balance"
    assert "R$ 100,00" in notice.detail
    assert accounts.archive_account(db, ctx, empty.id).notices == []
```

- [ ] **Step 3: Rodar e confirmar a falha**

Run: `uv run pytest tests/services/test_ledger.py -v`
Expected: FAIL — `ImportError: cannot import name 'ledger'`.

- [ ] **Step 4: Implementar `backend/app/services/ledger.py`**

```python
"""Consultas financeiras. Única fonte das definições de saldo, consumo e receita.

Nenhuma outra parte do código soma lançamentos por conta própria.
"""

import base64
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from app.domain.dates import month_range
from app.domain.errors import RuleViolation
from app.domain.merchants import normalize
from app.domain.money import quantize
from app.models import (
    Account,
    Category,
    Merchant,
    PaymentMethod,
    Transaction,
    TransactionStatus,
    TransactionType,
)
from app.repositories import owned_select

ZERO = Decimal("0.00")
DUPLICATE_WINDOW = timedelta(days=2)
PAYMENT_HISTORY = timedelta(days=90)
_CONFIRMED = Transaction.status == TransactionStatus.CONFIRMED


def account_balances(
    session: Session, user_id: UUID, as_of: date, account_ids: Sequence[UUID] | None = None
) -> dict[UUID, Decimal]:
    """Saldo de cada conta ao fim do dia `as_of`.

    saldo = abertura + receitas + estornos + transferências recebidas
            - despesas - transferências enviadas      (só lançamentos confirmados)

    O saldo de abertura vale para o início de `opening_date`; antes dessa data o saldo é zero.
    """
    accounts_stmt = owned_select(Account, user_id)
    if account_ids is not None:
        accounts_stmt = accounts_stmt.where(Account.id.in_(account_ids))
    accounts = session.scalars(accounts_stmt).all()

    signed = case(
        (
            Transaction.type.in_([TransactionType.INCOME, TransactionType.REFUND]),
            Transaction.amount,
        ),
        else_=-Transaction.amount,
    )
    base = (Transaction.user_id == user_id, _CONFIRMED, Transaction.occurred_on <= as_of)
    movements: defaultdict[UUID, Decimal] = defaultdict(lambda: ZERO)
    outgoing = (
        select(Transaction.account_id, func.sum(signed))
        .where(*base)
        .group_by(Transaction.account_id)
    )
    for account_id, total in session.execute(outgoing):
        movements[account_id] += total
    incoming = (
        select(Transaction.destination_account_id, func.sum(Transaction.amount))
        .where(*base, Transaction.type == TransactionType.TRANSFER)
        .group_by(Transaction.destination_account_id)
    )
    for account_id, total in session.execute(incoming):
        movements[account_id] += total

    return {
        a.id: ZERO if a.opening_date > as_of else quantize(a.opening_balance + movements[a.id])
        for a in accounts
    }


def total_balance(session: Session, user_id: UUID, as_of: date) -> Decimal:
    return quantize(sum(account_balances(session, user_id, as_of).values(), ZERO))


@dataclass(frozen=True)
class CategoryAmount:
    category_id: UUID
    name: str
    amount: Decimal


@dataclass(frozen=True)
class MonthSummary:
    year: int
    month: int
    income: Decimal
    consumption_total: Decimal
    by_category: list[CategoryAmount]


def month_summary(session: Session, user_id: UUID, year: int, month: int) -> MonthSummary:
    """Receitas e consumo do mês. Consumo = despesas - estornos (pela data de cada lançamento).

    Transferências nunca entram em receitas nem em consumo.
    """
    start, end = month_range(year, month)
    in_month = (
        Transaction.user_id == user_id,
        _CONFIRMED,
        Transaction.occurred_on.between(start, end),
    )
    signed = case(
        (Transaction.type == TransactionType.EXPENSE, Transaction.amount),
        else_=-Transaction.amount,
    )
    total = func.sum(signed)
    rows = session.execute(
        select(Category.id, Category.name, total)
        .select_from(Transaction)
        .join(Category, Category.id == Transaction.category_id)
        .where(*in_month, Transaction.type.in_([TransactionType.EXPENSE, TransactionType.REFUND]))
        .group_by(Category.id, Category.name)
        .order_by(total.desc(), Category.name)
    ).all()
    by_category = [CategoryAmount(cid, name, quantize(amount)) for cid, name, amount in rows]
    income = session.scalar(
        select(func.coalesce(func.sum(Transaction.amount), 0)).where(
            *in_month, Transaction.type == TransactionType.INCOME
        )
    )
    return MonthSummary(
        year=year,
        month=month,
        income=quantize(Decimal(income or 0)),
        consumption_total=quantize(sum((c.amount for c in by_category), ZERO)),
        by_category=by_category,
    )


@dataclass(frozen=True)
class TransactionFilters:
    date_from: date | None = None
    date_to: date | None = None
    account_id: UUID | None = None
    category_id: UUID | None = None
    merchant_id: UUID | None = None
    payment_method: PaymentMethod | None = None
    type: TransactionType | None = None
    status: TransactionStatus | None = TransactionStatus.CONFIRMED  # None = todos


@dataclass(frozen=True)
class Page:
    items: list[Transaction]
    next_cursor: str | None


def encode_cursor(tx: Transaction) -> str:
    raw = f"{tx.occurred_on.isoformat()}|{tx.id}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def decode_cursor(cursor: str) -> tuple[date, UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode()).decode()
        day, _, tx_id = raw.partition("|")
        return date.fromisoformat(day), UUID(tx_id)
    except ValueError as exc:
        raise RuleViolation("invalid_cursor", "Cursor de paginação inválido.") from exc


def list_transactions(
    session: Session,
    user_id: UUID,
    filters: TransactionFilters,
    *,
    cursor: str | None = None,
    limit: int = 50,
) -> Page:
    """Lista em ordem (data desc, id desc). O cursor é estável com lançamentos retroativos."""
    stmt = owned_select(Transaction, user_id)
    if filters.date_from is not None:
        stmt = stmt.where(Transaction.occurred_on >= filters.date_from)
    if filters.date_to is not None:
        stmt = stmt.where(Transaction.occurred_on <= filters.date_to)
    if filters.account_id is not None:
        stmt = stmt.where(
            or_(
                Transaction.account_id == filters.account_id,
                Transaction.destination_account_id == filters.account_id,
            )
        )
    if filters.category_id is not None:
        stmt = stmt.where(Transaction.category_id == filters.category_id)
    if filters.merchant_id is not None:
        stmt = stmt.where(Transaction.merchant_id == filters.merchant_id)
    if filters.payment_method is not None:
        stmt = stmt.where(Transaction.payment_method == filters.payment_method)
    if filters.type is not None:
        stmt = stmt.where(Transaction.type == filters.type)
    if filters.status is not None:
        stmt = stmt.where(Transaction.status == filters.status)
    if cursor is not None:
        day, last_id = decode_cursor(cursor)
        stmt = stmt.where(
            or_(
                Transaction.occurred_on < day,
                and_(Transaction.occurred_on == day, Transaction.id < last_id),
            )
        )
    stmt = stmt.order_by(Transaction.occurred_on.desc(), Transaction.id.desc()).limit(limit + 1)
    rows = list(session.scalars(stmt))
    next_cursor = encode_cursor(rows[limit - 1]) if len(rows) > limit else None
    return Page(items=rows[:limit], next_cursor=next_cursor)


def possible_duplicates(
    session: Session, user_id: UUID, *, amount: Decimal, merchant: str | None, occurred_on: date
) -> list[Transaction]:
    """Despesas confirmadas com mesmo valor e mesmo estabelecimento em ±2 dias."""
    normalized = normalize(merchant) if merchant else ""
    if not normalized:
        return []
    stmt = (
        select(Transaction)
        .join(Merchant, Merchant.id == Transaction.merchant_id)
        .where(
            Transaction.user_id == user_id,
            _CONFIRMED,
            Transaction.type == TransactionType.EXPENSE,
            Transaction.amount == quantize(amount),
            Merchant.normalized_name == normalized,
            Transaction.occurred_on.between(
                occurred_on - DUPLICATE_WINDOW, occurred_on + DUPLICATE_WINDOW
            ),
        )
        .order_by(Transaction.occurred_on.desc())
    )
    return list(session.scalars(stmt))


@dataclass(frozen=True)
class PaymentOption:
    account_id: UUID
    account_name: str
    payment_method: PaymentMethod


def top_payment_options(
    session: Session, user_id: UUID, today: date, limit: int = 3
) -> list[PaymentOption]:
    """Combinações conta + meio mais usadas em despesas dos últimos 90 dias."""
    uses = func.count(Transaction.id)
    rows = session.execute(
        select(Account.id, Account.name, Transaction.payment_method, uses)
        .select_from(Transaction)
        .join(Account, Account.id == Transaction.account_id)
        .where(
            Transaction.user_id == user_id,
            _CONFIRMED,
            Transaction.type == TransactionType.EXPENSE,
            Transaction.occurred_on >= today - PAYMENT_HISTORY,
            Account.archived_at.is_(None),
        )
        .group_by(Account.id, Account.name, Transaction.payment_method)
        .order_by(uses.desc(), Account.name, Transaction.payment_method)
        .limit(limit)
    ).all()
    return [PaymentOption(account_id, name, method) for account_id, name, method, _ in rows]
```

- [ ] **Step 5: Fazer `archive_account` avisar saldo diferente de zero**

Em `backend/app/services/accounts.py`, troque a linha `from app.domain.money import quantize` por:

```python
from app.domain.money import format_brl, quantize
```

acrescente `from app.services import ledger` aos imports e substitua o final de `archive_account` (depois do `if account.archived_at is not None: ...`) por:

```python
    before = snapshot(account)
    account.archived_at = ctx.now()
    record(session, ctx, account, AuditAction.ARCHIVE, before)
    balance = ledger.account_balances(session, ctx.user_id, ctx.today(), [account.id])[account.id]
    if balance == 0:
        return ArchiveResult(account)
    notice = Notice(
        "archived_with_balance", f"A conta foi arquivada com saldo de {format_brl(balance)}."
    )
    return ArchiveResult(account, [notice])
```

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `uv run pytest tests/services -v`
Expected: PASS (todos).

- [ ] **Step 7: Verificação completa e commit**

Run (na raiz): `bash scripts/check.sh`
Expected: tudo verde.

```bash
git add backend/app/services backend/tests
git commit -m "feat(ledger): saldos, resumo do mês, lista paginada, duplicatas e atalhos" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Criação de lançamentos (receita, despesa, transferência)

**Files:**
- Create: `backend/app/services/merchants.py`, `backend/app/services/transactions.py`
- Test: `backend/tests/services/test_transactions_create.py`

**Interfaces:**
- Consumes: `get_active_account` (Tarefa 8), `get_active_category`, `get_unclassified` (Tarefa 8), `ledger.account_balances` (Tarefa 9), `record`, `jsonable` (Tarefa 5), `resolve_category` (Tarefa 3).
- Produces (`merchants`): `resolve_merchant(session, user_id: UUID, name: str | None) -> Merchant | None` (cria se não existir), `search_merchants(session, user_id: UUID, query: str, limit: int = 10) -> list[Merchant]` (exato primeiro).
- Produces (`transactions`): dataclasses `NewIncome(amount, occurred_on, description, account_id, category_id=None, merchant=None, notes=None)`, `NewExpense(amount, occurred_on, description, account_id, payment_method, category_id=None, merchant=None, notes=None)`, `NewTransfer(amount, occurred_on, description, account_id, destination_account_id, notes=None)`; `type NewTransaction = NewIncome | NewExpense | NewTransfer`; `@dataclass(frozen=True) WriteResult(transaction: Transaction, replayed: bool = False, notices: list[Notice] = [])`; `create_transaction(session, ctx, data: NewTransaction, *, idempotency_key: str | None = None, source: TransactionSource = TransactionSource.MANUAL) -> WriteResult`. Funções internas usadas na Tarefa 11: `payload_hash`, `_find_by_key`, `_replay`, `_insert`, `_require_positive`, `_check_opening`, `_learn`, `_negative_balance_notices`.

- [ ] **Step 1: Escrever os testes que falham**

`backend/tests/services/test_transactions_create.py`:

```python
from dataclasses import replace
from datetime import date
from decimal import Decimal
from typing import Any
from uuid import UUID

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domain.errors import Conflict, NotFound, RuleViolation
from app.models import (
    Account,
    Actor,
    AuditAction,
    AuditLog,
    CategoryKind,
    Merchant,
    PaymentMethod,
    Transaction,
    TransactionSource,
    TransactionType,
)
from app.services import accounts, categories, transactions
from app.services.context import RequestContext
from app.services.transactions import NewExpense, NewIncome, NewTransfer
from tests.support import find_category, make_account

TODAY = date(2026, 10, 15)


def _expense(account: Account, **overrides: Any) -> NewExpense:
    data: dict[str, Any] = {
        "amount": Decimal("42.00"),
        "occurred_on": TODAY,
        "description": "Mercado",
        "account_id": account.id,
        "payment_method": PaymentMethod.PIX,
    }
    data.update(overrides)
    return NewExpense(**data)


def _audit_actions(db: Session, entity_id: UUID) -> list[AuditAction]:
    return list(db.scalars(select(AuditLog.action).where(AuditLog.entity_id == entity_id)))


def test_expense_without_category_goes_to_unclassified_and_creates_merchant(
    db: Session, ctx: RequestContext
) -> None:
    itau = make_account(db, ctx)
    result = transactions.create_transaction(db, ctx, _expense(itau, description="Padaria do Zé"))
    tx = result.transaction
    assert not result.replayed
    assert tx.type is TransactionType.EXPENSE
    assert tx.amount == Decimal("42.00")
    assert tx.payment_method is PaymentMethod.PIX
    unclassified = categories.get_unclassified(db, ctx.user_id, CategoryKind.EXPENSE)
    assert tx.category_id == unclassified.id
    assert tx.merchant_id is not None
    merchant = db.get(Merchant, tx.merchant_id)
    assert merchant is not None and merchant.normalized_name == "padaria do ze"
    assert _audit_actions(db, tx.id) == [AuditAction.CREATE]


def test_explicit_category_is_learned_for_merchant(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx)
    saude = find_category(db, ctx, "Saúde")
    transactions.create_transaction(
        db, ctx, _expense(itau, description="Drogasil", category_id=saude.id)
    )
    second = transactions.create_transaction(
        db, ctx, _expense(itau, description="DROGASIL", amount=Decimal("10.00"))
    )
    assert second.transaction.category_id == saude.id
    merchants = db.scalar(
        select(func.count()).select_from(Merchant).where(Merchant.user_id == ctx.user_id)
    )
    assert merchants == 1


def test_system_category_is_not_learned(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx)
    unclassified = categories.get_unclassified(db, ctx.user_id, CategoryKind.EXPENSE)
    transactions.create_transaction(
        db, ctx, _expense(itau, description="Feira", category_id=unclassified.id)
    )
    merchant = db.scalars(select(Merchant).where(Merchant.normalized_name == "feira")).one()
    assert merchant.default_category_id is None


def test_archived_default_category_falls_back_to_unclassified(
    db: Session, ctx: RequestContext
) -> None:
    itau = make_account(db, ctx)
    trips = categories.create_category(db, ctx, name="Viagens", kind=CategoryKind.EXPENSE)
    transactions.create_transaction(
        db, ctx, _expense(itau, description="Hotel X", category_id=trips.id)
    )
    categories.archive_category(db, ctx, trips.id)
    later = transactions.create_transaction(db, ctx, _expense(itau, description="Hotel X"))
    unclassified = categories.get_unclassified(db, ctx.user_id, CategoryKind.EXPENSE)
    assert later.transaction.category_id == unclassified.id


def test_income_ignores_expense_default_of_merchant(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx)
    lazer = find_category(db, ctx, "Lazer")
    transactions.create_transaction(
        db, ctx, _expense(itau, description="Empresa X", category_id=lazer.id)
    )
    income = transactions.create_transaction(
        db,
        ctx,
        NewIncome(
            amount=Decimal("100.00"),
            occurred_on=TODAY,
            description="Empresa X",
            account_id=itau.id,
        ),
    )
    unclassified = categories.get_unclassified(db, ctx.user_id, CategoryKind.INCOME)
    assert income.transaction.category_id == unclassified.id


def test_income_rejects_expense_category(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx)
    lazer = find_category(db, ctx, "Lazer")
    data = NewIncome(
        amount=Decimal("1.00"),
        occurred_on=TODAY,
        description="x",
        account_id=itau.id,
        category_id=lazer.id,
    )
    with pytest.raises(RuleViolation) as exc:
        transactions.create_transaction(db, ctx, data)
    assert exc.value.code == "category_kind_mismatch"


def test_transfer_moves_between_accounts(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx, "Itaú")
    nubank = make_account(db, ctx, "Nubank")
    transfer = transactions.create_transaction(
        db,
        ctx,
        NewTransfer(
            amount=Decimal("300.00"),
            occurred_on=TODAY,
            description="Reserva",
            account_id=itau.id,
            destination_account_id=nubank.id,
        ),
    ).transaction
    assert transfer.category_id is None
    assert transfer.merchant_id is None
    assert transfer.destination_account_id == nubank.id


def test_transfer_same_account_rejected(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx)
    data = NewTransfer(
        amount=Decimal("1.00"),
        occurred_on=TODAY,
        description="x",
        account_id=itau.id,
        destination_account_id=itau.id,
    )
    with pytest.raises(RuleViolation) as exc:
        transactions.create_transaction(db, ctx, data)
    assert exc.value.code == "transfer_same_account"


def test_date_before_opening_rejected(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx, "Itaú", opening_date=date(2026, 10, 1))
    later = make_account(db, ctx, "Nova", opening_date=date(2026, 10, 20))
    with pytest.raises(RuleViolation) as exc:
        transactions.create_transaction(db, ctx, _expense(itau, occurred_on=date(2026, 9, 30)))
    assert exc.value.code == "date_before_account_opening"
    transfer = NewTransfer(
        amount=Decimal("1.00"),
        occurred_on=TODAY,
        description="x",
        account_id=itau.id,
        destination_account_id=later.id,
    )
    with pytest.raises(RuleViolation) as exc:
        transactions.create_transaction(db, ctx, transfer)
    assert exc.value.code == "date_before_account_opening"


def test_archived_account_rejected(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx)
    accounts.archive_account(db, ctx, itau.id)
    with pytest.raises(RuleViolation) as exc:
        transactions.create_transaction(db, ctx, _expense(itau))
    assert exc.value.code == "account_archived"


def test_other_users_account_not_found(
    db: Session, ctx: RequestContext, other_ctx: RequestContext
) -> None:
    foreign = make_account(db, other_ctx)
    with pytest.raises(NotFound):
        transactions.create_transaction(db, ctx, _expense(foreign))


def test_amount_must_be_positive(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx)
    with pytest.raises(RuleViolation) as exc:
        transactions.create_transaction(db, ctx, _expense(itau, amount=Decimal("0")))
    assert exc.value.code == "amount_not_positive"


def test_idempotent_replay_returns_same_transaction(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx)
    data = _expense(itau)
    first = transactions.create_transaction(db, ctx, data, idempotency_key="chave-0001")
    second = transactions.create_transaction(db, ctx, data, idempotency_key="chave-0001")
    assert second.replayed
    assert second.transaction.id == first.transaction.id
    stored = db.scalar(
        select(func.count())
        .select_from(Transaction)
        .where(Transaction.idempotency_key == "chave-0001")
    )
    assert stored == 1
    assert _audit_actions(db, first.transaction.id) == [AuditAction.CREATE]


def test_idempotency_key_reuse_with_different_payload_conflicts(
    db: Session, ctx: RequestContext
) -> None:
    itau = make_account(db, ctx)
    transactions.create_transaction(db, ctx, _expense(itau), idempotency_key="chave-0001")
    with pytest.raises(Conflict) as exc:
        transactions.create_transaction(
            db, ctx, _expense(itau, amount=Decimal("43.00")), idempotency_key="chave-0001"
        )
    assert exc.value.code == "idempotency_key_reused"


def test_idempotency_race_returns_existing(
    db: Session, ctx: RequestContext, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Simula duas requisições simultâneas: a segunda não vê a primeira na checagem inicial."""
    itau = make_account(db, ctx)
    data = _expense(itau)
    first = transactions.create_transaction(db, ctx, data, idempotency_key="chave-0002")

    real_find = transactions._find_by_key
    calls = {"n": 0}

    def flaky_find(session: Session, user_id: UUID, key: str) -> Transaction | None:
        calls["n"] += 1
        return None if calls["n"] == 1 else real_find(session, user_id, key)

    monkeypatch.setattr(transactions, "_find_by_key", flaky_find)
    again = transactions.create_transaction(db, ctx, data, idempotency_key="chave-0002")
    assert again.replayed
    assert again.transaction.id == first.transaction.id


def test_negative_balance_notice(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx, opening_balance="10.00")
    [notice] = transactions.create_transaction(db, ctx, _expense(itau)).notices
    assert notice.code == "negative_balance"
    assert "-R$ 32,00" in notice.detail


def test_source_and_actor_recorded(db: Session, ctx: RequestContext) -> None:
    itau = make_account(db, ctx)
    ai_ctx = replace(ctx, actor=Actor.AI)
    tx = transactions.create_transaction(
        db, ai_ctx, _expense(itau), source=TransactionSource.AI
    ).transaction
    assert tx.source is TransactionSource.AI
    log = db.scalars(select(AuditLog).where(AuditLog.entity_id == tx.id)).one()
    assert log.actor is Actor.AI


def test_account_opening_date_cannot_move_after_existing_transactions(
    db: Session, ctx: RequestContext
) -> None:
    itau = make_account(db, ctx)
    transactions.create_transaction(db, ctx, _expense(itau, occurred_on=date(2026, 10, 5)))
    with pytest.raises(RuleViolation) as exc:
        accounts.update_account(db, ctx, itau.id, opening_date=date(2026, 10, 10))
    assert exc.value.code == "date_before_account_opening"
    accounts.update_account(db, ctx, itau.id, opening_date=date(2026, 10, 5))
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `uv run pytest tests/services/test_transactions_create.py -v`
Expected: FAIL — `ImportError: cannot import name 'transactions'`.

- [ ] **Step 3: Implementar `backend/app/services/merchants.py`**

```python
"""Estabelecimentos e a memória estabelecimento → categoria."""

from uuid import UUID

from sqlalchemy import case, select
from sqlalchemy.orm import Session

from app.domain.merchants import normalize
from app.models import Merchant


def resolve_merchant(session: Session, user_id: UUID, name: str | None) -> Merchant | None:
    """Encontra o estabelecimento pelo nome normalizado ou cria um novo."""
    if name is None:
        return None
    normalized = normalize(name)[:120]
    if not normalized:
        return None
    merchant = session.scalar(
        select(Merchant).where(Merchant.user_id == user_id, Merchant.normalized_name == normalized)
    )
    if merchant is None:
        merchant = Merchant(user_id=user_id, name=name.strip()[:120], normalized_name=normalized)
        session.add(merchant)
        session.flush()
    return merchant


def search_merchants(
    session: Session, user_id: UUID, query: str, limit: int = 10
) -> list[Merchant]:
    normalized = normalize(query)
    if not normalized:
        return []
    exact_first = case((Merchant.normalized_name == normalized, 0), else_=1)
    stmt = (
        select(Merchant)
        .where(
            Merchant.user_id == user_id,
            Merchant.normalized_name.contains(normalized, autoescape=True),
        )
        .order_by(exact_first, Merchant.normalized_name)
        .limit(limit)
    )
    return list(session.scalars(stmt))
```

- [ ] **Step 4: Implementar `backend/app/services/transactions.py`**

```python
"""Casos de uso de escrita de lançamentos."""

import hashlib
import json
from dataclasses import asdict, dataclass, field
from datetime import date
from decimal import Decimal
from typing import assert_never
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domain.categorization import resolve_category
from app.domain.errors import Conflict, Notice, RuleViolation
from app.domain.money import format_brl, quantize
from app.models import (
    Account,
    AuditAction,
    Category,
    CategoryKind,
    Merchant,
    PaymentMethod,
    Transaction,
    TransactionSource,
    TransactionType,
)
from app.services import ledger
from app.services.accounts import get_active_account
from app.services.audit import jsonable, record
from app.services.categories import get_active_category, get_unclassified
from app.services.context import RequestContext
from app.services.merchants import resolve_merchant


@dataclass(frozen=True)
class NewIncome:
    amount: Decimal
    occurred_on: date
    description: str
    account_id: UUID
    category_id: UUID | None = None
    merchant: str | None = None
    notes: str | None = None


@dataclass(frozen=True)
class NewExpense:
    amount: Decimal
    occurred_on: date
    description: str
    account_id: UUID
    payment_method: PaymentMethod
    category_id: UUID | None = None
    merchant: str | None = None
    notes: str | None = None


@dataclass(frozen=True)
class NewTransfer:
    amount: Decimal
    occurred_on: date
    description: str
    account_id: UUID
    destination_account_id: UUID
    notes: str | None = None


type NewTransaction = NewIncome | NewExpense | NewTransfer


@dataclass(frozen=True)
class WriteResult:
    transaction: Transaction
    replayed: bool = False
    notices: list[Notice] = field(default_factory=list)


# --- idempotência ----------------------------------------------------------------------------


def payload_hash(kind: str, fields: dict[str, object]) -> bytes:
    body = {"kind": kind, **{key: jsonable(value) for key, value in fields.items()}}
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).digest()


def _find_by_key(session: Session, user_id: UUID, key: str) -> Transaction | None:
    return session.scalar(
        select(Transaction).where(
            Transaction.user_id == user_id, Transaction.idempotency_key == key
        )
    )


def _replay(existing: Transaction, digest: bytes) -> WriteResult:
    if existing.idempotency_payload_hash != digest:
        raise Conflict(
            "idempotency_key_reused", "Esta chave de idempotência já foi usada com outro conteúdo."
        )
    return WriteResult(existing, replayed=True)


def _insert(
    session: Session,
    ctx: RequestContext,
    tx: Transaction,
    key: str | None,
    digest: bytes | None,
) -> WriteResult | None:
    """Insere e audita. Se outra requisição com a mesma chave venceu a corrida, devolve a dela."""
    tx.idempotency_key = key
    tx.idempotency_payload_hash = digest
    try:
        with session.begin_nested():
            session.add(tx)
            session.flush()
    except IntegrityError:
        if key is None or digest is None:
            raise
        existing = _find_by_key(session, ctx.user_id, key)
        if existing is None:
            raise
        return _replay(existing, digest)
    record(session, ctx, tx, AuditAction.CREATE, before=None)
    return None


# --- regras compartilhadas ------------------------------------------------------------------


def _require_positive(amount: Decimal) -> None:
    if amount <= 0:
        raise RuleViolation("amount_not_positive", "O valor deve ser maior que zero.")


def _check_opening(account: Account, occurred_on: date) -> None:
    if occurred_on < account.opening_date:
        raise RuleViolation(
            "date_before_account_opening",
            f"A data é anterior à abertura da conta {account.name} "
            f"({account.opening_date:%d/%m/%Y}).",
        )


def _learn(merchant: Merchant | None, category: Category) -> None:
    """Memoriza a categoria escolhida explicitamente (categorias de sistema não contam)."""
    if merchant is not None and not category.is_system:
        merchant.default_category_id = category.id


def _usable_default(
    session: Session, merchant: Merchant | None, kind: CategoryKind
) -> UUID | None:
    if merchant is None or merchant.default_category_id is None:
        return None
    default = session.get(Category, merchant.default_category_id)
    if default is None or default.kind is not kind or default.archived_at is not None:
        return None
    return default.id


def _resolve_category(
    session: Session,
    ctx: RequestContext,
    explicit_id: UUID | None,
    merchant: Merchant | None,
    kind: CategoryKind,
) -> Category:
    if explicit_id is not None:
        return get_active_category(session, ctx, explicit_id, kind)
    unclassified = get_unclassified(session, ctx.user_id, kind)
    chosen = resolve_category(None, _usable_default(session, merchant, kind), unclassified.id)
    return unclassified if chosen == unclassified.id else session.get_one(Category, chosen)


def _negative_balance_notices(
    session: Session, ctx: RequestContext, account_ids: list[UUID], as_of: date
) -> list[Notice]:
    if not account_ids:
        return []
    balances = ledger.account_balances(session, ctx.user_id, as_of, account_ids)
    notices = []
    for account_id, balance in balances.items():
        if balance < 0:
            name = session.get_one(Account, account_id).name
            notices.append(
                Notice(
                    "negative_balance",
                    f"A conta {name} ficou com saldo negativo ({format_brl(balance)}).",
                )
            )
    return notices


# --- criação --------------------------------------------------------------------------------


def _build_categorized(
    session: Session,
    ctx: RequestContext,
    data: NewIncome | NewExpense,
    tx_type: TransactionType,
    payment_method: PaymentMethod | None,
) -> Transaction:
    kind = CategoryKind.EXPENSE if tx_type is TransactionType.EXPENSE else CategoryKind.INCOME
    account = get_active_account(session, ctx, data.account_id)
    _check_opening(account, data.occurred_on)
    merchant = resolve_merchant(session, ctx.user_id, data.merchant or data.description)
    category = _resolve_category(session, ctx, data.category_id, merchant, kind)
    if data.category_id is not None:
        _learn(merchant, category)
    return Transaction(
        user_id=ctx.user_id,
        type=tx_type,
        amount=quantize(data.amount),
        occurred_on=data.occurred_on,
        description=data.description,
        notes=data.notes,
        merchant_id=merchant.id if merchant else None,
        category_id=category.id,
        account_id=account.id,
        payment_method=payment_method,
    )


def _build_transfer(session: Session, ctx: RequestContext, data: NewTransfer) -> Transaction:
    if data.account_id == data.destination_account_id:
        raise RuleViolation(
            "transfer_same_account", "Origem e destino da transferência devem ser contas diferentes."
        )
    source = get_active_account(session, ctx, data.account_id)
    destination = get_active_account(session, ctx, data.destination_account_id)
    for account in (source, destination):
        _check_opening(account, data.occurred_on)
    return Transaction(
        user_id=ctx.user_id,
        type=TransactionType.TRANSFER,
        amount=quantize(data.amount),
        occurred_on=data.occurred_on,
        description=data.description,
        notes=data.notes,
        account_id=source.id,
        destination_account_id=destination.id,
    )


def create_transaction(
    session: Session,
    ctx: RequestContext,
    data: NewTransaction,
    *,
    idempotency_key: str | None = None,
    source: TransactionSource = TransactionSource.MANUAL,
) -> WriteResult:
    digest = payload_hash(type(data).__name__, asdict(data)) if idempotency_key else None
    if idempotency_key is not None and digest is not None:
        existing = _find_by_key(session, ctx.user_id, idempotency_key)
        if existing is not None:
            return _replay(existing, digest)

    _require_positive(data.amount)
    match data:
        case NewTransfer():
            tx = _build_transfer(session, ctx, data)
        case NewExpense():
            tx = _build_categorized(
                session, ctx, data, TransactionType.EXPENSE, data.payment_method
            )
        case NewIncome():
            tx = _build_categorized(session, ctx, data, TransactionType.INCOME, None)
        case _:
            assert_never(data)
    tx.source = source

    raced = _insert(session, ctx, tx, idempotency_key, digest)
    if raced is not None:
        return raced
    spends = tx.type in (TransactionType.EXPENSE, TransactionType.TRANSFER)
    outflow = [tx.account_id] if spends else []
    as_of = max(ctx.today(), tx.occurred_on)
    return WriteResult(tx, notices=_negative_balance_notices(session, ctx, outflow, as_of))
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `uv run pytest tests/services/test_transactions_create.py -v`
Expected: PASS (17).

- [ ] **Step 6: Verificação completa e commit**

Run (na raiz): `bash scripts/check.sh`
Expected: tudo verde.

```bash
git add backend/app/services backend/tests/services/test_transactions_create.py
git commit -m "feat(transações): criação com memória de categoria, idempotência e avisos" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Estorno, edição e anulação de lançamentos

**Files:**
- Modify: `backend/app/services/transactions.py` (novos imports + código ao final)
- Test: `backend/tests/services/test_transactions_changes.py`

**Interfaces:**
- Consumes: tudo da Tarefa 10; `get_owned` (Tarefa 5); `snapshot` (Tarefa 5); `ledger.month_summary`, `ledger.account_balances` (Tarefa 9).
- Produces: `@dataclass(frozen=True) NewRefund(amount: Decimal, occurred_on: date, account_id: UUID | None = None, description: str | None = None)`; `create_refund(session, ctx, expense_id: UUID, data: NewRefund, *, idempotency_key: str | None = None, source: TransactionSource = TransactionSource.MANUAL) -> WriteResult`; `update_transaction(session, ctx, transaction_id: UUID, changes: Mapping[str, Any]) -> WriteResult` (chaves aceitas: `amount`, `occurred_on`, `description`, `notes`, `merchant`, `category_id`, `account_id`, `destination_account_id`, `payment_method`, conforme o tipo); `void_transaction(session, ctx, transaction_id: UUID) -> Transaction`. Códigos de erro novos: `refund_requires_expense`, `transaction_voided`, `refund_exceeds_original`, `refund_before_expense`, `field_not_editable`, `field_required`, `amount_below_refunds`, `has_active_refunds`.

- [ ] **Step 1: Escrever os testes que falham**

`backend/tests/services/test_transactions_changes.py`:

```python
from datetime import date
from decimal import Decimal
from uuid import UUID

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.errors import RuleViolation
from app.models import (
    Account,
    AuditAction,
    AuditLog,
    Merchant,
    PaymentMethod,
    Transaction,
    TransactionStatus,
)
from app.services import ledger, transactions
from app.services.context import RequestContext
from app.services.transactions import NewExpense, NewIncome, NewRefund, NewTransfer, WriteResult
from tests.support import find_category, make_account

TODAY = date(2026, 10, 15)


@pytest.fixture
def itau(db: Session, ctx: RequestContext) -> Account:
    return make_account(db, ctx, "Itaú", "1000.00")


@pytest.fixture
def expense(db: Session, ctx: RequestContext, itau: Account) -> Transaction:
    mercado = find_category(db, ctx, "Mercado")
    data = NewExpense(
        amount=Decimal("42.00"),
        occurred_on=date(2026, 10, 10),
        description="Mercado",
        account_id=itau.id,
        payment_method=PaymentMethod.PIX,
        category_id=mercado.id,
    )
    return transactions.create_transaction(db, ctx, data).transaction


def _refund(
    db: Session,
    ctx: RequestContext,
    expense: Transaction,
    amount: str = "10.00",
    occurred_on: date = TODAY,
    key: str | None = None,
) -> WriteResult:
    data = NewRefund(amount=Decimal(amount), occurred_on=occurred_on)
    return transactions.create_refund(db, ctx, expense.id, data, idempotency_key=key)


def _code(exc: pytest.ExceptionInfo[RuleViolation]) -> str:
    return exc.value.code


def _audits(db: Session, entity_id: UUID) -> list[AuditLog]:
    return list(
        db.scalars(select(AuditLog).where(AuditLog.entity_id == entity_id).order_by(AuditLog.id))
    )


def test_refund_copies_category_and_defaults(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    refund = _refund(db, ctx, expense).transaction
    assert refund.refund_of_id == expense.id
    assert refund.category_id == expense.category_id
    assert refund.account_id == expense.account_id
    assert refund.merchant_id == expense.merchant_id
    assert refund.description == "Estorno: Mercado"


def test_refunds_cannot_exceed_original(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    _refund(db, ctx, expense, "30.00")
    _refund(db, ctx, expense, "12.00")
    with pytest.raises(RuleViolation) as exc:
        _refund(db, ctx, expense, "0.01")
    assert _code(exc) == "refund_exceeds_original"


def test_refund_requires_confirmed_expense(
    db: Session, ctx: RequestContext, itau: Account, expense: Transaction
) -> None:
    income = transactions.create_transaction(
        db,
        ctx,
        NewIncome(
            amount=Decimal("5.00"), occurred_on=TODAY, description="Pix", account_id=itau.id
        ),
    ).transaction
    with pytest.raises(RuleViolation) as exc:
        _refund(db, ctx, income, "1.00")
    assert _code(exc) == "refund_requires_expense"

    transactions.void_transaction(db, ctx, expense.id)
    with pytest.raises(RuleViolation) as exc:
        _refund(db, ctx, expense)
    assert _code(exc) == "transaction_voided"


def test_refund_date_cannot_precede_expense(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    with pytest.raises(RuleViolation) as exc:
        _refund(db, ctx, expense, occurred_on=date(2026, 10, 9))
    assert _code(exc) == "refund_before_expense"


def test_refund_is_idempotent(db: Session, ctx: RequestContext, expense: Transaction) -> None:
    first = _refund(db, ctx, expense, key="estorno-0001")
    second = _refund(db, ctx, expense, key="estorno-0001")
    assert second.replayed and second.transaction.id == first.transaction.id


def test_refund_reduces_consumption(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    _refund(db, ctx, expense)
    summary = ledger.month_summary(db, ctx.user_id, 2026, 10)
    assert {c.name: c.amount for c in summary.by_category} == {"Mercado": Decimal("32.00")}


def test_update_amount_audits_before_and_after(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    updated = transactions.update_transaction(
        db, ctx, expense.id, {"amount": Decimal("50.00")}
    ).transaction
    assert updated.amount == Decimal("50.00")
    log = _audits(db, expense.id)[-1]
    assert log.action is AuditAction.UPDATE
    assert log.before is not None and log.before["amount"] == "42.00"
    assert log.after is not None and log.after["amount"] == "50.00"


def test_update_rejects_fields_not_editable_for_type(
    db: Session, ctx: RequestContext, itau: Account, expense: Transaction
) -> None:
    income = transactions.create_transaction(
        db,
        ctx,
        NewIncome(
            amount=Decimal("5.00"), occurred_on=TODAY, description="Pix", account_id=itau.id
        ),
    ).transaction
    with pytest.raises(RuleViolation) as exc:
        transactions.update_transaction(db, ctx, income.id, {"payment_method": PaymentMethod.PIX})
    assert _code(exc) == "field_not_editable"
    with pytest.raises(RuleViolation) as exc:
        transactions.update_transaction(db, ctx, expense.id, {"destination_account_id": itau.id})
    assert _code(exc) == "field_not_editable"


def test_update_rejects_null_required_field(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    with pytest.raises(RuleViolation) as exc:
        transactions.update_transaction(db, ctx, expense.id, {"amount": None})
    assert _code(exc) == "field_required"


def test_update_amount_cannot_go_below_refunds(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    _refund(db, ctx, expense, "30.00")
    with pytest.raises(RuleViolation) as exc:
        transactions.update_transaction(db, ctx, expense.id, {"amount": Decimal("20.00")})
    assert _code(exc) == "amount_below_refunds"


def test_update_refund_amount_respects_original(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    _refund(db, ctx, expense, "30.00")
    second = _refund(db, ctx, expense, "10.00").transaction
    with pytest.raises(RuleViolation) as exc:
        transactions.update_transaction(db, ctx, second.id, {"amount": Decimal("13.00")})
    assert _code(exc) == "refund_exceeds_original"
    transactions.update_transaction(db, ctx, second.id, {"amount": Decimal("12.00")})


def test_update_voided_rejected(db: Session, ctx: RequestContext, expense: Transaction) -> None:
    transactions.void_transaction(db, ctx, expense.id)
    with pytest.raises(RuleViolation) as exc:
        transactions.update_transaction(db, ctx, expense.id, {"description": "x"})
    assert _code(exc) == "transaction_voided"


def test_update_transfer_same_account_rejected(
    db: Session, ctx: RequestContext, itau: Account
) -> None:
    nubank = make_account(db, ctx, "Nubank")
    transfer = transactions.create_transaction(
        db,
        ctx,
        NewTransfer(
            amount=Decimal("10.00"),
            occurred_on=TODAY,
            description="Reserva",
            account_id=itau.id,
            destination_account_id=nubank.id,
        ),
    ).transaction
    with pytest.raises(RuleViolation) as exc:
        transactions.update_transaction(db, ctx, transfer.id, {"destination_account_id": itau.id})
    assert _code(exc) == "transfer_same_account"


def test_update_date_before_opening_rejected(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    with pytest.raises(RuleViolation) as exc:
        transactions.update_transaction(db, ctx, expense.id, {"occurred_on": date(2026, 9, 30)})
    assert _code(exc) == "date_before_account_opening"


def test_update_expense_date_after_refund_rejected(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    _refund(db, ctx, expense, occurred_on=date(2026, 10, 12))
    with pytest.raises(RuleViolation) as exc:
        transactions.update_transaction(db, ctx, expense.id, {"occurred_on": date(2026, 10, 13)})
    assert _code(exc) == "refund_before_expense"


def test_update_category_propagates_to_refunds_and_teaches_merchant(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    refund = _refund(db, ctx, expense).transaction
    alimentacao = find_category(db, ctx, "Alimentação")
    transactions.update_transaction(db, ctx, expense.id, {"category_id": alimentacao.id})
    assert refund.category_id == alimentacao.id
    assert _audits(db, refund.id)[-1].action is AuditAction.UPDATE
    summary = ledger.month_summary(db, ctx.user_id, 2026, 10)
    assert {c.name: c.amount for c in summary.by_category} == {"Alimentação": Decimal("32.00")}
    assert expense.merchant_id is not None
    merchant = db.get(Merchant, expense.merchant_id)
    assert merchant is not None and merchant.default_category_id == alimentacao.id


def test_update_returns_negative_balance_notice(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    result = transactions.update_transaction(db, ctx, expense.id, {"amount": Decimal("2000.00")})
    assert [n.code for n in result.notices] == ["negative_balance"]


def test_void_excludes_from_balance_and_is_idempotent(
    db: Session, ctx: RequestContext, itau: Account, expense: Transaction
) -> None:
    assert ledger.account_balances(db, ctx.user_id, TODAY)[itau.id] == Decimal("958.00")
    voided = transactions.void_transaction(db, ctx, expense.id)
    assert voided.status is TransactionStatus.VOIDED and voided.voided_at is not None
    transactions.void_transaction(db, ctx, expense.id)
    assert ledger.account_balances(db, ctx.user_id, TODAY)[itau.id] == Decimal("1000.00")
    assert [a.action for a in _audits(db, expense.id)].count(AuditAction.VOID) == 1


def test_void_blocked_by_active_refunds(
    db: Session, ctx: RequestContext, expense: Transaction
) -> None:
    refund = _refund(db, ctx, expense).transaction
    with pytest.raises(RuleViolation) as exc:
        transactions.void_transaction(db, ctx, expense.id)
    assert _code(exc) == "has_active_refunds"
    transactions.void_transaction(db, ctx, refund.id)
    transactions.void_transaction(db, ctx, expense.id)
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `uv run pytest tests/services/test_transactions_changes.py -v`
Expected: FAIL — `ImportError: cannot import name 'NewRefund'`.

- [ ] **Step 3: Atualizar os imports de `backend/app/services/transactions.py`**

Substitua todo o bloco de imports do topo do arquivo por:

```python
import hashlib
import json
from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any, assert_never
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domain.categorization import resolve_category
from app.domain.errors import Conflict, Notice, RuleViolation
from app.domain.money import format_brl, quantize
from app.models import (
    Account,
    AuditAction,
    Category,
    CategoryKind,
    Merchant,
    PaymentMethod,
    Transaction,
    TransactionSource,
    TransactionStatus,
    TransactionType,
)
from app.repositories import get_owned
from app.services import ledger
from app.services.accounts import get_active_account
from app.services.audit import jsonable, record, snapshot
from app.services.categories import get_active_category, get_unclassified
from app.services.context import RequestContext
from app.services.merchants import resolve_merchant
```

- [ ] **Step 4: Acrescentar ao final de `backend/app/services/transactions.py`**

```python
# --- estornos, edição e anulação ------------------------------------------------------------


@dataclass(frozen=True)
class NewRefund:
    amount: Decimal
    occurred_on: date
    account_id: UUID | None = None
    description: str | None = None


def _require_confirmed(tx: Transaction) -> None:
    if tx.status is TransactionStatus.VOIDED:
        raise RuleViolation(
            "transaction_voided", "Este lançamento foi anulado e não pode ser alterado."
        )


def _refunded_total(
    session: Session, expense_id: UUID, *, exclude_id: UUID | None = None
) -> Decimal:
    stmt = select(func.coalesce(func.sum(Transaction.amount), 0)).where(
        Transaction.refund_of_id == expense_id,
        Transaction.status == TransactionStatus.CONFIRMED,
    )
    if exclude_id is not None:
        stmt = stmt.where(Transaction.id != exclude_id)
    return quantize(Decimal(session.scalar(stmt) or 0))


def create_refund(
    session: Session,
    ctx: RequestContext,
    expense_id: UUID,
    data: NewRefund,
    *,
    idempotency_key: str | None = None,
    source: TransactionSource = TransactionSource.MANUAL,
) -> WriteResult:
    digest = (
        payload_hash("NewRefund", {"expense_id": expense_id, **asdict(data)})
        if idempotency_key
        else None
    )
    if idempotency_key is not None and digest is not None:
        existing = _find_by_key(session, ctx.user_id, idempotency_key)
        if existing is not None:
            return _replay(existing, digest)

    _require_positive(data.amount)
    original = get_owned(
        session, Transaction, expense_id, ctx.user_id, "o lançamento", for_update=True
    )
    if original.type is not TransactionType.EXPENSE:
        raise RuleViolation("refund_requires_expense", "Só despesas podem ser estornadas.")
    _require_confirmed(original)
    remaining = original.amount - _refunded_total(session, original.id)
    if quantize(data.amount) > remaining:
        raise RuleViolation(
            "refund_exceeds_original",
            f"O estorno ultrapassa o valor ainda não estornado ({format_brl(remaining)}).",
        )
    if data.occurred_on < original.occurred_on:
        raise RuleViolation(
            "refund_before_expense", "O estorno não pode ter data anterior à despesa."
        )
    account = get_active_account(session, ctx, data.account_id or original.account_id)
    _check_opening(account, data.occurred_on)

    tx = Transaction(
        user_id=ctx.user_id,
        type=TransactionType.REFUND,
        amount=quantize(data.amount),
        occurred_on=data.occurred_on,
        description=(data.description or f"Estorno: {original.description}")[:200],
        account_id=account.id,
        category_id=original.category_id,
        merchant_id=original.merchant_id,
        refund_of_id=original.id,
        source=source,
    )
    raced = _insert(session, ctx, tx, idempotency_key, digest)
    return raced if raced is not None else WriteResult(tx)


_EDITABLE: dict[TransactionType, frozenset[str]] = {
    TransactionType.INCOME: frozenset(
        {"amount", "occurred_on", "description", "notes", "merchant", "category_id", "account_id"}
    ),
    TransactionType.EXPENSE: frozenset(
        {
            "amount",
            "occurred_on",
            "description",
            "notes",
            "merchant",
            "category_id",
            "account_id",
            "payment_method",
        }
    ),
    TransactionType.TRANSFER: frozenset(
        {"amount", "occurred_on", "description", "notes", "account_id", "destination_account_id"}
    ),
    TransactionType.REFUND: frozenset(
        {"amount", "occurred_on", "description", "notes", "account_id"}
    ),
}
_NULLABLE = frozenset({"notes", "merchant"})


def _involved_accounts(tx: Transaction) -> list[UUID]:
    if tx.destination_account_id is None:
        return [tx.account_id]
    return [tx.account_id, tx.destination_account_id]


def _change_category(
    session: Session, ctx: RequestContext, tx: Transaction, category_id: UUID
) -> None:
    kind = CategoryKind.EXPENSE if tx.type is TransactionType.EXPENSE else CategoryKind.INCOME
    category = get_active_category(session, ctx, category_id, kind)
    tx.category_id = category.id
    merchant = session.get(Merchant, tx.merchant_id) if tx.merchant_id else None
    _learn(merchant, category)


def _sync_refund_categories(session: Session, ctx: RequestContext, expense: Transaction) -> None:
    """Estornos acompanham a categoria da despesa, para o consumo por categoria fechar."""
    refunds = list(
        session.scalars(
            select(Transaction).where(
                Transaction.refund_of_id == expense.id,
                Transaction.category_id != expense.category_id,
            )
        )
    )
    for refund in refunds:
        before = snapshot(refund)
        refund.category_id = expense.category_id
        record(session, ctx, refund, AuditAction.UPDATE, before)


def _validate(session: Session, tx: Transaction) -> None:
    if tx.type is TransactionType.TRANSFER and tx.account_id == tx.destination_account_id:
        raise RuleViolation(
            "transfer_same_account", "Origem e destino da transferência devem ser contas diferentes."
        )
    for account_id in _involved_accounts(tx):
        _check_opening(session.get_one(Account, account_id), tx.occurred_on)
    if tx.type is TransactionType.EXPENSE:
        refunded = _refunded_total(session, tx.id)
        if tx.amount < refunded:
            raise RuleViolation(
                "amount_below_refunds",
                f"O valor não pode ser menor que o total já estornado ({format_brl(refunded)}).",
            )
        first_refund = session.scalar(
            select(func.min(Transaction.occurred_on)).where(
                Transaction.refund_of_id == tx.id,
                Transaction.status == TransactionStatus.CONFIRMED,
            )
        )
        if first_refund is not None and first_refund < tx.occurred_on:
            raise RuleViolation(
                "refund_before_expense",
                "A despesa não pode ficar com data posterior à de um estorno dela.",
            )
    if tx.type is TransactionType.REFUND and tx.refund_of_id is not None:
        original = session.get_one(Transaction, tx.refund_of_id, with_for_update=True)
        others = _refunded_total(session, original.id, exclude_id=tx.id)
        if others + tx.amount > original.amount:
            raise RuleViolation(
                "refund_exceeds_original",
                "O estorno ultrapassa o valor ainda não estornado "
                f"({format_brl(original.amount - others)}).",
            )
        if tx.occurred_on < original.occurred_on:
            raise RuleViolation(
                "refund_before_expense", "O estorno não pode ter data anterior à despesa."
            )


def update_transaction(
    session: Session, ctx: RequestContext, transaction_id: UUID, changes: Mapping[str, Any]
) -> WriteResult:
    tx = get_owned(
        session, Transaction, transaction_id, ctx.user_id, "o lançamento", for_update=True
    )
    _require_confirmed(tx)
    not_editable = set(changes) - _EDITABLE[tx.type]
    if not_editable:
        raise RuleViolation(
            "field_not_editable",
            "Campos que não podem ser alterados neste tipo de lançamento: "
            f"{', '.join(sorted(not_editable))}.",
        )
    missing = sorted(key for key, value in changes.items() if value is None and key not in _NULLABLE)
    if missing:
        raise RuleViolation(
            "field_required", f"Campos obrigatórios não podem ficar vazios: {', '.join(missing)}."
        )

    before = snapshot(tx)
    category_changed = "category_id" in changes and changes["category_id"] != tx.category_id
    # O estabelecimento é resolvido antes de qualquer mudança: resolve_merchant faz flush.
    if "merchant" in changes:
        merchant = resolve_merchant(session, ctx.user_id, changes["merchant"])
        tx.merchant_id = merchant.id if merchant else None
    # Sem autoflush: um estado intermediário inválido não pode ir ao banco antes da validação.
    with session.no_autoflush:
        if "amount" in changes:
            _require_positive(changes["amount"])
            tx.amount = quantize(changes["amount"])
        for key in ("occurred_on", "description", "notes", "payment_method"):
            if key in changes:
                setattr(tx, key, changes[key])
        if "account_id" in changes:
            tx.account_id = get_active_account(session, ctx, changes["account_id"]).id
        if "destination_account_id" in changes:
            destination = get_active_account(session, ctx, changes["destination_account_id"])
            tx.destination_account_id = destination.id
        if "category_id" in changes:
            _change_category(session, ctx, tx, changes["category_id"])
        _validate(session, tx)
    record(session, ctx, tx, AuditAction.UPDATE, before)
    if tx.type is TransactionType.EXPENSE and category_changed:
        _sync_refund_categories(session, ctx, tx)
    as_of = max(ctx.today(), tx.occurred_on)
    notices = _negative_balance_notices(session, ctx, _involved_accounts(tx), as_of)
    return WriteResult(tx, notices=notices)


def void_transaction(session: Session, ctx: RequestContext, transaction_id: UUID) -> Transaction:
    tx = get_owned(
        session, Transaction, transaction_id, ctx.user_id, "o lançamento", for_update=True
    )
    if tx.status is TransactionStatus.VOIDED:
        return tx
    if tx.type is TransactionType.EXPENSE and _refunded_total(session, tx.id) > 0:
        raise RuleViolation(
            "has_active_refunds", "Anule os estornos desta despesa antes de anulá-la."
        )
    before = snapshot(tx)
    tx.status = TransactionStatus.VOIDED
    tx.voided_at = ctx.now()
    record(session, ctx, tx, AuditAction.VOID, before)
    return tx
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `uv run pytest tests/services -v`
Expected: PASS (todos).

- [ ] **Step 6: Verificação completa e commit**

Run (em `backend/`): `uv run ruff format . && uv run ruff check --fix .` — depois, na raiz: `bash scripts/check.sh`
Expected: tudo verde.

```bash
git add backend/app/services/transactions.py backend/tests/services/test_transactions_changes.py
git commit -m "feat(transações): estorno, edição com validação e anulação" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Base da API — aplicação, segurança, erros e autenticação

**Files:**
- Create: `backend/app/main.py`
- Create: `backend/app/api/__init__.py` (vazio), `backend/app/api/deps.py`, `backend/app/api/errors.py`, `backend/app/api/middleware.py`
- Create: `backend/app/api/schemas/__init__.py` (vazio), `backend/app/api/schemas/common.py`, `backend/app/api/schemas/auth.py`
- Create: `backend/app/api/routes/__init__.py`, `backend/app/api/routes/health.py`, `backend/app/api/routes/auth.py`
- Create: `backend/tests/api/conftest.py`
- Test: `backend/tests/api/test_auth_api.py`

**Interfaces:**
- Consumes: `Settings` (Tarefa 4), `auth` (Tarefa 6), `RequestContext` (Tarefa 5), erros de domínio (Tarefa 3).
- Produces: `create_app(settings: Settings | None = None, clock: Clock | None = None) -> FastAPI` (rodar com `uvicorn --factory app.main:create_app`); `api_router` em `app.api.routes` (prefixo `/api/v1`); deps `get_db`, `DbDep`, `SettingsDep`, `ClockDep`, `PolicyDep`, `CurrentUserDep`, `CtxDep`, `COOKIE_NAME = "pf_session"`; `problem(status, code, detail, request_id, **extra) -> JSONResponse`; schemas comuns `Money`, `PositiveMoney`, `Description`, `Notes`, `MerchantName`, `AccountName`, `CategoryName`, `NoticeOut` (com `NoticeOut.many(notices)`); fixtures de teste `settings`, `client`, `auth_client`, `build_client(settings, db, clock, *, raise_server_exceptions=True)`, `login(client, email=..., password=...)`, `ORIGIN`, `HEADERS`.
- Endpoints: `GET /api/v1/health`, `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `GET /api/v1/auth/me`.

- [ ] **Step 1: Escrever as fixtures da API e os testes que falham**

`backend/tests/api/conftest.py`:

```python
from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.config import Settings
from app.domain.dates import Clock
from app.main import create_app
from app.models import User
from tests.conftest import TEST_DATABASE_URL
from tests.support import PASSWORD

ORIGIN = "https://testserver"
HEADERS = {"Origin": ORIGIN, "X-Requested-With": "fetch"}


@pytest.fixture
def settings() -> Settings:
    return Settings(
        _env_file=None,
        database_url=TEST_DATABASE_URL,
        secret_key="k" * 40,
        app_origin=ORIGIN,
    )


def build_client(
    settings: Settings, db: Session, clock: Clock, *, raise_server_exceptions: bool = True
) -> TestClient:
    app = create_app(settings, clock=clock)
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(
        app, base_url=ORIGIN, headers=HEADERS, raise_server_exceptions=raise_server_exceptions
    )


@pytest.fixture
def client(settings: Settings, db: Session, clock: Clock) -> Iterator[TestClient]:
    with build_client(settings, db, clock) as test_client:
        yield test_client


def login(
    client: TestClient, email: str = "ana@example.com", password: str = PASSWORD
) -> httpx.Response:
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


@pytest.fixture
def auth_client(client: TestClient, user: User) -> TestClient:
    response = login(client)
    assert response.status_code == 200, response.text
    return client
```

`backend/tests/api/test_auth_api.py`:

```python
import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.config import Settings
from app.domain.dates import Clock
from app.main import create_app
from app.models import User
from tests.api.conftest import ORIGIN, build_client, login
from tests.support import PASSWORD

PROBLEM = "application/problem+json"


def test_login_sets_secure_cookie(client: TestClient, user: User) -> None:
    response = login(client)
    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "ana@example.com"
    assert "password_hash" not in body
    cookie = response.headers["set-cookie"].lower()
    for attribute in ("pf_session=", "httponly", "secure", "samesite=strict", "path=/"):
        assert attribute in cookie


def test_me_requires_session(client: TestClient) -> None:
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401
    assert response.headers["content-type"].startswith(PROBLEM)
    assert response.json()["code"] == "unauthenticated"


def test_me_with_session(auth_client: TestClient) -> None:
    response = auth_client.get("/api/v1/auth/me")
    assert response.status_code == 200
    assert response.json()["timezone"] == "America/Sao_Paulo"


def test_wrong_password_then_rate_limit(client: TestClient, user: User) -> None:
    for _ in range(5):
        response = login(client, password="senha-errada-123")
        assert response.status_code == 401
        assert response.json()["code"] == "invalid_credentials"
    blocked = login(client)
    assert blocked.status_code == 429
    assert blocked.json()["code"] == "too_many_attempts"


def test_logout_ends_session(auth_client: TestClient) -> None:
    assert auth_client.post("/api/v1/auth/logout").status_code == 204
    assert auth_client.get("/api/v1/auth/me").status_code == 401


@pytest.mark.parametrize(
    "headers",
    [
        {"Origin": "https://evil.example.com", "X-Requested-With": "fetch"},
        {"X-Requested-With": "fetch"},
        {"Origin": ORIGIN},
    ],
)
def test_unsafe_requests_require_origin_and_header(
    settings: Settings, db: Session, clock: Clock, user: User, headers: dict[str, str]
) -> None:
    app: FastAPI = create_app(settings, clock=clock)
    app.dependency_overrides[get_db] = lambda: db
    raw = TestClient(app, base_url=ORIGIN)
    response = raw.post(
        "/api/v1/auth/login",
        json={"email": "ana@example.com", "password": PASSWORD},
        headers=headers,
    )
    assert response.status_code == 403
    assert response.json()["code"] == "origin_not_allowed"


def test_security_headers_and_request_id(client: TestClient) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    csp = response.headers["content-security-policy"]
    assert "default-src 'self'" in csp and "frame-ancestors 'none'" in csp
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["strict-transport-security"].startswith("max-age=")
    assert len(response.headers["x-request-id"]) == 32


def test_validation_error_format(client: TestClient) -> None:
    response = client.post("/api/v1/auth/login", json={"email": "ana@example.com"})
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "validation_error"
    assert [error["field"] for error in body["errors"]] == ["password"]


def test_unknown_route_is_problem(client: TestClient) -> None:
    response = client.get("/api/v1/nao-existe")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith(PROBLEM)


def test_unexpected_error_is_problem_without_details(
    settings: Settings, db: Session, clock: Clock
) -> None:
    test_client = build_client(settings, db, clock, raise_server_exceptions=False)

    def boom() -> None:
        raise RuntimeError("segredo-interno")

    test_client.app.add_api_route("/api/v1/boom", boom)  # type: ignore[attr-defined]
    response = test_client.get("/api/v1/boom")
    assert response.status_code == 500
    assert response.json()["code"] == "internal_error"
    assert "segredo" not in response.text


def test_logs_do_not_contain_credentials(
    client: TestClient, user: User, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)
    login(client)
    assert PASSWORD not in caplog.text
    assert "ana@example.com" not in caplog.text
    assert "path=/api/v1/auth/login" in caplog.text
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `uv run pytest tests/api/test_auth_api.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.api'`.

- [ ] **Step 3: Implementar schemas comuns e de autenticação**

`backend/app/api/schemas/common.py`:

```python
"""Tipos compartilhados pelos schemas da API."""

import re
from collections.abc import Iterable
from decimal import Decimal
from typing import Annotated, Self

from pydantic import (
    BaseModel,
    BeforeValidator,
    Field,
    PlainSerializer,
    StringConstraints,
    WithJsonSchema,
)

from app.domain.errors import Notice
from app.domain.money import to_api

_MONEY_PATTERN = r"-?[0-9]{1,12}(\.[0-9]{1,2})?"
_MONEY = re.compile(_MONEY_PATTERN)


def _parse_money(value: object) -> Decimal:
    """Dinheiro chega como string ("42.50"). Números JSON são recusados para evitar imprecisão."""
    if isinstance(value, Decimal):
        return value
    if isinstance(value, str) and _MONEY.fullmatch(value):
        return Decimal(value)
    raise ValueError('use uma string com até 2 casas decimais, por exemplo "42.50"')


Money = Annotated[
    Decimal,
    BeforeValidator(_parse_money),
    PlainSerializer(to_api, return_type=str, when_used="json"),
    WithJsonSchema({"type": "string", "pattern": f"^{_MONEY_PATTERN}$", "examples": ["42.50"]}),
]
PositiveMoney = Annotated[Money, Field(gt=0)]

Description = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Notes = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]
MerchantName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]
AccountName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
CategoryName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)
]


class NoticeOut(BaseModel):
    code: str
    detail: str

    @classmethod
    def many(cls, notices: Iterable[Notice]) -> list[Self]:
        return [cls(code=n.code, detail=n.detail) for n in notices]
```

`backend/app/api/schemas/auth.py`:

```python
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=200)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    timezone: str
```

- [ ] **Step 4: Implementar erros, middlewares e dependências**

`backend/app/api/errors.py`:

```python
"""Erros HTTP no formato Problem Details (RFC 9457) com `code` estável."""

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.domain.errors import (
    Conflict,
    DomainError,
    NotFound,
    RuleViolation,
    TooManyAttempts,
    Unauthenticated,
)

logger = logging.getLogger("app.errors")

_STATUS: dict[type[DomainError], int] = {
    NotFound: 404,
    RuleViolation: 422,
    Conflict: 409,
    Unauthenticated: 401,
    TooManyAttempts: 429,
}
_TITLES = {
    401: "Não autenticado",
    403: "Proibido",
    404: "Não encontrado",
    405: "Método não permitido",
    409: "Conflito",
    422: "Requisição inválida",
    429: "Muitas tentativas",
    500: "Erro interno",
}


def request_id_of(request: Request) -> str:
    return str(getattr(request.state, "request_id", ""))


def problem(status: int, code: str, detail: str, request_id: str, **extra: Any) -> JSONResponse:
    body = {
        "type": f"/problems/{code}",
        "title": _TITLES.get(status, "Erro"),
        "status": status,
        "code": code,
        "detail": detail,
        "request_id": request_id,
        **extra,
    }
    return JSONResponse(body, status_code=status, media_type="application/problem+json")


def _status_for(exc: DomainError) -> int:
    for cls in type(exc).__mro__:
        if cls in _STATUS:
            return _STATUS[cls]
    return 400


async def _domain_error(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, DomainError)
    return problem(_status_for(exc), exc.code, exc.detail, request_id_of(request))


async def _validation_error(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, RequestValidationError)
    # O valor recebido (`input`) nunca volta na resposta: pode conter dados financeiros.
    errors = [
        {
            "field": ".".join(str(part) for part in err["loc"][1:]) or str(err["loc"][0]),
            "message": err["msg"],
        }
        for err in exc.errors()
    ]
    return problem(
        422,
        "validation_error",
        "Alguns campos são inválidos.",
        request_id_of(request),
        errors=errors,
    )


async def _http_error(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, StarletteHTTPException)
    return problem(exc.status_code, "http_error", str(exc.detail), request_id_of(request))


async def _integrity_error(request: Request, exc: Exception) -> Response:
    logger.warning("integrity_error request_id=%s", request_id_of(request))
    return problem(
        409, "conflict", "A operação conflita com dados existentes.", request_id_of(request)
    )


async def _unexpected_error(request: Request, exc: Exception) -> Response:
    logger.exception("unhandled_error request_id=%s", request_id_of(request))
    return problem(
        500,
        "internal_error",
        "Erro inesperado. Informe o código da requisição se o problema continuar.",
        request_id_of(request),
    )


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(DomainError, _domain_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
    app.add_exception_handler(StarletteHTTPException, _http_error)
    app.add_exception_handler(IntegrityError, _integrity_error)
    app.add_exception_handler(Exception, _unexpected_error)
```

`backend/app/api/middleware.py`:

```python
"""Request id + log de acesso, cabeçalhos de segurança e proteção CSRF."""

import logging
import time
import uuid

from fastapi import FastAPI, Request, Response
from starlette.middleware.base import RequestResponseEndpoint

from app.api.errors import problem, request_id_of
from app.config import Settings

logger = logging.getLogger("app.access")

UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    ),
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
}


def install_middlewares(app: FastAPI, settings: Settings) -> None:
    # O último registrado é o mais externo: request_context envolve todos os outros.

    @app.middleware("http")
    async def csrf_guard(request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method in UNSAFE_METHODS and request.url.path.startswith("/api/"):
            same_origin = request.headers.get("origin") == settings.app_origin
            if not same_origin or "x-requested-with" not in request.headers:
                return problem(
                    403,
                    "origin_not_allowed",
                    "Origem da requisição não permitida.",
                    request_id_of(request),
                )
        return await call_next(request)

    @app.middleware("http")
    async def security_headers(request: Request, call_next: RequestResponseEndpoint) -> Response:
        response = await call_next(request)
        is_docs = settings.enable_docs and request.url.path.startswith("/docs")
        for name, value in SECURITY_HEADERS.items():
            if name == "Content-Security-Policy" and is_docs:
                continue  # a documentação interativa carrega scripts de CDN
            response.headers.setdefault(name, value)
        return response

    @app.middleware("http")
    async def request_context(request: Request, call_next: RequestResponseEndpoint) -> Response:
        request_id = uuid.uuid4().hex
        request.state.request_id = request_id
        started = time.perf_counter()
        # Só método, caminho (sem query string), status e duração: nada de corpo ou valores.
        try:
            response = await call_next(request)
        except Exception:
            logger.error(
                "request_id=%s method=%s path=%s status=500",
                request_id,
                request.method,
                request.url.path,
            )
            raise
        response.headers["X-Request-ID"] = request_id
        logger.info(
            "request_id=%s method=%s path=%s status=%s duration_ms=%.1f",
            request_id,
            request.method,
            request.url.path,
            response.status_code,
            (time.perf_counter() - started) * 1000,
        )
        return response
```

`backend/app/api/deps.py`:

```python
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
```

- [ ] **Step 5: Implementar rotas e a aplicação**

`backend/app/api/routes/health.py`:

```python
from fastapi import APIRouter
from sqlalchemy import text

from app.api.deps import DbDep

router = APIRouter(tags=["health"])


@router.get("/health")
def health(db: DbDep) -> dict[str, str]:
    db.execute(text("SELECT 1"))
    return {"status": "ok"}
```

`backend/app/api/routes/auth.py`:

```python
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
```

`backend/app/api/routes/__init__.py`:

```python
from fastapi import APIRouter

from app.api.routes import auth, health

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
```

`backend/app/main.py`:

```python
"""Aplicação FastAPI. Rodar com: uv run uvicorn --factory app.main:create_app"""

import logging

from fastapi import FastAPI

from app import __version__
from app.api.errors import install_error_handlers
from app.api.middleware import install_middlewares
from app.api.routes import api_router
from app.config import Settings, get_settings
from app.db import make_engine, make_sessionmaker
from app.domain.dates import Clock, SystemClock


def create_app(settings: Settings | None = None, clock: Clock | None = None) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(level=settings.log_level)
    app = FastAPI(
        title="Assistente Financeiro Pessoal",
        version=__version__,
        docs_url="/docs" if settings.enable_docs else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if settings.enable_docs else None,
    )
    app.state.settings = settings
    app.state.sessionmaker = make_sessionmaker(make_engine(settings.database_url))
    app.state.clock = clock or SystemClock()
    install_error_handlers(app)
    install_middlewares(app, settings)
    app.include_router(api_router, prefix="/api/v1")
    return app
```

- [ ] **Step 6: Rodar e confirmar que passa**

Run: `uv run pytest tests/api/test_auth_api.py -v`
Expected: PASS (13).

- [ ] **Step 7: Verificação completa e commit**

Run (em `backend/`): `uv run ruff format . && uv run ruff check --fix .` — depois, na raiz: `bash scripts/check.sh`
Expected: tudo verde.

```bash
git add backend/app backend/tests/api
git commit -m "feat(api): aplicação, segurança (CSRF, cabeçalhos), erros e autenticação" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: API — contas, categorias e estabelecimentos

**Files:**
- Create: `backend/app/api/schemas/accounts.py`, `backend/app/api/schemas/categories.py`, `backend/app/api/schemas/merchants.py`
- Create: `backend/app/api/routes/accounts.py`, `backend/app/api/routes/categories.py`, `backend/app/api/routes/merchants.py`
- Modify: `backend/app/api/routes/__init__.py`
- Test: `backend/tests/api/test_accounts_api.py`

**Interfaces:**
- Consumes: `accounts`, `categories` (Tarefa 8), `ledger.account_balances` (Tarefa 9), `merchants.search_merchants` (Tarefa 10), deps e schemas comuns (Tarefa 12).
- Produces (endpoints): `GET /accounts?include_archived=`, `POST /accounts` (201), `PATCH /accounts/{id}`, `POST /accounts/{id}/archive` (`{account, warnings}`), `GET /accounts/balances?as_of=` (`{as_of, total, accounts: [{account_id, name, archived, balance}]}`); `GET /categories?kind=&include_archived=`, `POST /categories` (201), `PATCH /categories/{id}`, `POST /categories/{id}/archive`; `GET /merchants?q=` (`[{id, name, default_category_id}]`).
- Produces (schemas): `AccountOut`, `CategoryOut`, `MerchantOut` (usados pelo frontend no plano 1B).

- [ ] **Step 1: Escrever os testes que falham**

`backend/tests/api/test_accounts_api.py`:

```python
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.services.context import RequestContext
from app.services.merchants import resolve_merchant
from tests.support import find_category, make_account


def _create(client: TestClient, **overrides: Any) -> httpx.Response:
    body = {
        "name": "Itaú",
        "type": "CHECKING",
        "opening_balance": "1000.00",
        "opening_date": "2026-10-01",
    }
    body.update(overrides)
    return client.post("/api/v1/accounts", json=body)


def test_requires_authentication(client: TestClient) -> None:
    assert client.get("/api/v1/accounts").status_code == 401


def test_create_and_list_accounts(auth_client: TestClient) -> None:
    response = _create(auth_client)
    assert response.status_code == 201
    body = response.json()
    assert body["opening_balance"] == "1000.00"
    assert body["archived_at"] is None
    assert [a["name"] for a in auth_client.get("/api/v1/accounts").json()] == ["Itaú"]


@pytest.mark.parametrize("amount", [1000.5, "1.005", "1000000000000.00", "abc", "1,50"])
def test_money_must_be_string_with_two_decimals(auth_client: TestClient, amount: Any) -> None:
    response = _create(auth_client, opening_balance=amount)
    assert response.status_code == 422
    assert [e["field"] for e in response.json()["errors"]] == ["opening_balance"]


def test_duplicate_name_conflict(auth_client: TestClient) -> None:
    _create(auth_client)
    response = _create(auth_client)
    assert response.status_code == 409
    assert response.json()["code"] == "name_already_exists"


def test_other_users_account_is_404(
    auth_client: TestClient, db: Session, other_ctx: RequestContext
) -> None:
    foreign = make_account(db, other_ctx)
    response = auth_client.patch(f"/api/v1/accounts/{foreign.id}", json={"name": "x"})
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


def test_archive_warns_about_balance(auth_client: TestClient) -> None:
    account_id = _create(auth_client).json()["id"]
    response = auth_client.post(f"/api/v1/accounts/{account_id}/archive")
    assert response.status_code == 200
    body = response.json()
    assert body["account"]["archived_at"] is not None
    assert [w["code"] for w in body["warnings"]] == ["archived_with_balance"]
    assert auth_client.get("/api/v1/accounts").json() == []


def test_balances(auth_client: TestClient) -> None:
    _create(auth_client, name="Itaú", opening_balance="1000.00")
    _create(auth_client, name="Nubank", opening_balance="-50.25")
    body = auth_client.get("/api/v1/accounts/balances").json()
    assert body["as_of"] == "2026-10-15"
    assert body["total"] == "949.75"
    assert {a["name"]: a["balance"] for a in body["accounts"]} == {
        "Itaú": "1000.00",
        "Nubank": "-50.25",
    }


def test_categories_endpoints(auth_client: TestClient) -> None:
    listed = auth_client.get("/api/v1/categories").json()
    assert len(listed) == 19
    unclassified = next(
        c for c in listed if c["name"] == "A classificar" and c["kind"] == "EXPENSE"
    )
    locked = auth_client.patch(
        f"/api/v1/categories/{unclassified['id']}", json={"name": "Outros"}
    )
    assert locked.status_code == 422
    assert locked.json()["code"] == "system_category_locked"

    created = auth_client.post("/api/v1/categories", json={"name": "Viagens", "kind": "EXPENSE"})
    assert created.status_code == 201
    assert created.json()["is_essential"] is False
    archived = auth_client.post(f"/api/v1/categories/{created.json()['id']}/archive")
    assert archived.status_code == 200
    assert archived.json()["archived_at"] is not None

    expense_only = auth_client.get("/api/v1/categories", params={"kind": "EXPENSE"}).json()
    assert len(expense_only) == 14


def test_merchant_search(auth_client: TestClient, db: Session, ctx: RequestContext) -> None:
    saude = find_category(db, ctx, "Saúde")
    drogasil = resolve_merchant(db, ctx.user_id, "Drogasil")
    assert drogasil is not None
    drogasil.default_category_id = saude.id
    resolve_merchant(db, ctx.user_id, "Drogaria São Paulo")
    db.flush()

    exact = auth_client.get("/api/v1/merchants", params={"q": "DROGASIL"}).json()
    assert [m["name"] for m in exact] == ["Drogasil"]
    assert exact[0]["default_category_id"] == str(saude.id)
    partial = auth_client.get("/api/v1/merchants", params={"q": "drog"}).json()
    assert len(partial) == 2
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `uv run pytest tests/api/test_accounts_api.py -v`
Expected: FAIL — respostas 404 (rotas inexistentes).

- [ ] **Step 3: Implementar os schemas**

`backend/app/api/schemas/accounts.py`:

```python
from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.api.schemas.common import AccountName, Money, NoticeOut
from app.models import AccountType


class AccountIn(BaseModel):
    name: AccountName
    type: AccountType
    opening_balance: Money
    opening_date: date


class AccountPatch(BaseModel):
    name: AccountName | None = None
    type: AccountType | None = None
    opening_balance: Money | None = None
    opening_date: date | None = None


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    type: AccountType
    opening_balance: Money
    opening_date: date
    archived_at: datetime | None


class AccountArchiveOut(BaseModel):
    account: AccountOut
    warnings: list[NoticeOut]


class AccountBalanceOut(BaseModel):
    account_id: UUID
    name: str
    archived: bool
    balance: Money


class BalancesOut(BaseModel):
    as_of: date
    total: Money
    accounts: list[AccountBalanceOut]
```

`backend/app/api/schemas/categories.py`:

```python
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.api.schemas.common import CategoryName
from app.models import CategoryKind


class CategoryIn(BaseModel):
    name: CategoryName
    kind: CategoryKind
    is_essential: bool = False


class CategoryPatch(BaseModel):
    name: CategoryName | None = None
    is_essential: bool | None = None


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    kind: CategoryKind
    is_essential: bool
    is_system: bool
    archived_at: datetime | None
```

`backend/app/api/schemas/merchants.py`:

```python
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class MerchantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    default_category_id: UUID | None
```

- [ ] **Step 4: Implementar as rotas**

`backend/app/api/routes/accounts.py`:

```python
from datetime import date
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter

from app.api.deps import CtxDep, DbDep
from app.api.schemas.accounts import (
    AccountArchiveOut,
    AccountBalanceOut,
    AccountIn,
    AccountOut,
    AccountPatch,
    BalancesOut,
)
from app.api.schemas.common import NoticeOut
from app.models import Account
from app.services import accounts, ledger

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("", response_model=list[AccountOut])
def list_accounts(ctx: CtxDep, db: DbDep, include_archived: bool = False) -> list[Account]:
    return accounts.list_accounts(db, ctx, include_archived=include_archived)


@router.get("/balances", response_model=BalancesOut)
def balances(ctx: CtxDep, db: DbDep, as_of: date | None = None) -> BalancesOut:
    day = as_of or ctx.today()
    items = accounts.list_accounts(db, ctx, include_archived=True)
    values = ledger.account_balances(db, ctx.user_id, day)
    return BalancesOut(
        as_of=day,
        total=sum(values.values(), Decimal("0.00")),
        accounts=[
            AccountBalanceOut(
                account_id=a.id,
                name=a.name,
                archived=a.archived_at is not None,
                balance=values[a.id],
            )
            for a in items
        ],
    )


@router.post("", status_code=201, response_model=AccountOut)
def create_account(body: AccountIn, ctx: CtxDep, db: DbDep) -> Account:
    account = accounts.create_account(
        db,
        ctx,
        name=body.name,
        account_type=body.type,
        opening_balance=body.opening_balance,
        opening_date=body.opening_date,
    )
    db.commit()
    return account


@router.patch("/{account_id}", response_model=AccountOut)
def update_account(account_id: UUID, body: AccountPatch, ctx: CtxDep, db: DbDep) -> Account:
    account = accounts.update_account(
        db,
        ctx,
        account_id,
        name=body.name,
        account_type=body.type,
        opening_balance=body.opening_balance,
        opening_date=body.opening_date,
    )
    db.commit()
    return account


@router.post("/{account_id}/archive", response_model=AccountArchiveOut)
def archive_account(account_id: UUID, ctx: CtxDep, db: DbDep) -> AccountArchiveOut:
    result = accounts.archive_account(db, ctx, account_id)
    db.commit()
    return AccountArchiveOut(
        account=AccountOut.model_validate(result.account),
        warnings=NoticeOut.many(result.notices),
    )
```

`backend/app/api/routes/categories.py`:

```python
from uuid import UUID

from fastapi import APIRouter

from app.api.deps import CtxDep, DbDep
from app.api.schemas.categories import CategoryIn, CategoryOut, CategoryPatch
from app.models import Category, CategoryKind
from app.services import categories

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=list[CategoryOut])
def list_categories(
    ctx: CtxDep, db: DbDep, kind: CategoryKind | None = None, include_archived: bool = False
) -> list[Category]:
    return categories.list_categories(db, ctx, kind=kind, include_archived=include_archived)


@router.post("", status_code=201, response_model=CategoryOut)
def create_category(body: CategoryIn, ctx: CtxDep, db: DbDep) -> Category:
    category = categories.create_category(
        db, ctx, name=body.name, kind=body.kind, is_essential=body.is_essential
    )
    db.commit()
    return category


@router.patch("/{category_id}", response_model=CategoryOut)
def update_category(category_id: UUID, body: CategoryPatch, ctx: CtxDep, db: DbDep) -> Category:
    category = categories.update_category(
        db, ctx, category_id, name=body.name, is_essential=body.is_essential
    )
    db.commit()
    return category


@router.post("/{category_id}/archive", response_model=CategoryOut)
def archive_category(category_id: UUID, ctx: CtxDep, db: DbDep) -> Category:
    category = categories.archive_category(db, ctx, category_id)
    db.commit()
    return category
```

`backend/app/api/routes/merchants.py`:

```python
from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import CtxDep, DbDep
from app.api.schemas.merchants import MerchantOut
from app.models import Merchant
from app.services.merchants import search_merchants

router = APIRouter(prefix="/merchants", tags=["merchants"])


@router.get("", response_model=list[MerchantOut])
def search(
    ctx: CtxDep, db: DbDep, q: Annotated[str, Query(min_length=1, max_length=120)]
) -> list[Merchant]:
    return search_merchants(db, ctx.user_id, q)
```

Substitua `backend/app/api/routes/__init__.py` por:

```python
from fastapi import APIRouter

from app.api.routes import accounts, auth, categories, health, merchants

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(accounts.router)
api_router.include_router(categories.router)
api_router.include_router(merchants.router)
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `uv run pytest tests/api -v`
Expected: PASS (todos).

- [ ] **Step 6: Verificação completa e commit**

Run (em `backend/`): `uv run ruff format . && uv run ruff check --fix .` — depois, na raiz: `bash scripts/check.sh`
Expected: tudo verde.

```bash
git add backend/app/api backend/tests/api
git commit -m "feat(api): contas, saldos, categorias e busca de estabelecimentos" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: API — lançamentos, apoio ao registro e resumo do mês

**Files:**
- Create: `backend/app/api/schemas/transactions.py`, `backend/app/api/schemas/entry.py`, `backend/app/api/schemas/summaries.py`
- Create: `backend/app/api/routes/transactions.py`, `backend/app/api/routes/entry.py`, `backend/app/api/routes/summaries.py`
- Modify: `backend/app/api/routes/__init__.py`
- Test: `backend/tests/api/test_transactions_api.py`

**Interfaces:**
- Consumes: `transactions` (Tarefas 10 e 11), `ledger` (Tarefa 9), `accounts.list_accounts` (Tarefa 8), `parse_month` (Tarefa 3).
- Produces (endpoints): `POST /transactions` (corpo discriminado por `type`: `INCOME` | `EXPENSE` | `TRANSFER`; cabeçalho `Idempotency-Key` obrigatório, 8–100 caracteres; 201 novo / 200 repetição; resposta `{transaction, replayed, warnings}`), `GET /transactions` (filtros `date_from`, `date_to`, `account_id`, `category_id`, `merchant_id`, `payment_method`, `type`, `status=CONFIRMED|VOIDED|ALL`, `cursor`, `limit` 1–100; resposta `{items, next_cursor}`), `GET /transactions/{id}`, `PATCH /transactions/{id}`, `POST /transactions/{id}/void`, `POST /transactions/{id}/refunds` (com `Idempotency-Key`); `GET /entry-hints` (`{today, accounts, payment_methods, top_payment_options}`), `POST /entry-checks` (`{items: [{amount, merchant, occurred_on}]}` → `{results: [{index, possible_duplicates}]}`); `GET /summaries/month?month=AAAA-MM` (`{month, income, consumption_total, by_category: [{category_id, name, amount}]}`).

- [ ] **Step 1: Escrever os testes que falham**

`backend/tests/api/test_transactions_api.py`:

```python
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import Settings
from app.domain.dates import FixedClock
from app.models import User
from app.services.context import RequestContext
from tests.api.conftest import build_client, login
from tests.support import make_account


def _account(client: TestClient, name: str = "Itaú", opening: str = "1000.00") -> str:
    response = client.post(
        "/api/v1/accounts",
        json={
            "name": name,
            "type": "CHECKING",
            "opening_balance": opening,
            "opening_date": "2026-10-01",
        },
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


@pytest.fixture
def itau_id(auth_client: TestClient) -> str:
    return _account(auth_client)


def _expense(account_id: str, **overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "type": "EXPENSE",
        "amount": "42.00",
        "occurred_on": "2026-10-15",
        "description": "Mercado",
        "account_id": account_id,
        "payment_method": "PIX",
    }
    body.update(overrides)
    return body


def _post(client: TestClient, body: dict[str, Any], key: str = "chave-api-0001") -> httpx.Response:
    return client.post("/api/v1/transactions", json=body, headers={"Idempotency-Key": key})


def test_create_expense(auth_client: TestClient, itau_id: str) -> None:
    response = _post(auth_client, _expense(itau_id))
    assert response.status_code == 201
    body = response.json()
    assert body["replayed"] is False
    assert body["warnings"] == []
    tx = body["transaction"]
    assert tx["amount"] == "42.00"
    assert tx["type"] == "EXPENSE"
    assert tx["status"] == "CONFIRMED"
    assert tx["category_id"] is not None


def test_replay_and_conflict(auth_client: TestClient, itau_id: str) -> None:
    first = _post(auth_client, _expense(itau_id))
    again = _post(auth_client, _expense(itau_id))
    assert again.status_code == 200
    assert again.json()["replayed"] is True
    assert again.json()["transaction"]["id"] == first.json()["transaction"]["id"]
    conflict = _post(auth_client, _expense(itau_id, amount="43.00"))
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "idempotency_key_reused"


def test_idempotency_key_is_required(auth_client: TestClient, itau_id: str) -> None:
    response = auth_client.post("/api/v1/transactions", json=_expense(itau_id))
    assert response.status_code == 422
    assert "Idempotency-Key" in [e["field"] for e in response.json()["errors"]]


@pytest.mark.parametrize(
    "override",
    [
        {"amount": "0"},
        {"amount": 42},
        {"amount": "42.001"},
        {"payment_method": "CHEQUE"},
        {"description": "   "},
        {"type": "TRANSFER"},
    ],
)
def test_invalid_bodies(auth_client: TestClient, itau_id: str, override: dict[str, Any]) -> None:
    response = _post(auth_client, _expense(itau_id, **override))
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


def test_amount_too_large_is_422(auth_client: TestClient, itau_id: str) -> None:
    response = _post(auth_client, _expense(itau_id, amount="1000000000000.00"))
    assert response.status_code == 422


def test_rule_violation_is_422_with_code(auth_client: TestClient, itau_id: str) -> None:
    response = _post(auth_client, _expense(itau_id, occurred_on="2026-09-30"))
    assert response.status_code == 422
    assert response.json()["code"] == "date_before_account_opening"


def test_other_users_account_is_404(
    auth_client: TestClient, db: Session, other_ctx: RequestContext
) -> None:
    foreign = make_account(db, other_ctx)
    response = _post(auth_client, _expense(str(foreign.id)))
    assert response.status_code == 404


def test_negative_balance_warning(auth_client: TestClient) -> None:
    account_id = _account(auth_client, "Carteira", "10.00")
    response = _post(auth_client, _expense(account_id))
    assert response.status_code == 201
    assert [w["code"] for w in response.json()["warnings"]] == ["negative_balance"]


def test_list_get_patch_void_flow(auth_client: TestClient, itau_id: str) -> None:
    ids = [
        _post(
            auth_client, _expense(itau_id, occurred_on=f"2026-10-0{day}"), key=f"chave-lista-{day}0"
        ).json()["transaction"]["id"]
        for day in (1, 2, 3)
    ]
    page = auth_client.get("/api/v1/transactions", params={"limit": 2}).json()
    assert [t["id"] for t in page["items"]] == [ids[2], ids[1]]
    assert page["next_cursor"]
    rest = auth_client.get(
        "/api/v1/transactions", params={"limit": 2, "cursor": page["next_cursor"]}
    ).json()
    assert [t["id"] for t in rest["items"]] == [ids[0]]
    assert rest["next_cursor"] is None

    assert auth_client.get(f"/api/v1/transactions/{ids[0]}").status_code == 200
    patched = auth_client.patch(
        f"/api/v1/transactions/{ids[0]}", json={"amount": "50.00", "notes": "corrigido"}
    )
    assert patched.status_code == 200
    assert patched.json()["transaction"]["amount"] == "50.00"
    not_editable = auth_client.patch(
        f"/api/v1/transactions/{ids[0]}", json={"destination_account_id": itau_id}
    )
    assert not_editable.status_code == 422
    assert not_editable.json()["code"] == "field_not_editable"

    voided = auth_client.post(f"/api/v1/transactions/{ids[0]}/void")
    assert voided.status_code == 200
    assert voided.json()["status"] == "VOIDED"
    assert len(auth_client.get("/api/v1/transactions").json()["items"]) == 2
    everything = auth_client.get("/api/v1/transactions", params={"status": "ALL"}).json()
    assert len(everything["items"]) == 3


def test_refund_flow(auth_client: TestClient, itau_id: str) -> None:
    tx_id = _post(auth_client, _expense(itau_id)).json()["transaction"]["id"]
    url = f"/api/v1/transactions/{tx_id}/refunds"
    refund = auth_client.post(
        url,
        json={"amount": "10.00", "occurred_on": "2026-10-15"},
        headers={"Idempotency-Key": "estorno-api-0001"},
    )
    assert refund.status_code == 201
    assert refund.json()["transaction"]["type"] == "REFUND"
    assert refund.json()["transaction"]["refund_of_id"] == tx_id
    too_much = auth_client.post(
        url,
        json={"amount": "40.00", "occurred_on": "2026-10-15"},
        headers={"Idempotency-Key": "estorno-api-0002"},
    )
    assert too_much.status_code == 422
    assert too_much.json()["code"] == "refund_exceeds_original"
    blocked = auth_client.post(f"/api/v1/transactions/{tx_id}/void")
    assert blocked.status_code == 422
    assert blocked.json()["code"] == "has_active_refunds"


def test_transfer_keeps_totals(auth_client: TestClient, itau_id: str) -> None:
    nubank_id = _account(auth_client, "Nubank", "0.00")
    before = auth_client.get("/api/v1/accounts/balances").json()["total"]
    transfer = {
        "type": "TRANSFER",
        "amount": "300.00",
        "occurred_on": "2026-10-15",
        "description": "Reserva",
        "account_id": itau_id,
        "destination_account_id": nubank_id,
    }
    assert _post(auth_client, transfer).status_code == 201
    assert auth_client.get("/api/v1/accounts/balances").json()["total"] == before
    summary = auth_client.get("/api/v1/summaries/month", params={"month": "2026-10"}).json()
    assert summary["income"] == "0.00"
    assert summary["consumption_total"] == "0.00"


def test_month_summary(auth_client: TestClient, itau_id: str) -> None:
    _post(auth_client, _expense(itau_id))
    income = {
        "type": "INCOME",
        "amount": "3000.00",
        "occurred_on": "2026-10-05",
        "description": "Salário",
        "account_id": itau_id,
    }
    assert _post(auth_client, income, key="chave-receita-0001").status_code == 201
    body = auth_client.get("/api/v1/summaries/month", params={"month": "2026-10"}).json()
    assert body["month"] == "2026-10"
    assert body["income"] == "3000.00"
    assert body["consumption_total"] == "42.00"
    assert [(c["name"], c["amount"]) for c in body["by_category"]] == [("A classificar", "42.00")]
    invalid = auth_client.get("/api/v1/summaries/month", params={"month": "2026-13"})
    assert invalid.status_code == 422
    assert invalid.json()["code"] == "invalid_month"


def test_entry_hints_and_checks(auth_client: TestClient, itau_id: str) -> None:
    _post(auth_client, _expense(itau_id, description="Drogasil"))
    hints = auth_client.get("/api/v1/entry-hints").json()
    assert hints["today"] == "2026-10-15"
    assert [a["name"] for a in hints["accounts"]] == ["Itaú"]
    assert "PIX" in hints["payment_methods"]
    assert hints["top_payment_options"][0] == {
        "account_id": itau_id,
        "account_name": "Itaú",
        "payment_method": "PIX",
    }
    checks = auth_client.post(
        "/api/v1/entry-checks",
        json={
            "items": [
                {"amount": "42.00", "merchant": "DROGASIL", "occurred_on": "2026-10-16"},
                {"amount": "42.00", "merchant": "Outro", "occurred_on": "2026-10-16"},
            ]
        },
    ).json()
    assert [len(r["possible_duplicates"]) for r in checks["results"]] == [1, 0]


def test_entry_hints_today_uses_user_timezone(
    settings: Settings, db: Session, user: User
) -> None:
    late_night = FixedClock(datetime(2026, 10, 16, 2, 30, tzinfo=UTC))  # 23h30 em São Paulo
    with build_client(settings, db, late_night) as test_client:
        assert login(test_client).status_code == 200
        assert test_client.get("/api/v1/entry-hints").json()["today"] == "2026-10-15"
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `uv run pytest tests/api/test_transactions_api.py -v`
Expected: FAIL — respostas 404 (rotas inexistentes).

- [ ] **Step 3: Implementar os schemas**

`backend/app/api/schemas/transactions.py`:

```python
from datetime import date, datetime
from typing import Annotated, Literal, assert_never
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.api.schemas.common import (
    Description,
    MerchantName,
    Money,
    Notes,
    NoticeOut,
    PositiveMoney,
)
from app.models import PaymentMethod, TransactionSource, TransactionStatus, TransactionType
from app.services.transactions import NewExpense, NewIncome, NewTransaction, NewTransfer


class IncomeIn(BaseModel):
    type: Literal["INCOME"]
    amount: PositiveMoney
    occurred_on: date
    description: Description
    account_id: UUID
    category_id: UUID | None = None
    merchant: MerchantName | None = None
    notes: Notes | None = None


class ExpenseIn(BaseModel):
    type: Literal["EXPENSE"]
    amount: PositiveMoney
    occurred_on: date
    description: Description
    account_id: UUID
    payment_method: PaymentMethod
    category_id: UUID | None = None
    merchant: MerchantName | None = None
    notes: Notes | None = None


class TransferIn(BaseModel):
    type: Literal["TRANSFER"]
    amount: PositiveMoney
    occurred_on: date
    description: Description
    account_id: UUID
    destination_account_id: UUID
    notes: Notes | None = None


TransactionIn = Annotated[IncomeIn | ExpenseIn | TransferIn, Field(discriminator="type")]


def to_new_transaction(body: IncomeIn | ExpenseIn | TransferIn) -> NewTransaction:
    match body:
        case IncomeIn():
            return NewIncome(
                amount=body.amount,
                occurred_on=body.occurred_on,
                description=body.description,
                account_id=body.account_id,
                category_id=body.category_id,
                merchant=body.merchant,
                notes=body.notes,
            )
        case ExpenseIn():
            return NewExpense(
                amount=body.amount,
                occurred_on=body.occurred_on,
                description=body.description,
                account_id=body.account_id,
                payment_method=body.payment_method,
                category_id=body.category_id,
                merchant=body.merchant,
                notes=body.notes,
            )
        case TransferIn():
            return NewTransfer(
                amount=body.amount,
                occurred_on=body.occurred_on,
                description=body.description,
                account_id=body.account_id,
                destination_account_id=body.destination_account_id,
                notes=body.notes,
            )
        case _:
            assert_never(body)


class RefundIn(BaseModel):
    amount: PositiveMoney
    occurred_on: date
    account_id: UUID | None = None
    description: Description | None = None


class TransactionPatch(BaseModel):
    """Só os campos enviados são alterados. `null` em campo obrigatório gera erro 422."""

    amount: PositiveMoney | None = None
    occurred_on: date | None = None
    description: Description | None = None
    notes: Notes | None = None
    merchant: MerchantName | None = None
    category_id: UUID | None = None
    account_id: UUID | None = None
    destination_account_id: UUID | None = None
    payment_method: PaymentMethod | None = None


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    type: TransactionType
    amount: Money
    occurred_on: date
    description: str
    notes: str | None
    merchant_id: UUID | None
    category_id: UUID | None
    account_id: UUID
    destination_account_id: UUID | None
    payment_method: PaymentMethod | None
    refund_of_id: UUID | None
    status: TransactionStatus
    source: TransactionSource
    created_at: datetime
    voided_at: datetime | None


class TransactionWriteOut(BaseModel):
    transaction: TransactionOut
    replayed: bool = False
    warnings: list[NoticeOut] = Field(default_factory=list)


class TransactionPage(BaseModel):
    items: list[TransactionOut]
    next_cursor: str | None
```

`backend/app/api/schemas/entry.py`:

```python
from datetime import date
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.api.schemas.common import MerchantName, PositiveMoney
from app.api.schemas.transactions import TransactionOut
from app.models import AccountType, PaymentMethod


class EntryAccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    type: AccountType


class PaymentOptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    account_id: UUID
    account_name: str
    payment_method: PaymentMethod


class EntryHintsOut(BaseModel):
    today: date
    accounts: list[EntryAccountOut]
    payment_methods: list[PaymentMethod]
    top_payment_options: list[PaymentOptionOut]


class EntryCheckItem(BaseModel):
    amount: PositiveMoney
    merchant: MerchantName | None = None
    occurred_on: date


class EntryChecksIn(BaseModel):
    items: list[EntryCheckItem] = Field(min_length=1, max_length=50)


class EntryCheckResult(BaseModel):
    index: int
    possible_duplicates: list[TransactionOut]


class EntryChecksOut(BaseModel):
    results: list[EntryCheckResult]
```

`backend/app/api/schemas/summaries.py`:

```python
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.api.schemas.common import Money


class CategoryAmountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    category_id: UUID
    name: str
    amount: Money


class MonthSummaryOut(BaseModel):
    month: str
    income: Money
    consumption_total: Money
    by_category: list[CategoryAmountOut]
```

- [ ] **Step 4: Implementar as rotas**

`backend/app/api/routes/transactions.py`:

```python
from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Header, Query, Response

from app.api.deps import CtxDep, DbDep
from app.api.schemas.common import NoticeOut
from app.api.schemas.transactions import (
    RefundIn,
    TransactionIn,
    TransactionOut,
    TransactionPage,
    TransactionPatch,
    TransactionWriteOut,
    to_new_transaction,
)
from app.models import PaymentMethod, Transaction, TransactionStatus, TransactionType
from app.repositories import get_owned
from app.services import ledger, transactions
from app.services.transactions import NewRefund, WriteResult

router = APIRouter(prefix="/transactions", tags=["transactions"])

IdempotencyKey = Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=100)]


def _write_out(result: WriteResult) -> TransactionWriteOut:
    return TransactionWriteOut(
        transaction=TransactionOut.model_validate(result.transaction),
        replayed=result.replayed,
        warnings=NoticeOut.many(result.notices),
    )


@router.post("", status_code=201, response_model=TransactionWriteOut)
def create_transaction(
    body: TransactionIn,
    idempotency_key: IdempotencyKey,
    response: Response,
    ctx: CtxDep,
    db: DbDep,
) -> TransactionWriteOut:
    result = transactions.create_transaction(
        db, ctx, to_new_transaction(body), idempotency_key=idempotency_key
    )
    db.commit()
    if result.replayed:
        response.status_code = 200
    return _write_out(result)


@router.get("", response_model=TransactionPage)
def list_transactions(
    ctx: CtxDep,
    db: DbDep,
    date_from: date | None = None,
    date_to: date | None = None,
    account_id: UUID | None = None,
    category_id: UUID | None = None,
    merchant_id: UUID | None = None,
    payment_method: PaymentMethod | None = None,
    tx_type: Annotated[TransactionType | None, Query(alias="type")] = None,
    status: Literal["CONFIRMED", "VOIDED", "ALL"] = "CONFIRMED",
    cursor: Annotated[str | None, Query(max_length=200)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> TransactionPage:
    filters = ledger.TransactionFilters(
        date_from=date_from,
        date_to=date_to,
        account_id=account_id,
        category_id=category_id,
        merchant_id=merchant_id,
        payment_method=payment_method,
        type=tx_type,
        status=None if status == "ALL" else TransactionStatus(status),
    )
    page = ledger.list_transactions(db, ctx.user_id, filters, cursor=cursor, limit=limit)
    return TransactionPage(
        items=[TransactionOut.model_validate(t) for t in page.items],
        next_cursor=page.next_cursor,
    )


@router.get("/{transaction_id}", response_model=TransactionOut)
def get_transaction(transaction_id: UUID, ctx: CtxDep, db: DbDep) -> Transaction:
    return get_owned(db, Transaction, transaction_id, ctx.user_id, "o lançamento")


@router.patch("/{transaction_id}", response_model=TransactionWriteOut)
def update_transaction(
    transaction_id: UUID, body: TransactionPatch, ctx: CtxDep, db: DbDep
) -> TransactionWriteOut:
    result = transactions.update_transaction(
        db, ctx, transaction_id, body.model_dump(exclude_unset=True)
    )
    db.commit()
    return _write_out(result)


@router.post("/{transaction_id}/void", response_model=TransactionOut)
def void_transaction(transaction_id: UUID, ctx: CtxDep, db: DbDep) -> Transaction:
    tx = transactions.void_transaction(db, ctx, transaction_id)
    db.commit()
    return tx


@router.post("/{transaction_id}/refunds", status_code=201, response_model=TransactionWriteOut)
def create_refund(
    transaction_id: UUID,
    body: RefundIn,
    idempotency_key: IdempotencyKey,
    response: Response,
    ctx: CtxDep,
    db: DbDep,
) -> TransactionWriteOut:
    data = NewRefund(
        amount=body.amount,
        occurred_on=body.occurred_on,
        account_id=body.account_id,
        description=body.description,
    )
    result = transactions.create_refund(
        db, ctx, transaction_id, data, idempotency_key=idempotency_key
    )
    db.commit()
    if result.replayed:
        response.status_code = 200
    return _write_out(result)
```

`backend/app/api/routes/entry.py`:

```python
from fastapi import APIRouter

from app.api.deps import CtxDep, DbDep
from app.api.schemas.entry import (
    EntryAccountOut,
    EntryCheckResult,
    EntryChecksIn,
    EntryChecksOut,
    EntryHintsOut,
    PaymentOptionOut,
)
from app.api.schemas.transactions import TransactionOut
from app.models import PaymentMethod
from app.services import accounts, ledger

router = APIRouter(tags=["entry"])


@router.get("/entry-hints", response_model=EntryHintsOut)
def entry_hints(ctx: CtxDep, db: DbDep) -> EntryHintsOut:
    """Tudo que a tela de registro precisa para montar o cartão de confirmação."""
    today = ctx.today()
    return EntryHintsOut(
        today=today,
        accounts=[EntryAccountOut.model_validate(a) for a in accounts.list_accounts(db, ctx)],
        payment_methods=list(PaymentMethod),
        top_payment_options=[
            PaymentOptionOut.model_validate(o)
            for o in ledger.top_payment_options(db, ctx.user_id, today)
        ],
    )


@router.post("/entry-checks", response_model=EntryChecksOut)
def entry_checks(body: EntryChecksIn, ctx: CtxDep, db: DbDep) -> EntryChecksOut:
    """Possíveis duplicatas para cada item antes de confirmar (não grava nada)."""
    results = [
        EntryCheckResult(
            index=index,
            possible_duplicates=[
                TransactionOut.model_validate(t)
                for t in ledger.possible_duplicates(
                    db,
                    ctx.user_id,
                    amount=item.amount,
                    merchant=item.merchant,
                    occurred_on=item.occurred_on,
                )
            ],
        )
        for index, item in enumerate(body.items)
    ]
    return EntryChecksOut(results=results)
```

`backend/app/api/routes/summaries.py`:

```python
from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import CtxDep, DbDep
from app.api.schemas.summaries import CategoryAmountOut, MonthSummaryOut
from app.domain.dates import parse_month
from app.domain.errors import RuleViolation
from app.services import ledger

router = APIRouter(prefix="/summaries", tags=["summaries"])


@router.get("/month", response_model=MonthSummaryOut)
def month_summary(
    ctx: CtxDep, db: DbDep, month: Annotated[str, Query(max_length=7)]
) -> MonthSummaryOut:
    try:
        year, number = parse_month(month)
    except ValueError as exc:
        raise RuleViolation("invalid_month", str(exc)) from exc
    summary = ledger.month_summary(db, ctx.user_id, year, number)
    return MonthSummaryOut(
        month=f"{year:04d}-{number:02d}",
        income=summary.income,
        consumption_total=summary.consumption_total,
        by_category=[CategoryAmountOut.model_validate(c) for c in summary.by_category],
    )
```

Substitua `backend/app/api/routes/__init__.py` por:

```python
from fastapi import APIRouter

from app.api.routes import (
    accounts,
    auth,
    categories,
    entry,
    health,
    merchants,
    summaries,
    transactions,
)

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(accounts.router)
api_router.include_router(categories.router)
api_router.include_router(merchants.router)
api_router.include_router(transactions.router)
api_router.include_router(entry.router)
api_router.include_router(summaries.router)
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `uv run pytest tests/api -v`
Expected: PASS (todos).

- [ ] **Step 6: Verificação completa e commit**

Run (em `backend/`): `uv run ruff format . && uv run ruff check --fix .` — depois, na raiz: `bash scripts/check.sh`
Expected: tudo verde.

```bash
git add backend/app/api backend/tests/api
git commit -m "feat(api): lançamentos, estornos, apoio ao registro e resumo do mês" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: README e verificação ponta a ponta manual

**Files:**
- Create: `README.md` (raiz)

**Interfaces:**
- Consumes: tudo o que foi construído.
- Produces: instruções de execução local; confirmação manual de que o servidor sobe, aplica migrações, cria usuária e registra um lançamento.

- [ ] **Step 1: Escrever `README.md`**

````markdown
# Assistente Financeiro Pessoal

Aplicação pessoal de controle financeiro com registro por frases curtas e, futuramente, assistente de IA.

- Decisões e regras financeiras: `docs/superpowers/specs/2026-10-15-visao-geral-design.md`
- Subprojeto 1 (fundação e lançamentos): `docs/superpowers/specs/2026-10-15-fundacao-e-lancamentos-design.md`

## Requisitos

- Docker (com Compose)
- [uv](https://docs.astral.sh/uv/) — instala o Python 3.14 automaticamente
- No Windows, use o Git Bash para os comandos abaixo

## Rodando o backend

```bash
docker compose up -d db
cd backend
uv sync
cp .env.example .env          # ajuste SECRET_KEY
uv run alembic upgrade head
uv run python -m app.cli create-user --email voce@example.com
uv run uvicorn --factory app.main:create_app --reload
```

- API em `http://localhost:8000/api/v1`; documentação em `http://localhost:8000/docs` (com `ENABLE_DOCS=true`).
- Não existe cadastro público: usuárias são criadas só pelo comando `create-user`.
- Toda requisição que altera dados precisa dos cabeçalhos `Origin` (igual a `APP_ORIGIN`) e `X-Requested-With` — proteção contra CSRF. Por isso o botão "Try it out" da documentação não funciona para POST/PATCH; use `curl`:

```bash
curl -i -c cookies.txt -H "Origin: http://localhost:8000" -H "X-Requested-With: curl" \
  -H "Content-Type: application/json" \
  -d '{"email":"voce@example.com","password":"SUA_SENHA"}' \
  http://localhost:8000/api/v1/auth/login
```

## Administração

```bash
uv run python -m app.cli set-password --email voce@example.com     # troca a senha e encerra sessões
uv run python -m app.cli revoke-sessions --email voce@example.com  # encerra todas as sessões
```

## Testes e verificação

```bash
bash scripts/check.sh
```

Roda ruff, mypy e pytest. Os testes usam o banco `finance_test` do docker compose (porta 5433).
````

- [ ] **Step 2: Rodar a verificação completa**

Run (em `backend/`): `uv run ruff format . && uv run ruff check --fix .` — depois, na raiz: `bash scripts/check.sh`
Expected: ruff e mypy sem erros; pytest com todos os testes passando (por volta de 190).

- [ ] **Step 3: Teste manual ponta a ponta**

Em `backend/`, com `.env` criado a partir do exemplo:

```bash
uv run alembic upgrade head
PF_NEW_PASSWORD="senha-local-bem-longa" uv run python -m app.cli create-user --email teste@example.com
uv run uvicorn --factory app.main:create_app --port 8000
```

Em outro terminal (raiz do projeto):

```bash
H='-H Origin:http://localhost:8000 -H X-Requested-With:curl -H Content-Type:application/json'
curl -s http://localhost:8000/api/v1/health
curl -s -c /tmp/pf.txt $H -d '{"email":"teste@example.com","password":"senha-local-bem-longa"}' http://localhost:8000/api/v1/auth/login
ACC=$(curl -s -b /tmp/pf.txt $H -d '{"name":"Itaú","type":"CHECKING","opening_balance":"1000.00","opening_date":"2026-10-01"}' http://localhost:8000/api/v1/accounts | uv run --project backend python -c "import json,sys; print(json.load(sys.stdin)['id'])")
curl -s -b /tmp/pf.txt $H -H "Idempotency-Key: manual-0001" -d "{\"type\":\"EXPENSE\",\"amount\":\"42.00\",\"occurred_on\":\"2026-10-15\",\"description\":\"Mercado\",\"account_id\":\"$ACC\",\"payment_method\":\"PIX\"}" http://localhost:8000/api/v1/transactions
curl -s -b /tmp/pf.txt http://localhost:8000/api/v1/accounts/balances
```

Expected: `{"status":"ok"}`; login devolve a usuária; o lançamento volta com `"amount":"42.00"`; o saldo da conta Itaú é `"958.00"`. Os logs do uvicorn mostram só método, caminho, status e duração — nenhum valor, descrição ou e-mail.

Pare o servidor (Ctrl+C). Se quiser limpar o banco de desenvolvimento: `docker compose down -v && docker compose up -d db`.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README com execução local, administração e testes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
