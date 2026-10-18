#!/bin/sh
# Entrada da máquina agendada de backup (app caderno-de-gastos-backup no Fly; ver README).
# Um script em vez de "python -m app.backup" direto: o flyctl leria o "-m" como opção dele.
set -eu

exec python -m app.backup
