"""misread phrases

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-18 12:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "misread_phrases",
        sa.Column("text", sa.String(length=500), nullable=False),
        sa.Column("reasons", postgresql.ARRAY(sa.String(length=30)), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_misread_phrases_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_misread_phrases")),
    )
    op.create_index(
        op.f("ix_misread_phrases_user_id"), "misread_phrases", ["user_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_misread_phrases_user_id"), table_name="misread_phrases")
    op.drop_table("misread_phrases")
