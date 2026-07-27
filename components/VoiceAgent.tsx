"use client";

import { useCallback, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/types";

type Status = "idle" | "recording" | "thinking" | "speaking" | "error";

export default function VoiceAgent() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [interimText, setInterimText] = useState("");
  const [liveReply, setLiveReply] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const finalTranscriptRef = useRef("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const cleanupRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    finalTranscriptRef.current = "";
    setInterimText("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      streamRef.current = stream;

      const tokenRes = await fetch("/api/stt-token", { method: "POST" });
      if (!tokenRes.ok) throw new Error("Could not get a speech-to-text token");
      const { access_token } = await tokenRes.json();

      const ws = new WebSocket(
        "wss://api.deepgram.com/v1/listen?smart_format=true&interim_results=true",
        ["token", access_token]
      );
      wsRef.current = ws;

      ws.onopen = () => {
        const recorder = new MediaRecorder(stream, {
          mimeType: "audio/webm;codecs=opus",
        });
        mediaRecorderRef.current = recorder;
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
            ws.send(e.data);
          }
        };
        recorder.start(250);
        setStatus("recording");
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const alt = data?.channel?.alternatives?.[0];
          const transcript: string | undefined = alt?.transcript;
          if (!transcript) return;

          if (data.is_final) {
            finalTranscriptRef.current =
              `${finalTranscriptRef.current} ${transcript}`.trim();
            setInterimText("");
          } else {
            setInterimText(transcript);
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onerror = () => {
        setError("Speech-to-text connection failed.");
        setStatus("error");
      };
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not start the microphone"
      );
      setStatus("error");
      cleanupRecording();
    }
  }, [cleanupRecording]);

  const speak = useCallback(async (text: string) => {
    setStatus("speaking");
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error("Text-to-speech request failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (!audioRef.current) audioRef.current = new Audio();
      audioRef.current.src = url;
      audioRef.current.onended = () => {
        URL.revokeObjectURL(url);
        setStatus("idle");
      };
      await audioRef.current.play();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not play audio");
      setStatus("error");
    }
  }, []);

  const sendToAgent = useCallback(
    async (history: ChatMessage[]) => {
      setStatus("thinking");
      setLiveReply("");

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history }),
        });
        if (!res.ok || !res.body) throw new Error("The agent didn't respond");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let assistantText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const payload = trimmed.slice("data:".length).trim();
            if (payload === "[DONE]") continue;
            try {
              const json = JSON.parse(payload);
              const delta: string | undefined =
                json?.choices?.[0]?.delta?.content;
              if (delta) {
                assistantText += delta;
                setLiveReply(assistantText);
              }
            } catch {
              // ignore partial/non-JSON keep-alive lines
            }
          }
        }

        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: assistantText },
        ]);
        setLiveReply("");

        if (assistantText.trim()) {
          await speak(assistantText);
        } else {
          setStatus("idle");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Chat request failed");
        setStatus("error");
      }
    },
    [speak]
  );

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    const ws = wsRef.current;

    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = () => {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "CloseStream" }));
        }
        ws?.close();

        const text = finalTranscriptRef.current.trim();
        if (text) {
          const updated: ChatMessage[] = [
            ...messages,
            { role: "user", content: text },
          ];
          setMessages(updated);
          void sendToAgent(updated);
        } else {
          setStatus("idle");
        }
      };
      recorder.stop();
    } else {
      cleanupRecording();
      setStatus("idle");
    }
  }, [cleanupRecording, messages, sendToAgent]);

  const toggleRecording = useCallback(() => {
    if (status === "recording") {
      stopRecording();
    } else if (status === "idle" || status === "error") {
      void startRecording();
    }
  }, [status, startRecording, stopRecording]);

  const statusLabel: Record<Status, string> = {
    idle: "Tap to talk",
    recording: "Listening… tap to stop",
    thinking: "Thinking…",
    speaking: "Speaking…",
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
        {interimText && (
          <div className="bubble user interim">{interimText}</div>
        )}
        {liveReply && <div className="bubble assistant">{liveReply}</div>}
      </div>

      <div className="controls">
        <button
          className={`mic-button ${status === "recording" ? "recording" : ""}`}
          onClick={toggleRecording}
          disabled={status === "thinking" || status === "speaking"}
          aria-label={statusLabel[status]}
        >
          {status === "recording" ? "■" : "●"}
        </button>
        <div className="status">{statusLabel[status]}</div>
        {error && <div className="error">{error}</div>}
      </div>
    </>
  );
}
