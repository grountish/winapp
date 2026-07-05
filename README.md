# Winapp

Winamp-style music player as a PWA. Streams your music from a Cloudflare R2
bucket (free tier: 10 GB storage, unlimited egress). No app signing, no
7-day expiry, instant updates — just a web page you add to the home screen.

## Features

- Playlist from `playlist.json` manifest in the bucket
- Play / pause / stop / next / previous, seek, shuffle, filter
- Winamp `prev` behavior: >3s into a track, prev restarts it
- Lock screen / Control Center controls (Media Session API)
- Resumes last track + position on relaunch
- Classic black + green LCD look
- Installable PWA (offline app shell; audio streams from bucket)

## Layout

```
web/       the player (uploaded to the bucket root)
scripts/   gen-playlist.py  — folder -> playlist.json
           sync-music.sh    — rclone sync music + player -> R2
           gen-icons.py     — regenerates PWA icons
worker/    Cloudflare Worker — serves playlist.json built live from the
           bucket listing (optional; makes uploads appear without a re-push)
```

## Setup (one time)

1. `brew install rclone`
2. [Cloudflare dashboard](https://dash.cloudflare.com) → R2 → Create bucket
   (e.g. `winapp`) → bucket **Settings** → **Public access** → enable
   **r2.dev subdomain** (note the `https://pub-….r2.dev` URL)
3. R2 → **Manage API tokens** → Create token with **Object Read & Write**
4. `cp .env.example .env` and fill in account ID, key ID, secret, bucket name.
   `.env` is gitignored; the sync script feeds it to rclone via environment
   variables — no rclone.conf needed.

## Hosting the player

Two modes, controlled by `R2_PUBLIC_BASE` in `.env`:

- **Vercel (recommended)**: set `R2_PUBLIC_BASE` to the bucket's public
  `https://pub-….r2.dev` URL. Import the GitHub repo in
  [Vercel](https://vercel.com/new), set **Root Directory** to `web`,
  framework "Other", no build step. Every push redeploys the player;
  audio streams from R2 (no CORS needed — `playlist.json` is committed
  and served same-origin, `<audio>` loads cross-origin freely).
- **Bucket-only**: leave `R2_PUBLIC_BASE` unset; the sync script uploads the
  player into the bucket and everything is served from the r2.dev URL.

## Use

Whenever your local music folder changes:

```sh
./scripts/sync-music.sh ~/Music/winapp        # any folder, any bucket name
git add web/playlist.json && git commit -m "update playlist" && git push   # Vercel mode
```

Music uploaded straight to the bucket by another tool (Cloudflare dashboard,
Transmit, …) isn't picked up automatically in manifest mode — rebuild the
manifest from the bucket instead:

```sh
./scripts/playlist-from-bucket.sh
git add web/playlist.json && git commit -m "update playlist" && git push   # Vercel mode
```

## Dynamic playlist (no re-push after uploads)

Deploy the Worker in `worker/` once and the player reads the bucket listing
live — anything uploaded by any tool appears on the next reload:

1. `cd worker && npx wrangler login && npx wrangler deploy`
   (check `bucket_name` and `PUBLIC_BASE` in `worker/wrangler.toml` first)
2. Put the deployed URL into `web/index.html`:
   `window.PLAYLIST_URL = "https://winapp-playlist.<subdomain>.workers.dev/playlist.json"`
3. Commit + push once. After that, uploads appear without any re-push;
   the committed `playlist.json` remains as a fallback if the Worker is down.

iPhone: open the player URL in Safari → Share → **Add to Home Screen**.

Track metadata comes from the file layout: folder = album, filename = title,
`Artist - Title.mp3` fills artist.

Privacy note: the r2.dev URL is public (unguessable but unauthenticated) —
anyone with the exact URL can stream your files.
