import { isLoggedIn, sameOrigin, json } from "../_lib/auth.js";

// Event flyer images, stored in the same KV namespace as the schedule.
// The edit page shrinks photos before uploading, so they're small.
const MAX_BYTES = 3 * 1024 * 1024; // 3 MB
const TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MEDIA_PATH = /^\/media\/([a-f0-9]{32})$/;

// POST /api/media   (owner only) body = the image bytes, Content-Type = image type
export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Bad origin" }, { status: 403 });
  if (!(await isLoggedIn(request, env))) {
    return json({ error: "You've been logged out. Log in again to upload." }, { status: 401 });
  }
  const type = (request.headers.get("Content-Type") || "").split(";")[0].trim();
  if (!TYPES.includes(type)) return json({ error: "Please upload a photo (JPG, PNG or WebP)." }, { status: 415 });
  const declared = parseInt(request.headers.get("Content-Length") || "0", 10);
  if (declared > MAX_BYTES) return json({ error: "That image is too big (max 3 MB)." }, { status: 413 });

  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return json({ error: "The image was empty." }, { status: 400 });
  if (bytes.byteLength > MAX_BYTES) return json({ error: "That image is too big (max 3 MB)." }, { status: 413 });

  const id = crypto.randomUUID().replace(/-/g, "");
  await env.SCHEDULE_KV.put(`media:${id}`, bytes, { metadata: { type, uploadedAt: Date.now() } });
  return json({ url: `/media/${id}` });
}

// GET /media/<id>   (public)
export async function serveMedia(request, env, id) {
  const { value, metadata } = await env.SCHEDULE_KV.getWithMetadata(`media:${id}`, { type: "stream" });
  if (!value) return new Response("Not found", { status: 404 });
  return new Response(value, {
    headers: {
      "Content-Type": (metadata && metadata.type) || "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}

// Delete uploaded images no event uses anymore (older than an hour, so an
// image uploaded for an event that hasn't been saved yet is kept).
export async function cleanupMedia(env, keepUrls) {
  const keep = new Set(keepUrls.map((u) => (u.match(MEDIA_PATH) || [])[1]).filter(Boolean));
  const listed = await env.SCHEDULE_KV.list({ prefix: "media:" });
  const hourAgo = Date.now() - 60 * 60 * 1000;
  await Promise.all(listed.keys
    .filter((k) => !keep.has(k.name.slice(6)) && (!k.metadata || (k.metadata.uploadedAt || 0) < hourAgo))
    .map((k) => env.SCHEDULE_KV.delete(k.name)));
}
