#!/usr/bin/env bash
# Deploys the checked-out code to the production folder on this computer.
# Run automatically by the self-hosted GitHub runner (see .github/workflows/deploy.yml).
# Can also be run by hand from a clean checkout:  bash deploy/deploy.sh
#
# Layout (APP_ROOT, default ~/price-checker):
#   releases/<time>-<commit>/   one folder per deploy (last 5 kept)
#   current -> releases/...     the release the app runs from
#   shared/.env, shared/data/   settings and database, kept across deploys
#   backups/                    database copy taken before each deploy (last 30 kept)
set -euo pipefail

APP_ROOT="${APP_ROOT:-$HOME/price-checker}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
SHA="$(git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo manual)"
STAMP="$(date +%Y%m%d-%H%M%S)"
NAME="$STAMP-$SHA"
RELEASE="$APP_ROOT/releases/$NAME"
SHARED="$APP_ROOT/shared"
DB="$SHARED/data/pricechecker.db"
KEEP_RELEASES=5
KEEP_BACKUPS=30

log() { printf '\n==> %s\n' "$*"; }
die() { printf '\n!! %s\n' "$*" >&2; exit 1; }

# `systemctl --user` needs the user's session bus, also when started from the runner service.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

[ -f "$SHARED/.env" ] || die "$SHARED/.env is missing — run deploy/setup.sh first."

# Node.js via nvm, version from .nvmrc (installed automatically when it changes).
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
cd "$SRC"
nvm install >/dev/null
nvm use >/dev/null
log "Using Node $(node -v)"

PORT="$(grep -E '^PORT=' "$SHARED/.env" | tail -1 | cut -d= -f2 | tr -d '\r" ')"
PORT="${PORT:-3000}"

# ---------- Build the new release ----------
log "Building release $NAME"
mkdir -p "$RELEASE"
rsync -a --delete --exclude .git --exclude node_modules --exclude dist \
  --exclude /data --exclude .env "$SRC/" "$RELEASE/"
cd "$RELEASE"
npm ci --no-audit --no-fund
npm run build
npm prune --omit=dev --no-audit --no-fund
ln -sfn "$SHARED/.env" "$RELEASE/.env"

# Stable path to the right Node binary for the systemd services.
mkdir -p "$APP_ROOT/bin"
ln -sfn "$(command -v node)" "$APP_ROOT/bin/node"

# ---------- Back up the database ----------
BACKUP=""
if [ -f "$DB" ]; then
  mkdir -p "$APP_ROOT/backups"
  BACKUP="$APP_ROOT/backups/pricechecker-$NAME.db"
  log "Backing up database to $BACKUP"
  sqlite3 "$DB" ".backup '$BACKUP'"
fi

# ---------- Switch over, check health, roll back on failure ----------
PREVIOUS="$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)"
switch_to() { ln -sfn "$1" "$APP_ROOT/current.tmp" && mv -Tf "$APP_ROOT/current.tmp" "$APP_ROOT/current"; }

healthy() {
  for _ in $(seq 1 30); do
    curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/config" && return 0
    sleep 1
  done
  return 1
}

log "Starting release $NAME"
switch_to "$RELEASE"
systemctl --user restart pricechecker.service

if ! healthy; then
  journalctl --user -u pricechecker.service -n 40 --no-pager || true
  [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ] || die "Deploy failed (no previous release to roll back to)."
  log "Health check failed — rolling back to $(basename "$PREVIOUS")"
  systemctl --user stop pricechecker.service
  # The new code may already have changed the database layout; put back the pre-deploy copy.
  if [ -n "$BACKUP" ]; then
    cp "$BACKUP" "$DB"
    rm -f "$DB-wal" "$DB-shm"
  fi
  switch_to "$PREVIOUS"
  systemctl --user start pricechecker.service
  healthy && die "Deploy failed; rolled back to the previous release. The site is up."
  die "Deploy failed and the rollback is not healthy either. Check: journalctl --user -u pricechecker"
fi
log "App is healthy on port $PORT"

# Tunnel: start it if needed; restart only if its script changed (avoids a needless blip).
if ! systemctl --user is-active --quiet pricechecker-tunnel.service; then
  systemctl --user start pricechecker-tunnel.service
elif [ -z "$PREVIOUS" ] || ! cmp -s "$PREVIOUS/scripts/tunnel.js" "$RELEASE/scripts/tunnel.js"; then
  systemctl --user restart pricechecker-tunnel.service
fi

# ---------- Clean up old releases and backups ----------
CURRENT="$(readlink -f "$APP_ROOT/current")"
mkdir -p "$APP_ROOT/backups"
find "$APP_ROOT/releases" -mindepth 1 -maxdepth 1 -type d | sort -r | tail -n +$((KEEP_RELEASES + 1)) |
  while read -r old; do [ "$old" = "$CURRENT" ] || rm -rf "$old"; done
find "$APP_ROOT/backups" -maxdepth 1 -name '*.db' | sort -r | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f

log "Deployed $NAME"
