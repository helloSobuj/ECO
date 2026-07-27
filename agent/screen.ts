import {
  Room,
  RoomEvent,
  TrackSource,
  VideoStream,
  type RemoteTrack,
  type RemoteTrackPublication,
  type VideoFrame,
} from "@livekit/rtc-node";

// Tracks the most recent frame of the user's shared screen, if any. There's
// only ever one personal-assistant conversation at a time in this project,
// so a single module-level "latest frame" is enough — see lib/browser.ts
// for the same reasoning applied to browser sessions.
let latestFrame: VideoFrame | null = null;

async function pumpFrames(stream: VideoStream) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      latestFrame = value.frame;
    }
  } finally {
    latestFrame = null;
  }
}

export function watchForScreenShare(room: Room): void {
  room.on(
    RoomEvent.TrackSubscribed,
    (track: RemoteTrack, publication: RemoteTrackPublication) => {
      if (publication.source !== TrackSource.SOURCE_SCREENSHARE) return;
      void pumpFrames(new VideoStream(track));
    }
  );

  room.on(
    RoomEvent.TrackUnsubscribed,
    (_track: RemoteTrack, publication: RemoteTrackPublication) => {
      if (publication.source === TrackSource.SOURCE_SCREENSHARE) {
        latestFrame = null;
      }
    }
  );
}

export function getLatestScreenFrame(): VideoFrame | null {
  return latestFrame;
}
