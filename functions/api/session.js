import { isLoggedIn, json } from "../_lib/auth.js";

// GET /api/session -> { loggedIn: true|false }
export async function onRequestGet({ request, env }) {
  return json({ loggedIn: await isLoggedIn(request, env) });
}
