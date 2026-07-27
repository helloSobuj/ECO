import { NextRequest, NextResponse } from "next/server";

// Proxies text-to-speech requests to ElevenLabs, streaming the audio back.
// ELEVENLABS_API_KEY never reaches the client.
export async function POST(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) {
    return NextResponse.json(
      {
        error:
          "ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID are not configured on the server",
      },
      { status: 500 }
    );
  }

  const { text } = (await req.json()) as { text: string };
  if (!text || !text.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2_5",
      }),
    }
  );

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text();
    return NextResponse.json(
      { error: "TTS request failed", detail },
      { status: 502 }
    );
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
