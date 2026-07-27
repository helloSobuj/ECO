import { NextResponse } from "next/server";

// Mints a short-lived Deepgram access token so the browser can open a
// streaming STT websocket directly, without ever seeing the permanent
// DEEPGRAM_API_KEY.
export async function POST() {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "DEEPGRAM_API_KEY is not configured on the server" },
      { status: 500 }
    );
  }

  const res = await fetch("https://api.deepgram.com/v1/auth/grant-token", {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ttl_seconds: 1800 }),
  });

  if (!res.ok) {
    const detail = await res.text();
    return NextResponse.json(
      { error: "Failed to mint Deepgram token", detail },
      { status: 502 }
    );
  }

  const data = await res.json();
  return NextResponse.json(data);
}
