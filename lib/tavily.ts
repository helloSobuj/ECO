// Server-side only. Calls Tavily's search API and formats the results as a
// short block of text suitable for feeding back to the LLM as a tool result.
export async function webSearch(query: string): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return "Web search is not configured (missing TAVILY_API_KEY).";
  }
  if (!query || !query.trim()) {
    return "No search query provided.";
  }

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "basic",
      max_results: 5,
      include_answer: true,
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return `Web search failed: ${detail}`;
  }

  const data = (await res.json()) as {
    answer?: string;
    results?: { title: string; url: string; content: string }[];
  };

  const parts: string[] = [];
  if (data.answer) parts.push(`Summary: ${data.answer}`);
  for (const r of data.results ?? []) {
    parts.push(`- ${r.title} (${r.url}): ${r.content}`);
  }
  return parts.length ? parts.join("\n") : "No results found.";
}
