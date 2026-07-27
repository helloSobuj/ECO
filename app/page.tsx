import VoiceAgent from "@/components/VoiceAgent";

export default function Home() {
  return (
    <main>
      <h1>Eco</h1>
      <p className="status">
        Phase 5 — real-time orchestration. Tap the mic, speak, and Eco
        replies back in voice — with web search, browser control, and
        screen reading, all over a live LiveKit connection.
      </p>
      <VoiceAgent />
    </main>
  );
}
