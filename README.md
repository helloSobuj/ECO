# Eco — Personal Voice Agent

A personal voice assistant: talk to it, it talks back, and (in later
phases) it can search the web, control a browser, and read your screen.
Cloud APIs only — nothing to self-host.

Current status: **Phase 3 — browser control.** Mic → streaming
speech-to-text (Deepgram) → LLM reply (Claude via OpenRouter, now able to
search the web and drive a real browser) → text-to-speech (ElevenLabs) →
playback.

## Architecture

```
Browser (mic + speaker)
  → Deepgram streaming STT   (via a short-lived token minted by the server)
  → /api/chat  → OpenRouter (Claude) ⇄ web_search tool  → Tavily     [server-side keys]
                                      ⇄ browser_* tools → Steel.dev
  → /api/tts   → ElevenLabs                                          [server-side key]
```

All API keys live only in server-side route handlers
(`app/api/*/route.ts`) and `lib/`. The browser never sees
`OPENROUTER_API_KEY`, `ELEVENLABS_API_KEY`, `TAVILY_API_KEY`, or
`STEEL_API_KEY`; for Deepgram it only ever receives a short-lived
(30 min) access token minted by `/api/stt-token`, not the real key.

When the model decides it needs current information, it calls the
`web_search` tool; `/api/chat` executes the search against Tavily
server-side, feeds the results back to the model, and only then streams
the final spoken answer to the client. New tools register in
`lib/tools.ts` without touching the chat loop itself.

### Browser control and the confirmation gate

`lib/browser.ts` opens a real, remote browser session via Steel.dev and
drives it with Playwright over CDP, exposing `browser_open`,
`browser_click`, `browser_type`, and `browser_extract` as tools. Per the
plan's safety rule, any click or type the model marks `sensitive: true`
(submitting a form, buying something, sending a message, or another
consequential/irreversible action) doesn't execute immediately — it's
parked as a pending action, and the tool result instructs the model to
ask the user out loud and wait. Only a later `browser_confirm` call
(which the system prompt tells the model to make only after the user has
actually answered) runs it.

The active browser session and the one pending confirmation are held in
server memory, matching this project's scope (one personal assistant,
one user, one browsing task at a time). That means they only survive
while the Node process stays warm — fine on a persistent host (Railway,
Fly, a VPS), but **not** on a cold-start serverless platform like Vercel.
If Phase 6 deploys there, this needs a real store (e.g. Redis) instead.

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Copy the env template and fill in real keys:
   ```
   cp .env.example .env.local
   ```
   You'll need:
   - `DEEPGRAM_API_KEY` — [console.deepgram.com](https://console.deepgram.com)
   - `OPENROUTER_API_KEY` — [openrouter.ai/keys](https://openrouter.ai/keys)
   - `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` — [elevenlabs.io](https://elevenlabs.io)
   - `TAVILY_API_KEY` — [tavily.com](https://tavily.com)
   - `STEEL_API_KEY` — [steel.dev](https://steel.dev)

   `.env.local` is gitignored — real keys never get committed.
3. Run the dev server:
   ```
   npm run dev
   ```
4. Open http://localhost:3000, allow microphone access, tap the mic
   button, and talk.

## Project layout

```
app/
  page.tsx                 main UI
  api/stt-token/route.ts   mints short-lived Deepgram tokens
  api/chat/route.ts        proxies chat completions to OpenRouter, runs
                            tool calls server-side, streams the final answer
  api/tts/route.ts         proxies text-to-speech to ElevenLabs (streamed)
components/
  VoiceAgent.tsx           mic capture, STT socket, chat + TTS orchestration
lib/
  types.ts                 shared types
  tools.ts                 tool registry (schemas + executors) for the LLM
  tavily.ts                web_search tool implementation (Tavily API)
  browser.ts               browser_* tools (Steel.dev + Playwright/CDP),
                            including the sensitive-action confirmation gate
```

## Roadmap

See the phases below — each is a separate round of work on top of this
skeleton, without rewriting the core loop:

- **Phase 4** — screen reading via Claude's vision input
- **Phase 5** — move orchestration to LiveKit Agents, add voice activity
  detection, conversation memory, and a wake word / push-to-talk trigger
- **Phase 6** — deploy the client (e.g. Vercel) with keys kept server-side

Later on, this Next.js app is a reasonable base to wrap in Electron (or
similar) for a desktop build without a rewrite.
