// Cloudflare Worker entry point.
// Files in /public (pages, CSS, images) are served automatically by
// Cloudflare. Requests to /api/* come here and go to the matching handler.
import * as login from "./api/login.js";
import * as logout from "./api/logout.js";
import * as session from "./api/session.js";
import * as schedule from "./api/schedule.js";
import * as media from "./api/media.js";
import { survey, reviews, surveyLinks, adminSurveys, adminResponses } from "./api/surveys.js";

const ROUTES = {
  "/api/login": login,
  "/api/logout": logout,
  "/api/session": session,
  "/api/schedule": schedule,
  "/api/media": media,
  "/api/survey": survey,
  "/api/reviews": reviews,
  "/api/survey-links": surveyLinks,
  "/api/admin/surveys": adminSurveys,
  "/api/admin/responses": adminResponses,
};

// "GET" -> "onRequestGet", "PUT" -> "onRequestPut", ...
function handlerName(method) {
  return "onRequest" + method.charAt(0) + method.slice(1).toLowerCase();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const route = ROUTES[url.pathname];

    if (route) {
      const handler = route[handlerName(request.method)];
      if (!handler) {
        return new Response("Method not allowed", { status: 405 });
      }
      try {
        return await handler({ request, env, ctx });
      } catch (err) {
        console.error(err);
        return new Response(JSON.stringify({ error: "Something went wrong. Try again." }), {
          status: 500,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      }
    }

    // Uploaded event flyers
    const m = url.pathname.match(media.MEDIA_PATH);
    if (m && (request.method === "GET" || request.method === "HEAD")) {
      return media.serveMedia(request, env, m[1]);
    }

    // Anything else: let Cloudflare serve the file (or its 404).
    return env.ASSETS.fetch(request);
  },
};
