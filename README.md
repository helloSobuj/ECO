# Eco — Personal Voice Agent

A personal voice assistant: talk to it, it talks back, it can search the
web, control a browser, and read your screen. Cloud APIs only — nothing
to self-host.

Current status: **Phase 6 — deployment.** The app is ready to run
somewhere other than your own machine: a `Dockerfile` and `fly.toml`
are included, and the deployment section below covers Railway, Fly,
a plain VPS, and putting the web app on Vercel.

## Architecture

```
Browser (mic + speaker + optional screen share)
  ⇅ WebRTC (LiveKit room, joined via a token from /api/livekit-token)

LiveKit Agent worker (agent/worker.ts — a separate, persistent process)
  Deepgram STT → OpenRouter (Claude) ⇄ web_search tool  → Tavily     [server-side keys]
              ↑ VAD (bundled)       ⇄ browser_* tools → Steel.dev
  ElevenLabs TTS  ←──────────────────────────────────────────────────
```

Two processes now make up the backend:

- **The Next.js app** (`npm run dev`) serves the UI and one route,
  `/api/livekit-token`, which mints a short-lived room-join token.
  `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` never reach the client — only
  the signed JWT and the (non-secret) LiveKit server URL do.
- **The LiveKit agent worker** (`npm run agent:dev`) is a persistent
  Node process that joins the room as a participant and runs the actual
  voice pipeline. `DEEPGRAM_API_KEY`, `OPENROUTER_API_KEY`,
  `ELEVENLABS_API_KEY`, `TAVILY_API_KEY`, and `STEEL_API_KEY` all live
  here — never in the browser, and not even in the Next.js server
  process anymore.

The browser talks to the worker only over the WebRTC media/data
connection; there's no more `/api/chat` or `/api/tts` REST round-trip.

### Voice activity detection & conversation memory

`AgentSession` auto-provisions a bundled Silero VAD when none is passed
explicitly, which is what decides when the user has started/stopped
talking — the agent never streams or reacts to silence. Conversation
history lives in the session's `ChatContext` for as long as the LiveKit
room connection is open, so context carries across turns without the
client resending the whole transcript on every request (Phase 1–4's
approach).

### Push-to-talk

The plan called for a wake word *or* push-to-talk; a wake word needs its
own model/dependency not in the provisioned API list, so this phase
keeps the tap-to-talk control from Phases 1–4, adapted to the new
transport: tapping the mic button calls `setMicrophoneEnabled(true)` on
the LiveKit local participant (not a fresh `getUserMedia` capture), and
the client automatically disables it again once the agent confirms the
user's utterance is final — mirroring the old one-tap-per-turn feel
while VAD (not the client) decides where the utterance actually ends.

### Tools carry over unchanged

