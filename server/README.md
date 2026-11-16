# Buddy cloud helper (optional)

The game is fully playable with the scripted, offline brain. This Worker is only
used when the player turns on **Settings → Let Buddy ask the cloud helper**.

## What it does

- Accepts `POST /` with `{ question, language, state, history }`.
- Checks the `Origin` against the allowlist in `worker.js`
  (`https://ahmed-ads.github.io` plus localhost for development).
- Caps the question at 300 characters and the answer at 150 output tokens.
- Applies a simple in-memory per-IP rate limit (12 requests/minute).
- Never logs questions or answers.
- Calls Gemini through Google's OpenAI-compatible endpoint. The Gemini API key
  stays in the Worker environment; it is never sent to the browser or committed
  to this repository.

## Deploy

1. Install Wrangler and log in:
   ```bash
   npm install -g wrangler
   wrangler login
   ```
2. Set the secret. Use the exact name **`GEMINI_API_KEY`**:
   ```bash
   wrangler secret put GEMINI_API_KEY
   # optional overrides:
   wrangler secret put GEMINI_MODEL      # default: gemini-3.5-flash-lite
   wrangler secret put GEMINI_BASE_URL   # default: Gemini OpenAI-compatible endpoint
   ```
   The Worker also accepts `GEMENI_API_KEY` as a temporary migration fallback
   for the common misspelling. Rename it to `GEMINI_API_KEY` when convenient.

3. Deploy from this `server/` folder:
   ```bash
   wrangler deploy worker.js --name jamt-buddy
   ```

   If you created the Worker in the Cloudflare dashboard instead, paste the
   contents of `worker.js` into the Worker editor, add an encrypted secret named
   `GEMINI_API_KEY`, and deploy.

4. Copy the `https://<name>.<account>.workers.dev` URL into the single client
   constant `BUDDY_PROXY_URL` near the top of `game.js`. Bump the `?v=` cache
   tag on the changed script. Do not put the Gemini key in `game.js`.

## Test it

CORS is checked against the browser `Origin`, so include it when testing with
`curl`. Test the game from GitHub Pages or a local HTTP server (`localhost:8000`
or `localhost:8765` are allowlisted), not from a `file://` URL:

```bash
curl -i https://jamt-buddy.<account>.workers.dev/ \
  -H "Origin: https://ahmed-ads.github.io" \
  -H "content-type: application/json" \
  -d '{"question":"How do I get more air?","language":"en","state":{"level":"1.1","day":1}}'
```

A healthy response is HTTP 200 with `{"answer":"..."}`. For a browser smoke test,
open the deployed game, go to **Settings**, turn on **Let Buddy ask the cloud
helper**, and ask Buddy a question.

Expected errors:

| Response | Meaning |
| --- | --- |
| `403 {"error":"origin"}` | The page origin is not in `ALLOWED_ORIGINS`. |
| `503 {"error":"unavailable"}` | `GEMINI_API_KEY` is missing from the Worker. |
| `502 {"error":"upstream"}` | The key, model, or Gemini endpoint was rejected. |
| `429 {"error":"rate"}` | More than 12 requests/minute from that IP. |

## CORS / custom domain

Edit `ALLOWED_ORIGINS` in `worker.js`. Keep it narrow. Add your custom Pages
origin if you use one; remove the localhost entries before a public launch.

## Data sent when the toggle is ON

Only: the player's question, selected language, a short state summary (level,
day, phase, open objective labels), and the last 4 turns. No name, account,
device ID, analytics, or browsing data. The game sends nothing when the toggle
is OFF or when `BUDDY_PROXY_URL` is empty.
