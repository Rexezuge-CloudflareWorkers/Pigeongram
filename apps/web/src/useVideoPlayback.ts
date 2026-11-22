import { useRef, useState } from 'react';
import type { RefObject } from 'react';

/**
The bits of a media element that survive a remount: the player itself, the
position to come back to, and the one retry a transient failure earns.

The viewer remounts its `<video>` whenever the stream URL or the retry
counter changes (React cannot swap a media source in place), so the position
has to be remembered before the switch and restored on the new element —
otherwise switching quality restarts the clip at 0:00.
*/

interface PlaybackPoint {
  messageId: number;
  time: number;
  playing: boolean;
}

export interface VideoPlayback {
  playerRef: RefObject<HTMLVideoElement | null>;
  /**
  Part of the element key: bumping it rebuilds the player for a retry.
  */
  attempt: number;
  /**
  Remembers where the current player is, before its source changes.
  */
  remember: (messageId: number) => void;
  /**
  Applies the remembered position to a freshly mounted player of the same
  message, if there is one.
  */
  restore: (messageId: number | null) => void;
  /**
  Records a media error. Returns true when this source has already been
  retried, which is the caller's cue to settle on the fallback.
  */
  retry: (src: string) => boolean;
}

export function useVideoPlayback(): VideoPlayback {
  const playerRef = useRef<HTMLVideoElement | null>(null);
  const resumeRef = useRef<PlaybackPoint | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retriedSrc, setRetriedSrc] = useState<string | null>(null);

  return {
    playerRef,
    attempt,
    remember: (messageId: number): void => {
      const player = playerRef.current;
      if (!player) return;
      resumeRef.current = { messageId, time: player.currentTime, playing: !player.paused && !player.ended };
    },
    restore: (messageId: number | null): void => {
      const player = playerRef.current;
      const saved = resumeRef.current;
      if (!player || !saved || saved.messageId !== messageId) return;
      resumeRef.current = null;
      player.currentTime = Number.isFinite(player.duration) && player.duration > 0 ? Math.min(saved.time, player.duration) : saved.time;
      if (saved.playing) void player.play().catch(() => {});
    },
    retry: (src: string): boolean => {
      if (retriedSrc === src) return true;
      setRetriedSrc(src);
      setAttempt((value) => value + 1);
      return false;
    },
  };
}
