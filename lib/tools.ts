import { webSearch } from "./tavily";

// A single place to register LLM-callable tools. Each entry pairs the
// OpenAI-compatible function schema (sent to the model) with the executor
// that actually runs it server-side. Add new tools (browser control,
// calendar, etc.) here without touching the chat loop itself.
interface ToolDefinition {
  schema: {
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  };
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export const tools: Record<string, ToolDefinition> = {
  web_search: {
    schema: {
      type: "function",
      function: {
        name: "web_search",
        description:
          "Search the live web for current information — news, prices, " +
          "facts you don't already know, anything time-sensitive. Returns " +
          "a short list of results with titles, URLs, and snippets.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query.",
            },
          },
          required: ["query"],
        },
      },
    },
    execute: async (args) => webSearch(String(args.query ?? "")),
  },
};

export const toolSchemas = Object.values(tools).map((t) => t.schema);