`lib/tools.ts` is now the tool registry for the LiveKit agent (previously
for the old `/api/chat` loop) — same `web_search` and `browser_*` tools,
same safety-confirmation gate in `lib/browser.ts` for anything the model
marks `sensitive: true` (submit/buy/send), just registered with
LiveKit's `tool()` helper instead of a hand-rolled OpenAI-style schema.
Session and pending-confirmation state still live in server memory
(now the agent worker's memory), which only works on a persistent host —
see the Phase 6 note below.

### Screen reading

Vision still reuses the same Claude/OpenRouter key. Screen sharing is
now a real LiveKit video track (`setScreenShareEnabled`, published like
any other track) instead of a client-captured JPEG upload; the agent
worker subscribes to it (`agent/screen.ts`) and keeps the latest frame
on hand. `EcoAgent.onUserTurnCompleted` (`agent/worker.ts`) attaches
that frame to each finished user turn, so the model sees the screen
automatically whenever sharing is active — same behavior as Phase 4,
sourced from a live track instead of an upload.

## Setup

You need **two terminals** running concurrently for local dev.

1. Install dependencies:
   ```
   npm install
   ```
2. Copy the env template and fill in real keys:
   ```
   cp .env.example .env.local
   ```
   You'll need:
   - `LIVEKIT_API_KEY` + `LIVEKIT_API_SECRET` + `LIVEKIT_URL` — [cloud.livekit.io](https://cloud.livekit.io)
   - `DEEPGRAM_API_KEY` — [console.deepgram.com](https://console.deepgram.com)
   - `OPENROUTER_API_KEY` — [openrouter.ai/keys](https://openrouter.ai/keys)
   - `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` — [elevenlabs.io](https://elevenlabs.io)
   - `TAVILY_API_KEY` — [tavily.com](https://tavily.com)
   - `STEEL_API_KEY` — [steel.dev](https://steel.dev)

   `.env.local` is gitignored — real keys never get committed. The agent
   worker isn't a Next.js process, so it loads `.env.local` itself via
   `dotenv` (see the top of `agent/worker.ts`).
3. In one terminal, start the agent worker:
   ```
   npm run agent:dev
   ```
4. In another, start the web app:
   ```
   npm run dev
   ```
5. Open http://localhost:3000, tap the mic button, and talk. Click
   "Share screen" if you want Eco to see it.

## Project layout

```
app/
  page.tsx                     main UI
  api/livekit-token/route.ts   mints short-lived LiveKit room-join tokens
agent/
  worker.ts                    LiveKit agent entrypoint — EcoAgent,
                                AgentSession (STT/LLM/TTS wiring), transcript
                                events published back over a data channel
  screen.ts                    tracks the latest screen-share video frame
components/
  VoiceAgent.tsx                room connection, push-to-talk mic gating,
                                screen share, transcript + agent-state UI
lib/
  types.ts                      shared types
  tools.ts                      LiveKit tool() registry for the LLM
  tavily.ts                     web_search tool implementation (Tavily API)
  browser.ts                    browser_* tools (Steel.dev + Playwright/CDP),
                                including the sensitive-action confirmation gate
Dockerfile                      builds either process (web app or agent worker);
                                which one runs is picked by the start command
fly.toml                        Fly.io config — web + agent as process groups
```

## Deployment

Two pieces, two different hosting needs:

- **The Next.js web app** is stateless — fine on serverless (Vercel).
- **The agent worker must run as a persistent process.** `lib/browser.ts`
  (browser session + pending confirmation) and `agent/screen.ts` (latest
  screen frame) both hold state in server memory; a cold-start
  serverless platform would silently lose that state between requests.
  It needs Railway, Fly, or any VPS/box where the process just stays
  running.

### Env vars by service

- **Web app** only ever needs `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` /
  `LIVEKIT_URL` (to mint room-join tokens in `/api/livekit-token`).
- **Agent worker** needs everything in `.env.example` — those three
  LiveKit vars plus `DEEPGRAM_API_KEY`, `OPENROUTER_API_KEY`,
  `OPENROUTER_MODEL`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`,
  `TAVILY_API_KEY`, `STEEL_API_KEY`.

### Web app → Vercel

Import this repo into Vercel (zero-config — it auto-detects Next.js),
set the three `LIVEKIT_*` vars in the project settings, deploy. Don't
add any of the tool/model keys there; the web app never touches them.

### Agent worker → Railway

Create **two** services from this same repo (one project, so they're
easy to manage together):
1. Web service — build command `npm run build`, start command
   `npm run start`.
2. Worker service — start command `npm run agent:start`.

Set the full env var list on the worker service; the web service only
needs the `LIVEKIT_*` ones (skip this one if you're deploying the web
app to Vercel instead).

### Agent worker → Fly.io

`fly.toml` already defines both as process groups (`web` and `agent`)
built from the included `Dockerfile`:

```
fly launch   # review the generated app name/region; keep the existing fly.toml
fly secrets set LIVEKIT_API_KEY=... LIVEKIT_API_SECRET=... LIVEKIT_URL=... \
  DEEPGRAM_API_KEY=... OPENROUTER_API_KEY=... ELEVENLABS_API_KEY=... \
  ELEVENLABS_VOICE_ID=... TAVILY_API_KEY=... STEEL_API_KEY=...
fly deploy
```

Only `web` gets a public HTTP service; `agent` doesn't need one — it
only makes outbound connections to LiveKit and the tool APIs.

### Agent worker → a VPS you already run

```
docker build -t eco-voice-agent .
docker run -d --name eco-web   --env-file .env.local -p 3000:3000 eco-voice-agent
docker run -d --name eco-agent --env-file .env.local eco-voice-agent npm run agent:start
```

Or without Docker: `npm ci && npm run build`, then run `npm run start`
and `npm run agent:start` as two services under systemd or pm2 so they
restart on a crash or reboot.

## What's next

The plan's six phases are all built. From here it's really about using
it — and, per the plan, wrapping this Next.js app in Electron (or
similar) for a desktop build is a reasonable next step without a
rewrite, whenever that's wanted.
