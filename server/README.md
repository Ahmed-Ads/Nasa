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
- Calls an OpenAI-compatible chat endpoint. The API key stays in the Worker
  environment; it is never sent to the browser or committed to this repository.

## Deploy

1. Install Wrangler and log in:
   ```bash
   npm install -g wrangler
   wrangler login
   ```
2. Set secrets (do not put these in the repo):
   ```bash
   wrangler secret put OPENAI_API_KEY
   # optional:
   wrangler secret put OPENAI_MODEL      # default: gpt-4o-mini
   wrangler secret put OPENAI_BASE_URL   # default: https://api.openai.com/v1/chat/completions
   ```
3. Deploy from this `server/` folder:
   ```bash
   wrangler deploy worker.js --name jamt-buddy
   ```
4. Copy the `https://…workers.dev` URL into the single client constant
   `BUDDY_PROXY_URL` near the top of `game.js`, then bump the `?v=` cache tag.

## CORS / custom domain

Edit `ALLOWED_ORIGINS` in `worker.js`. Keep it narrow. Add your custom Pages
origin if you use one; remove the localhost entries before a public launch.

## Data sent when the toggle is ON

Only: the player's question, selected language, a short state summary (level,
day, phase, open objective labels), and the last 4 turns. No name, account,
device ID, analytics, or browsing data. The game sends nothing when the toggle
is OFF or when `BUDDY_PROXY_URL` is empty.
