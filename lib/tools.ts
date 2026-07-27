import { webSearch } from "./tavily";
import {
  browserOpen,
  browserClick,
  browserType,
  browserExtract,
  browserConfirm,
  browserClose,
} from "./browser";

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

  browser_open: {
    schema: {
      type: "function",
      function: {
        name: "browser_open",
        description:
          "Open a URL in a real, controllable web browser. Use this before " +
          "clicking, typing, or extracting anything from a page.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "The URL to open." },
          },
          required: ["url"],
        },
      },
    },
    execute: async (args) => browserOpen(String(args.url ?? "")),
  },

  browser_click: {
    schema: {
      type: "function",
      function: {
        name: "browser_click",
        description:
          "Click a button, link, or element on the currently open page, " +
          "identified by its visible text or a short description. Set " +
          "sensitive=true if clicking this would submit a form, complete " +
          "a purchase, send a message, or take another consequential or " +
          "irreversible action — the user will be asked to confirm before " +
          "it actually happens.",
        parameters: {
          type: "object",
          properties: {
            description: {
              type: "string",
              description: "Visible text or description of the element.",
            },
            sensitive: {
              type: "boolean",
              description:
                "True if this click submits/buys/sends something.",
            },
          },
          required: ["description"],
        },
      },
    },
    execute: async (args) =>
      browserClick({
        description: String(args.description ?? ""),
        sensitive: Boolean(args.sensitive),
      }),
  },

  browser_type: {
    schema: {
      type: "function",
      function: {
        name: "browser_type",
        description:
          "Type text into an input or textarea on the currently open " +
          "page, identified by its label, placeholder, or nearby text. " +
          "Set sensitive=true if this alone would immediately trigger a " +
          "consequential action (rare — usually only browser_click needs it).",
        parameters: {
          type: "object",
          properties: {
            description: {
              type: "string",
              description: "Label/placeholder/description of the field.",
            },
            text: { type: "string", description: "The text to type." },
            sensitive: { type: "boolean" },
          },
          required: ["description", "text"],
        },
      },
    },
    execute: async (args) =>
      browserType({
        description: String(args.description ?? ""),
        text: String(args.text ?? ""),
        sensitive: Boolean(args.sensitive),
      }),
  },

  browser_extract: {
    schema: {
      type: "function",
      function: {
        name: "browser_extract",
        description: "Get the visible text content of the currently open page.",
        parameters: { type: "object", properties: {} },
      },
    },
    execute: async () => browserExtract(),
  },

  browser_confirm: {
    schema: {
      type: "function",
      function: {
        name: "browser_confirm",
        description:
          "Resolve a pending sensitive browser action after asking the " +
          "user out loud and hearing their actual answer. Only call this " +
          "in direct response to the user's reply — never preemptively, " +
          "and never assume the answer is yes.",
        parameters: {
          type: "object",
          properties: { confirmed: { type: "boolean" } },
          required: ["confirmed"],
        },
      },
    },
    execute: async (args) => browserConfirm(Boolean(args.confirmed)),
  },

  browser_close: {
    schema: {
      type: "function",
      function: {
        name: "browser_close",
        description: "Close the current browser session when you're done with it.",
        parameters: { type: "object", properties: {} },
      },
    },
    execute: async () => browserClose(),
  },
};

export const toolSchemas = Object.values(tools).map((t) => t.schema);
