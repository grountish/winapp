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

## Use

Whenever your local music folder changes:

```sh
./scripts/sync-music.sh ~/Music/winapp        # any folder, any bucket name
```

iPhone: open `https://pub-….r2.dev/index.html` in Safari → Share →
**Add to Home Screen**.

Track metadata comes from the file layout: folder = album, filename = title,
`Artist - Title.mp3` fills artist.

Privacy note: the r2.dev URL is public (unguessable but unauthenticated) —
anyone with the exact URL can stream your files.
