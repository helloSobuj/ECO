# Eco — Personal Voice Agent

A personal voice assistant: talk to it, it talks back, it can search the
web, control a browser, and read your screen. Cloud APIs only — nothing
to self-host.

Current status: **Phase 5 — real-time orchestration.** The whole voice
loop now runs on LiveKit Agents instead of a custom REST/WebSocket
pipeline: continuous VAD-based turn detection, session-scoped
conversation memory, and push-to-talk gating, all over one live WebRTC
connection.

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
```

## Roadmap

- **Phase 6** — deploy somewhere the agent worker can run as a
  persistent process (Railway, Fly, a VPS — not a cold-start serverless
  platform like Vercel, since both the browser-session/confirmation
  state in `lib/browser.ts` and the screen-frame state in `agent/screen.ts`
  live in that process's memory), plus the Next.js app alongside it,
  with keys kept server-side throughout.

Later on, this Next.js app is a reasonable base to wrap in Electron (or
similar) for a desktop build without a rewrite.
