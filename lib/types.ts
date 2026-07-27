export type ChatRole = "user" | "assistant";

// Frontend transcript state only. As of Phase 5 the actual conversation
// (including tool calls, images, system prompt) lives entirely in the
// LiveKit AgentSession's ChatContext on the agent worker — the browser
// just renders a running transcript it's told about over a data channel.
export interface ChatMessage {
  role: ChatRole;
  content: string;
}
