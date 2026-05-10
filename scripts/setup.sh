#!/usr/bin/env bash
set -euo pipefail

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example"
fi

echo "Generate encryption key with: openssl rand -hex 32"
echo "Edit .env, then run: docker compose up -d --build"
