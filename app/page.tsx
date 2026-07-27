import VoiceAgent from "@/components/VoiceAgent";

export default function Home() {
  return (
    <main>
      <h1>Eco</h1>
      <p className="status">
        Phase 1 — core voice loop. Tap the mic, speak, and Eco replies back
        in voice. No tools yet.
      </p>
      <VoiceAgent />
    </main>
  );
}
