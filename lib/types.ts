export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
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
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}
