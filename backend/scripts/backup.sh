#!/bin/sh
# Entrada da máquina agendada de backup (app financas-pessoais-backup no Fly; ver README).
# Um script em vez de "python -m app.backup" direto: o flyctl leria o "-m" como opção dele.
set -eu

exec python -m app.backup
