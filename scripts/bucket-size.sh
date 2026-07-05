#!/bin/zsh
# Show total + per-folder size of the R2 bucket against the 10 GB free tier.
#
# Usage: ./scripts/bucket-size.sh [bucket]

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

# per-folder breakdown + total, aggregated from one listing pass
rclone lsjson -R --files-only "r2:$BUCKET" 2>/dev/null | python3 -c '
import json, sys

LIMIT = 10 * 1024**3  # R2 free tier: 10 GB storage

def human(n):
    for unit in ("B", "KiB", "MiB", "GiB"):
        if n < 1024 or unit == "GiB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
        n /= 1024

files = json.load(sys.stdin)
folders, total = {}, 0
for f in files:
    top = f["Path"].split("/")[0] if "/" in f["Path"] else "(root)"
    folders[top] = folders.get(top, [0, 0])
    folders[top][0] += f["Size"]
    folders[top][1] += 1
    total += f["Size"]

width = max((len(k) for k in folders), default=0)
for name, (size, count) in sorted(folders.items(), key=lambda x: -x[1][0]):
    print(f"  {name:<{width}}  {human(size):>10}  ({count} files)")

pct = total / LIMIT * 100
bar = "#" * round(pct / 2.5) + "-" * (40 - round(pct / 2.5))
print(f"\n  total: {human(total)} of 10 GiB  [{bar}] {pct:.1f}%")
print(f"  free : {human(LIMIT - total)}")
'
