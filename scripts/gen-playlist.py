#!/usr/bin/env python3
"""Build playlist.json from a local music folder.

Usage: gen-playlist.py <music-folder> <output.json> [base-url]

Track paths are written relative to the bucket root as "music/<relpath>",
matching where sync-music.sh uploads them. Title comes from the filename,
album from the containing folder; an "Artist - Title" filename fills artist.

With [base-url] (the bucket's public https://pub-....r2.dev URL) the output
is {"base": ..., "tracks": [...]} so the player can be hosted elsewhere
(e.g. Vercel) while audio streams from the bucket.
"""
import json
import os
import sys

AUDIO_EXT = {".mp3", ".m4a", ".m4b", ".aac", ".wav", ".aif", ".aiff", ".flac", ".caf", ".ogg", ".opus"}


def main() -> None:
    if len(sys.argv) not in (3, 4):
        sys.exit(__doc__)
    src, out = sys.argv[1], sys.argv[2]
    base = sys.argv[3].rstrip("/") + "/" if len(sys.argv) == 4 else ""
    if not os.path.isdir(src):
        sys.exit(f"not a directory: {src}")

    tracks = []
    for root, dirs, files in os.walk(src):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        for name in sorted(files):
            stem, ext = os.path.splitext(name)
            if ext.lower() not in AUDIO_EXT or name.startswith("."):
                continue
            rel = os.path.relpath(os.path.join(root, name), src)
            album = os.path.basename(os.path.dirname(rel)) or None
            artist = None
            title = stem
            if " - " in stem:
                artist, title = stem.split(" - ", 1)
            track = {"path": "music/" + rel.replace(os.sep, "/"), "title": title}
            if artist:
                track["artist"] = artist
            if album:
                track["album"] = album
            tracks.append(track)

    tracks.sort(key=lambda t: (t.get("album") or "", t["path"]))
    payload = {"base": base, "tracks": tracks} if base else tracks
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print(f"{len(tracks)} tracks -> {out}" + (f" (base: {base})" if base else ""))


if __name__ == "__main__":
    main()
