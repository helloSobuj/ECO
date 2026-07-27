export type ChatRole = "user" | "assistant";

// A user message's content is normally just spoken text, but while screen
// sharing is active a data-URL screenshot rides along as an extra part
// (OpenAI-compatible multimodal content) so the model can see the screen.
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: ChatRole;
  content: string | ContentPart[];
}

// Internal, server-side message shape used while talking to OpenRouter,
// which extends the client-facing ChatMessage with system/tool turns and
// assistant tool-call requests (OpenAI-compatible function calling).
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
