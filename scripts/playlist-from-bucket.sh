#!/bin/zsh
# Build web/playlist.json from the music ALREADY in the R2 bucket
# (for music uploaded via the Cloudflare dashboard instead of sync-music.sh).
#
# Usage: ./scripts/playlist-from-bucket.sh [bucket]

set -euo pipefail
cd "$(dirname "$0")/.."

command -v rclone >/dev/null || { echo "rclone missing: brew install rclone" >&2; exit 1; }
[[ -f .env ]] || { echo "missing .env — cp .env.example .env and fill in R2 credentials" >&2; exit 1; }

set -a; source .env; set +a
: ${R2_ACCOUNT_ID:?set in .env} ${R2_ACCESS_KEY_ID:?set in .env} ${R2_SECRET_ACCESS_KEY:?set in .env}

BUCKET=${1:-${R2_BUCKET:-winapp}}

export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY
export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

echo "==> Listing r2:$BUCKET ..."
rclone lsf -R --files-only "r2:$BUCKET" \
  | python3 scripts/gen-playlist.py - web/playlist.json "${R2_PUBLIC_BASE:-}"

if [[ -n "${R2_PUBLIC_BASE:-}" ]]; then
  echo "==> Done. Commit + push web/playlist.json to redeploy the player."
else
  echo "==> Uploading player to the bucket..."
  rclone copy web "r2:$BUCKET" --s3-no-check-bucket --progress
  echo "==> Done."
fi
