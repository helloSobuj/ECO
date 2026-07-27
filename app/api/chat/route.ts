import { NextRequest, NextResponse } from "next/server";
import type { ChatMessage, LlmMessage } from "@/lib/types";
import { tools, toolSchemas } from "@/lib/tools";

const SYSTEM_PROMPT =
  "You are Eco, a helpful personal voice assistant. Keep replies short, " +
  "conversational, and spoken-language friendly — you are being read aloud " +
  "by a text-to-speech engine, so avoid markdown, bullet lists, or long " +
  "paragraphs. When you use the web_search tool, summarize what you found " +
  "conversationally instead of reading out URLs.";

const MAX_TOOL_ROUNDS = 5;

function model() {
  return process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5";
}

async function callOpenRouter(apiKey: string, messages: LlmMessage[]) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model(),
      messages,
      tools: toolSchemas,
      stream: false,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`LLM request failed: ${detail}`);
  }

  const data = await res.json();
  const message = data.choices?.[0]?.message as LlmMessage | undefined;
  if (!message) throw new Error("Empty response from LLM");
  return message;
}

function sseChunk(content: string) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

// Proxies chat completions to Claude via OpenRouter and runs any tool calls
// the model requests (e.g. web_search) server-side, so tool API keys never
// reach the client. The final answer is simulate-streamed back as SSE in
// the same shape OpenRouter itself would send, so the frontend's parsing
// doesn't need to know whether a tool was used.
export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENROUTER_API_KEY is not configured on the server" },
      { status: 500 }
    );
  }

  const { messages } = (await req.json()) as { messages: ChatMessage[] };
  const history: LlmMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages,
  ];

  let finalText = "";
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const message = await callOpenRouter(apiKey, history);

      if (message.tool_calls?.length) {
        history.push(message);
        for (const call of message.tool_calls) {
          const tool = tools[call.function.name];
          let result: string;
          if (!tool) {
            result = `Unknown tool: ${call.function.name}`;
          } else {
            try {
              const args = call.function.arguments
                ? JSON.parse(call.function.arguments)
                : {};
              result = await tool.execute(args);
            } catch (err) {
              result = `Tool "${call.function.name}" failed: ${
                err instanceof Error ? err.message : String(err)
              }`;
            }
          }
          history.push({
            role: "tool",
            tool_call_id: call.id,
            content: result,
          });
        }
        continue;
      }

      finalText = message.content ?? "";
      break;
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Chat request failed" },
      { status: 502 }
    );
  }

  const encoder = new TextEncoder();
  const words = finalText.split(/(?<=\s)/);
  const stream = new ReadableStream({
    async start(controller) {
      for (const word of words) {
        controller.enqueue(encoder.encode(sseChunk(word)));
        await new Promise((r) => setTimeout(r, 15));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
