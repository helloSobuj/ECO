import { config } from "dotenv";
config({ path: ".env.local" });

import { fileURLToPath } from "node:url";
import {
  Agent,
  AgentSession,
  AgentSessionEventTypes,
  cli,
  createImageContent,
  defineAgent,
  WorkerOptions,
  type ChatContext,
  type ChatMessage,
  type ConversationItemAddedEvent,
  type JobContext,
  type UserInputTranscribedEvent,
} from "@livekit/agents";
import * as deepgram from "@livekit/agents-plugin-deepgram";
import * as elevenlabs from "@livekit/agents-plugin-elevenlabs";
import * as openai from "@livekit/agents-plugin-openai";
import { ecoTools } from "../lib/tools";
import { getLatestScreenFrame, watchForScreenShare } from "./screen";

const INSTRUCTIONS =
  "You are Eco, a helpful personal voice assistant. Keep replies short, " +
  "conversational, and spoken-language friendly — you're heard, not read, " +
  "so avoid markdown, bullet lists, or long paragraphs. When you use the " +
  "web_search tool, summarize what you found conversationally instead of " +
  "reading out URLs. You can also control a real web browser with " +
  "browser_open/browser_click/browser_type/browser_extract. Always set " +
  "sensitive=true on a browser_click or browser_type call that would " +
  "submit a form, complete a purchase, send a message, or otherwise take " +
  "a consequential or irreversible action. When a tool tells you an " +
  "action needs confirmation, stop and ask the user out loud in your " +
  "reply — do not call browser_confirm until a later turn where the user " +
  "has actually answered, and never assume or fabricate their answer. " +
  "When the user is sharing their screen, a live screenshot rides along " +
  "with their message automatically — look at it and describe " +
  "specifically what you see rather than guessing, if it's relevant to " +
  "what they asked.";

// Attaches the current screen-share frame (if any) to each finished user
// turn, so vision follows the same natural per-turn flow as Phase 4 did —
// just sourced from a live LiveKit video track instead of an uploaded
// screenshot. See agent/screen.ts for how the frame gets kept fresh.
class EcoAgent extends Agent {
  async onUserTurnCompleted(
    _chatCtx: ChatContext,
    newMessage: ChatMessage
  ): Promise<void> {
    const frame = getLatestScreenFrame();
    if (frame) {
      newMessage.content.push(createImageContent({ image: frame }));
    }
  }
}

type TranscriptEvent = {
  role: "user" | "assistant";
  text: string;
  final: boolean;
};

function publishTranscript(ctx: JobContext, event: TranscriptEvent) {
  ctx.room.localParticipant
    ?.sendText(JSON.stringify(event), { topic: "eco.transcript" })
    .catch((err) => console.error("Failed to publish transcript:", err));
}

async function entry(ctx: JobContext): Promise<void> {
  await ctx.connect();
  watchForScreenShare(ctx.room);
  await ctx.waitForParticipant();

  const session = new AgentSession({
    stt: new deepgram.STT({ apiKey: process.env.DEEPGRAM_API_KEY }),
    llm: new openai.LLM({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      model: process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5",
    }),
    tts: new elevenlabs.TTS({
      apiKey: process.env.ELEVENLABS_API_KEY,
      voiceId: process.env.ELEVENLABS_VOICE_ID,
    }),
    // vad omitted — AgentSession auto-provisions bundled Silero VAD, which
    // also drives automatic end-of-turn detection so we never stream or
    // react to silence.
  });

  session.on(AgentSessionEventTypes.UserInputTranscribed, (ev: UserInputTranscribedEvent) => {
    publishTranscript(ctx, {
      role: "user",
      text: ev.transcript,
      final: ev.isFinal,
    });
  });

  session.on(AgentSessionEventTypes.ConversationItemAdded, (ev: ConversationItemAddedEvent) => {
    if (ev.item.type !== "message" || ev.item.role !== "assistant") return;
    const text = ev.item.content
      .filter((part): part is string => typeof part === "string")
      .join(" ")
      .trim();
    if (!text) return;
    publishTranscript(ctx, { role: "assistant", text, final: true });
  });

  await session.start({
    agent: new EcoAgent({ instructions: INSTRUCTIONS, tools: ecoTools }),
    room: ctx.room,
  });

  session.say("Hey, I'm listening.", { allowInterruptions: true });
}

export default defineAgent({ entry });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
}
