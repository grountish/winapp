#!/usr/bin/env python3
"""Build playlist.json from a local music folder or a bucket listing.

Usage: gen-playlist.py <music-folder> <output.json> [base-url]
       rclone lsf -R --files-only r2:bucket | gen-playlist.py - <output.json> [base-url]

Local folder mode prefixes paths with "music/" to match where sync-music.sh
uploads them; stdin mode ("-") takes bucket-relative paths verbatim.

Title/album come from the file layout: folder = album, filename = title,
"Title - Artist.mp3" fills artist (split on the last " - ").

With [base-url] (the bucket's public https://pub-....r2.dev URL) the output
is {"base": ..., "tracks": [...]} so the player can be hosted elsewhere
(e.g. Vercel) while audio streams from the bucket.
"""
import json
import os
import sys

AUDIO_EXT = {".mp3", ".m4a", ".m4b", ".aac", ".wav", ".aif", ".aiff", ".flac", ".caf", ".ogg", ".opus"}


def make_track(rel: str, prefix: str) -> dict:
    name = os.path.basename(rel)
    stem = os.path.splitext(name)[0]
    album = os.path.basename(os.path.dirname(rel)) or None
    artist = None
    title = stem
    if " - " in stem:
        title, artist = stem.rsplit(" - ", 1)
    track = {"path": prefix + rel.replace(os.sep, "/"), "title": title}
    if artist:
        track["artist"] = artist
    if album:
        track["album"] = album
    return track


def is_audio(name: str) -> bool:
    return os.path.splitext(name)[1].lower() in AUDIO_EXT and not name.startswith(".")


def main() -> None:
    if len(sys.argv) not in (3, 4):
        sys.exit(__doc__)
    src, out = sys.argv[1], sys.argv[2]
    base = sys.argv[3].rstrip("/") + "/" if len(sys.argv) == 4 and sys.argv[3] else ""

    tracks = []
    if src == "-":
        for line in sys.stdin:
            rel = line.strip()
            if rel and is_audio(os.path.basename(rel)):
                tracks.append(make_track(rel, ""))
    else:
        if not os.path.isdir(src):
            sys.exit(f"not a directory: {src}")
        for root, dirs, files in os.walk(src):
            dirs[:] = sorted(d for d in dirs if not d.startswith("."))
            for name in sorted(files):
                if not is_audio(name):
                    continue
                rel = os.path.relpath(os.path.join(root, name), src)
                tracks.append(make_track(rel, "music/"))

    tracks.sort(key=lambda t: (t.get("album") or "", t["path"]))
    payload = {"base": base, "tracks": tracks} if base else tracks
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    print(f"{len(tracks)} tracks -> {out}" + (f" (base: {base})" if base else ""))


if __name__ == "__main__":
    main()
