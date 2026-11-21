#!/usr/bin/env bash
# One-time setup of this computer as the production server + deploy runner.
# Safe to run again (it skips what is already done).
#
#   bash deploy/setup.sh                 # folders, settings, services, GitHub runner
#   bash deploy/setup.sh --import-data   # copy the database from this dev folder into production
#                                        # (do this once, right before the first deploy)
set -euo pipefail

APP_ROOT="${APP_ROOT:-$HOME/price-checker}"
PROD_PORT="${PROD_PORT:-3100}" # dev (`npm run dev`) keeps using 3000
RUNNER_DIR="$HOME/actions-runner"
RUNNER_LABEL="pricechecker-prod"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_DIR="$HOME/.config/systemd/user"

log() { printf '\n==> %s\n' "$*"; }
die() { printf '\n!! %s\n' "$*" >&2; exit 1; }
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

# ---------- --import-data: copy the dev database into production ----------
if [ "${1:-}" = "--import-data" ]; then
  SRC_DB="$REPO_DIR/data/pricechecker.db"
  DST_DB="$APP_ROOT/shared/data/pricechecker.db"
  [ -f "$SRC_DB" ] || die "No database at $SRC_DB"
  systemctl --user is-active --quiet pricechecker.service &&
    die "The production app is running. Stop it first: systemctl --user stop pricechecker"
  mkdir -p "$APP_ROOT/shared/data" "$APP_ROOT/backups"
  if [ -f "$DST_DB" ]; then
    keep="$APP_ROOT/backups/pricechecker-before-import-$(date +%Y%m%d-%H%M%S).db"
    sqlite3 "$DST_DB" ".backup '$keep'"
    echo "Existing production database saved to $keep"
  fi
  rm -f "$DST_DB" "$DST_DB-wal" "$DST_DB-shm"
  sqlite3 "$SRC_DB" ".backup '$DST_DB'" # consistent copy even if the dev app is running
  log "Copied $SRC_DB → $DST_DB"
  exit 0
fi

command -v gh >/dev/null || die "GitHub CLI (gh) is required."
command -v sqlite3 >/dev/null || die "sqlite3 is required (sudo apt install sqlite3)."
command -v cloudflared >/dev/null || die "cloudflared is required (see README)."

# ---------- Production folders + settings ----------
log "Production folder: $APP_ROOT"
mkdir -p "$APP_ROOT"/{releases,shared/data,backups,bin}
if [ ! -f "$APP_ROOT/shared/.env" ]; then
  [ -f "$REPO_DIR/.env" ] || die "No .env in $REPO_DIR to copy settings from."
  cp "$REPO_DIR/.env" "$APP_ROOT/shared/.env"
  chmod 600 "$APP_ROOT/shared/.env"
  # Production listens on its own port so `npm run dev` on 3000 doesn't clash; only reachable via the tunnel.
  sed -i -E "s/^PORT=.*/PORT=$PROD_PORT/; s/^HOST=.*/HOST=127.0.0.1/" "$APP_ROOT/shared/.env"
  grep -q '^PORT=' "$APP_ROOT/shared/.env" || echo "PORT=$PROD_PORT" >>"$APP_ROOT/shared/.env"
  grep -q '^HOST=' "$APP_ROOT/shared/.env" || echo "HOST=127.0.0.1" >>"$APP_ROOT/shared/.env"
  echo "Created $APP_ROOT/shared/.env from $REPO_DIR/.env (PORT=$PROD_PORT)"
else
  echo "Keeping existing $APP_ROOT/shared/.env"
fi
grep -q '^TUNNEL_TOKEN=.\+' "$APP_ROOT/shared/.env" || echo "!! TUNNEL_TOKEN is empty in $APP_ROOT/shared/.env"

# ---------- systemd user services ----------
log "Installing services into $UNIT_DIR"
mkdir -p "$UNIT_DIR"
cp "$REPO_DIR"/deploy/systemd/*.service "$UNIT_DIR/"
systemctl --user daemon-reload
systemctl --user enable pricechecker.service pricechecker-tunnel.service >/dev/null
echo "pricechecker + pricechecker-tunnel enabled (they start on the first deploy)"

# ---------- GitHub Actions self-hosted runner ----------
REPO_SLUG="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
if [ ! -f "$RUNNER_DIR/.runner" ]; then
  log "Installing GitHub runner for $REPO_SLUG"
  VERSION="$(gh api repos/actions/runner/releases/latest -q .tag_name | sed 's/^v//')"
  case "$(uname -m)" in x86_64) ARCH=x64 ;; aarch64) ARCH=arm64 ;; armv7l) ARCH=arm ;; *) die "Unsupported CPU $(uname -m)" ;; esac
  mkdir -p "$RUNNER_DIR"
  curl -fsSL "https://github.com/actions/runner/releases/download/v$VERSION/actions-runner-linux-$ARCH-$VERSION.tar.gz" |
    tar -xz -C "$RUNNER_DIR"
  TOKEN="$(gh api -X POST "repos/$REPO_SLUG/actions/runners/registration-token" -q .token)"
  (cd "$RUNNER_DIR" && ./config.sh --unattended --replace \
    --url "https://github.com/$REPO_SLUG" --token "$TOKEN" \
    --name "$(hostname)-prod" --labels "$RUNNER_LABEL" --work _work)
else
  echo "Runner already configured in $RUNNER_DIR"
fi
systemctl --user enable --now github-runner.service >/dev/null
echo "Runner service running: $(systemctl --user is-active github-runner.service)"

# ---------- Repo safety: the runner must never run code from strangers' pull requests ----------
log "Requiring approval before workflows run for outside contributors"
gh api -X PUT "repos/$REPO_SLUG/actions/permissions/fork-pr-contributor-approval" \
  -f approval_policy=all_external_contributors >/dev/null && echo "done" ||
  echo "!! Could not set it — set it by hand: repo Settings → Actions → General → 'Require approval for all external contributors'"

# ---------- Keep running when logged out / after reboot ----------
if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" != "yes" ]; then
  log "ONE MORE STEP (needs your password): let the services run without you being logged in"
  echo "    sudo loginctl enable-linger $USER"
fi

log "Setup complete"
