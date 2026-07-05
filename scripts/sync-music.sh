#!/bin/zsh
# Sync a local music folder + the web player to a Cloudflare R2 bucket.
#
# One-time setup:
#   1. brew install rclone
#   2. Cloudflare dashboard -> R2 -> Create bucket (e.g. "winapp")
#      -> bucket Settings -> Public access -> enable r2.dev subdomain
#   3. R2 -> Manage API tokens -> Create token (Object Read & Write)
#   4. cp .env.example .env  and fill in the credentials
#
# Usage:
#   ./scripts/sync-music.sh ~/Music/winapp              # bucket from .env
#   ./scripts/sync-music.sh ~/Music/winapp otherbucket  # override bucket

set -euo pipefail
cd "$(dirname "$0")/.."

SRC=${1:?usage: sync-music.sh <music-folder> [bucket]}

command -v rclone >/dev/null || { echo "rclone missing: brew install rclone" >&2; exit 1; }
[[ -f .env ]] || { echo "missing .env — cp .env.example .env and fill in R2 credentials" >&2; exit 1; }

set -a; source .env; set +a
: ${R2_ACCOUNT_ID:?set in .env} ${R2_ACCESS_KEY_ID:?set in .env} ${R2_SECRET_ACCESS_KEY:?set in .env}

BUCKET=${2:-${R2_BUCKET:-winapp}}

# rclone remote "r2" defined entirely via environment — no rclone.conf needed
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY
export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

echo "==> Generating playlist.json..."
python3 scripts/gen-playlist.py "$SRC" web/playlist.json ${R2_PUBLIC_BASE:+"$R2_PUBLIC_BASE"}

echo "==> Syncing music to r2:$BUCKET/music ..."
rclone sync "$SRC" "r2:$BUCKET/music" --s3-no-check-bucket --exclude ".*" --exclude ".*/**" --progress

if [[ -n "${R2_PUBLIC_BASE:-}" ]]; then
  # player hosted elsewhere (Vercel): playlist ships with the repo
  echo "==> Done. Commit + push web/playlist.json to redeploy the player."
else
  echo "==> Uploading player to the bucket..."
  rclone copy web "r2:$BUCKET" --s3-no-check-bucket --progress
  echo "==> Done. Player URL: your bucket's r2.dev subdomain /index.html"
fi
