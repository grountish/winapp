#!/usr/bin/env python3
"""Generate Winapp PWA icons (blocky green W on dark) without any dependencies."""
import struct
import sys
import zlib

# 12x12 pixel-art "W" (1 = green, 0 = background)
GLYPH = [
    "............",
    ".#........#.",
    ".#........#.",
    ".#........#.",
    ".#........#.",
    ".#...##...#.",
    ".#..#..#..#.",
    ".#..#..#..#.",
    ".##.#..#.##.",
    "..###..###..",
    "..##....##..",
    "............",
]
GREEN = (0, 255, 64, 255)
DARK = (23, 23, 25, 255)


def make_png(size: int, path: str) -> None:
    cell = size // len(GLYPH)
    off = (size - cell * len(GLYPH)) // 2
    rows = []
    for y in range(size):
        row = bytearray(b"\x00")  # filter byte
        gy = min(max((y - off) // cell, 0), len(GLYPH) - 1)
        for x in range(size):
            gx = min(max((x - off) // cell, 0), len(GLYPH) - 1)
            row += bytes(GREEN if GLYPH[gy][gx] == "#" else DARK)
        rows.append(bytes(row))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    idat = zlib.compress(b"".join(rows), 9)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", idat)
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)
    print(f"wrote {path} ({size}x{size}, {len(png)} bytes)")


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "web"
    make_png(192, f"{out}/icon-192.png")
    make_png(512, f"{out}/icon-512.png")
