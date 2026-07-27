import { NextRequest, NextResponse } from "next/server";
import type { ChatMessage } from "@/lib/types";

const SYSTEM_PROMPT =
  "You are Eco, a helpful personal voice assistant. Keep replies short, " +
  "conversational, and spoken-language friendly — you are being read aloud " +
  "by a text-to-speech engine, so avoid markdown, bullet lists, or long " +
  "paragraphs.";

// Proxies chat completions to Claude via OpenRouter, streaming the raw SSE
// response straight through. OPENROUTER_API_KEY never reaches the client.
export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY is not configured on the server" },
      { status: 500 }
    );
  }

  const { messages } = (await req.json()) as { messages: ChatMessage[] };

  const upstream = await fetch(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5",
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
        stream: true,
      }),
    }
  );

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text();
    return NextResponse.json(
      { error: "LLM request failed", detail },
      { status: 502 }
    );
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
