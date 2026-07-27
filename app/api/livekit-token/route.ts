import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";

// Mints a short-lived LiveKit room-join token so the browser can connect
// directly to LiveKit over WebRTC. LIVEKIT_API_KEY/SECRET never reach the
// client — only the resulting signed JWT and the (non-secret) server URL do.
export async function POST() {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.LIVEKIT_URL;
  if (!apiKey || !apiSecret || !url) {
    return NextResponse.json(
      {
        error:
          "LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_URL are not configured on the server",
      },
      { status: 500 }
    );
  }

  const roomName = process.env.LIVEKIT_ROOM_NAME || "eco";
  const identity = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    ttl: "30m",
  });
  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return NextResponse.json({
    token: await token.toJwt(),
    url,
    roomName,
  });
}
