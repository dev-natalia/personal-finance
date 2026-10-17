"""card name unique among active cards

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-17 12:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(op.f("uq_cards_user_id_name"), "cards", type_="unique")
    op.create_index(
        "uq_cards_user_id_name_active",
        "cards",
        ["user_id", "name"],
        unique=True,
        postgresql_where=sa.text("archived_at IS NULL"),
    )


def downgrade() -> None:
    # Falha se já houver um arquivado e um ativo com o mesmo nome (como deve).
    op.drop_index("uq_cards_user_id_name_active", table_name="cards")
    op.create_unique_constraint(op.f("uq_cards_user_id_name"), "cards", ["user_id", "name"])
