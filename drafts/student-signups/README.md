# Draft: student sign-ups (paused)

Started, not finished, and **not live**. Nothing in this folder is deployed:
only `src/worker.js` (and what it imports) runs on Cloudflare.

The idea: students sign up for classes on the site with their name and phone
(a texted code the first time, via Twilio Verify, ~$2–3/month), see whether
they're signed up, and see a simple history. Spots left would count down
automatically.

Open question before continuing: is Sam's Square link where students
**sign up** (then this isn't needed) or only where they **pay** (then this
would handle sign-ups and history, followed by a "Pay with Square" button)?

What's here so far:
- `migrations/0001_signups.sql`: students + bookings tables (Cloudflare D1)
- `functions/_lib/studio.js`: studio clock (Central time), phone numbers,
  student login cookie, Twilio codes (with a fake 123456 mode on localhost)
- `functions/api/auth/*`: text a code, check it and sign in, sign out
- `wrangler-d1-snippet.toml`: database settings to add to `wrangler.toml`

Still to build: booking/cancel endpoints, sign-up and "My classes" pages,
Sam's sign-up list on the edit page, Square link field.

To resume: move the files into `src/`, route the new `/api/auth/*` paths in
`src/worker.js`, add the database snippet to `wrangler.toml`, and continue.
