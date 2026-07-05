// Serves /playlist.json built live from the R2 bucket listing, so tracks
// uploaded by any tool appear in the player without regenerating a manifest.
// Track shape mirrors scripts/gen-playlist.py: folder = album,
// filename = title, "Title - Artist.ext" fills artist (last " - " wins).

const AUDIO_EXT = new Set([
  ".mp3", ".m4a", ".m4b", ".aac", ".wav", ".aif", ".aiff",
  ".flac", ".caf", ".ogg", ".opus",
]);

function makeTrack(key) {
  const name = key.split("/").pop();
  const dot = name.lastIndexOf(".");
  if (dot < 0 || name.startsWith(".") || !AUDIO_EXT.has(name.slice(dot).toLowerCase())) {
    return null;
  }
  const stem = name.slice(0, dot);
  const dir = key.slice(0, key.length - name.length - 1);
  const album = dir.split("/").pop() || null;
  let title = stem;
  let artist = null;
  const sep = stem.lastIndexOf(" - ");
  if (sep !== -1) {
    title = stem.slice(0, sep);
    artist = stem.slice(sep + 3);
  }
  const track = { path: key, title };
  if (artist) track.artist = artist;
  if (album) track.album = album;
  return track;
}

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "GET") return new Response("method not allowed", { status: 405, headers: cors });

    const tracks = [];
    let cursor;
    do {
      const page = await env.MUSIC.list({ cursor, limit: 1000 });
      for (const obj of page.objects) {
        const t = makeTrack(obj.key);
        if (t) tracks.push(t);
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);

    tracks.sort((a, b) =>
      (a.album || "").localeCompare(b.album || "") || a.path.localeCompare(b.path)
    );

    let base = env.PUBLIC_BASE || "";
    if (base && !base.endsWith("/")) base += "/";

    return Response.json({ base, tracks }, {
      headers: { ...cors, "Cache-Control": "no-store" },
    });
  },
};
