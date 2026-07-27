# Eco — Personal Voice Agent

A personal voice assistant: talk to it, it talks back, and (in later
phases) it can search the web, control a browser, and read your screen.
Cloud APIs only — nothing to self-host.

Current status: **Phase 2 — web search tool.** Mic → streaming
speech-to-text (Deepgram) → LLM reply (Claude via OpenRouter, now able to
call a web search tool) → text-to-speech (ElevenLabs) → playback.

## Architecture

```
Browser (mic + speaker)
  → Deepgram streaming STT   (via a short-lived token minted by the server)
  → /api/chat  → OpenRouter (Claude) ⇄ web_search tool → Tavily   [server-side keys]
  → /api/tts   → ElevenLabs                                       [server-side key]
```

All API keys live only in server-side route handlers
(`app/api/*/route.ts`) and `lib/`. The browser never sees
`OPENROUTER_API_KEY`, `ELEVENLABS_API_KEY`, or `TAVILY_API_KEY`; for
Deepgram it only ever receives a short-lived (30 min) access token minted
by `/api/stt-token`, not the real key.

When the model decides it needs current information, it calls the
`web_search` tool; `/api/chat` executes the search against Tavily
server-side, feeds the results back to the model, and only then streams
the final spoken answer to the client. New tools register in
`lib/tools.ts` without touching the chat loop itself.

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
```

## Roadmap

See the phases below — each is a separate round of work on top of this
skeleton, without rewriting the core loop:

- **Phase 3** — browser control (Steel.dev), with a confirmation step
  before any action that submits, buys, or sends something
- **Phase 4** — screen reading via Claude's vision input
- **Phase 5** — move orchestration to LiveKit Agents, add voice activity
  detection, conversation memory, and a wake word / push-to-talk trigger
- **Phase 6** — deploy the client (e.g. Vercel) with keys kept server-side

Later on, this Next.js app is a reasonable base to wrap in Electron (or
similar) for a desktop build without a rewrite.
