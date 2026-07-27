"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";
import type { ChatMessage } from "@/lib/types";

type Status =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "reconnecting"
  | "error";

type TranscriptEvent = { role: "user" | "assistant"; text: string; final: boolean };

const AGENT_STATE_TO_STATUS: Record<string, Status> = {
  listening: "listening",
  thinking: "thinking",
  speaking: "speaking",
  initializing: "connecting",
  idle: "idle",
};

export default function VoiceAgent() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [interimText, setInterimText] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [screenSharing, setScreenSharing] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const audioContainerRef = useRef<HTMLDivElement | null>(null);

  const findAgent = useCallback((room: Room): RemoteParticipant | undefined => {
    for (const p of room.remoteParticipants.values()) return p;
    return undefined;
  }, []);

  const applyAgentState = useCallback((participant: RemoteParticipant) => {
    const state = participant.attributes["lk.agent.state"];
    if (state && AGENT_STATE_TO_STATUS[state]) {
      setStatus((prev) => (prev === "error" ? prev : AGENT_STATE_TO_STATUS[state]));
    }
  }, []);

  const connect = useCallback(async (): Promise<Room> => {
    if (roomRef.current) return roomRef.current;

    setError(null);
    setStatus("connecting");

    const res = await fetch("/api/livekit-token", { method: "POST" });
    if (!res.ok) throw new Error("Could not get a connection token");
    const { token, url } = await res.json();

    const room = new Room();
    roomRef.current = room;

    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach();
        audioContainerRef.current?.appendChild(el);
      }
    });

    room.on(
      RoomEvent.TrackUnsubscribed,
      (track: RemoteTrack, _pub: RemoteTrackPublication) => {
        track.detach().forEach((el) => el.remove());
      }
    );

    room.on(RoomEvent.ParticipantConnected, applyAgentState);
    room.on(RoomEvent.ParticipantAttributesChanged, (_attrs, participant) => {
      applyAgentState(participant as RemoteParticipant);
    });

    room.on(RoomEvent.Reconnecting, () => setStatus("reconnecting"));
    room.on(RoomEvent.Reconnected, () => {
      const agent = findAgent(room);
      if (agent) applyAgentState(agent);
      else setStatus("idle");
    });
    room.on(RoomEvent.Disconnected, () => {
      roomRef.current = null;
      setMicEnabled(false);
      setStatus("idle");
    });

    room.registerTextStreamHandler("eco.transcript", async (reader) => {
      const raw = await reader.readAll();
      let event: TranscriptEvent;
      try {
        event = JSON.parse(raw);
      } catch {
        return;
      }

      if (event.role === "user") {
        if (event.final) {
          setInterimText("");
          setMessages((prev) => [...prev, { role: "user", content: event.text }]);
          // Mirrors the old push-to-talk flow: one utterance per tap, then
          // wait for the reply before the mic can be tapped on again.
          void room.localParticipant.setMicrophoneEnabled(false);
          setMicEnabled(false);
        } else {
          setInterimText(event.text);
        }
      } else if (event.final) {
        setMessages((prev) => [...prev, { role: "assistant", content: event.text }]);
      }
    });

    await room.connect(url, token);
    const agent = findAgent(room);
    if (agent) applyAgentState(agent);
    else setStatus("idle");

    return room;
  }, [applyAgentState, findAgent]);

  const toggleMic = useCallback(async () => {
    try {
      const room = await connect();
      const next = !micEnabled;
      await room.localParticipant.setMicrophoneEnabled(next);
      setMicEnabled(next);
      if (next) {
        setInterimText("");
        setStatus("listening");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not access the microphone");
      setStatus("error");
    }
  }, [connect, micEnabled]);

  const toggleScreenShare = useCallback(async () => {
    try {
      const room = await connect();
      const next = !screenSharing;
      await room.localParticipant.setScreenShareEnabled(next);
      setScreenSharing(next);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not start screen sharing"
      );
    }
  }, [connect, screenSharing]);

  useEffect(() => {
    return () => {
      roomRef.current?.disconnect();
      roomRef.current = null;
    };
  }, []);

  const statusLabel: Record<Status, string> = {
    idle: "Tap to talk",
    connecting: "Connecting…",
    listening: "Listening… tap to stop",
    thinking: "Thinking…",
    speaking: "Speaking…",
    reconnecting: "Reconnecting…",
    error: "Something went wrong — tap to retry",
  };

  return (
    <>
      <div className="conversation">
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.content}
          </div>
        ))}
        {interimText && <div className="bubble user interim">{interimText}</div>}
      </div>

      <div className="controls">
        <button
          className={`mic-button ${micEnabled ? "recording" : ""}`}
          onClick={() => void toggleMic()}
          disabled={status === "connecting" || status === "thinking" || status === "speaking"}
          aria-label={statusLabel[status]}
        >
          {micEnabled ? "■" : "●"}
        </button>
        <div className="status">{statusLabel[status]}</div>
        <button
          className={`screen-share-button ${screenSharing ? "active" : ""}`}
          onClick={() => void toggleScreenShare()}
        >
          {screenSharing ? "Stop screen sharing" : "Share screen"}
        </button>
        {error && <div className="error">{error}</div>}
      </div>

      {/* Hidden container for the agent's playable audio elements. */}
      <div ref={audioContainerRef} style={{ display: "none" }} />
    </>
  );
}
