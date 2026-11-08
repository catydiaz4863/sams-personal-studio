import { isLoggedIn, sameOrigin, json } from "../_lib/auth.js";

const KEY = "schedule";
const PREVIOUS_KEY = "schedule:previous";
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// GET /api/schedule  (public)
// Returns the saved schedule, or the starter file in /data/schedule.json if
// the owner hasn't saved one yet.
export async function onRequestGet({ request, env }) {
  const saved = await env.SCHEDULE_KV.get(KEY);
  if (saved) return json(JSON.parse(saved));

  const starter = await env.ASSETS.fetch(new URL("/data/schedule.json", request.url));
  return json(await starter.json());
}

// PUT /api/schedule  (owner only)
export async function onRequestPut({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "Bad origin" }, { status: 403 });
  if (!(await isLoggedIn(request, env))) {
    return json({ error: "You've been logged out. Log in again to save." }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Bad request" }, { status: 400 });
  }

  const result = validate(body);
  if (result.error) return json({ error: result.error }, { status: 400 });

  // Keep the last version so a bad save can be undone.
  const current = await env.SCHEDULE_KV.get(KEY);
  if (current) await env.SCHEDULE_KV.put(PREVIOUS_KEY, current);

  await env.SCHEDULE_KV.put(KEY, JSON.stringify(result.data));
  return json(result.data);
}

function cleanText(value, max) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

function validate(body) {
  if (!body || typeof body !== "object" || !Array.isArray(body.classes)) {
    return { error: "Schedule is missing its class list." };
  }
  if (body.classes.length > 200) return { error: "That's more than 200 classes." };

  const classes = [];
  for (const c of body.classes) {
    const name = cleanText(c && c.name, 60);
    const day = c && c.day;
    const time = c && c.time;
    if (!name) continue; // ignore blank rows
    if (!DAYS.includes(day)) return { error: `"${name}" has an unknown day.` };
    if (!TIME.test(String(time))) return { error: `"${name}" needs a start time.` };
    classes.push({ day, time, name });
  }

  classes.sort((a, b) =>
    DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.time.localeCompare(b.time));

  return {
    data: {
      month: cleanText(body.month, 40) || "This month",
      note: cleanText(body.note, 300),
      classes,
      updatedAt: new Date().toISOString(),
    },
  };
}
