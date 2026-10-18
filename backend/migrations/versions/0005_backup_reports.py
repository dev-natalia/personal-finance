"""backup reports

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-18 13:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "backup_reports",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("object_key", sa.String(length=300), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_backup_reports")),
    )
    op.create_index(
        op.f("ix_backup_reports_finished_at"), "backup_reports", ["finished_at"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_backup_reports_finished_at"), table_name="backup_reports")
    op.drop_table("backup_reports")
