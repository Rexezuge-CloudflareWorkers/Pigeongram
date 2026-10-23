import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ringtone } from '../calls/ringtone';
import type { CallView } from '../calls/session';
import type { ChatDto } from '../types';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { Spinner } from './Spinner';

/**
 * The call in progress.
 *
 * The overlay covers the app while a call is up: the reader is in a call, and
 * the chat behind it is not what they are doing. It is deliberately **not** a
 * history layer — the media viewer is the only one of those — so Back leaves
 * the call rather than closing it, exactly as it leaves the forward picker.
 *
 * The audio of the other side is played by an `<audio>` element the overlay
 * owns; the stream comes from the peer connection and the element never
 * appears.
 */

interface CallOverlayProps {
  /**
   * The call the overlay shows.
   */
  view: CallView;
  /**
   * The chat the call belongs to, when the chat list knows it.
   */
  chat: ChatDto | null;
  /**
   * The other side's audio, once it arrives.
   */
  remoteStream: MediaStream | null;
  onAccept: () => void;
  onDecline: () => void;
  onHangUp: () => void;
  onToggleMute: () => void;
  /**
   * Takes the overlay away after the call ended.
   */
  onDismiss: () => void;
}

/**
 * How long the finished-call notice stays before it goes away.
 */
const ENDED_TIMEOUT_MS = 4000;

export function CallOverlay({ view, chat, remoteStream, onAccept, onDecline, onHangUp, onToggleMute, onDismiss }: CallOverlayProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const ringtone = useRef<Ringtone | null>(null);
  const [seconds, setSeconds] = useState(0);

  /**
   * The clock of a call that is up.
   */
  useEffect(() => {
    if (view.phase !== 'active') return;
    const tick = (): void => setSeconds(Math.floor((Date.now() - view.startedAt) / 1000));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [view.phase, view.startedAt]);

  /**
   * The ringtone follows the call's state: it rings while nobody has picked
   * up, and it is silent once the media flows.
   */
  useEffect(() => {
    if (view.phase !== 'ringing') {
      ringtone.current?.stop();
      return;
    }
    const tone = new Ringtone();
    ringtone.current = tone;
    tone.start();
    return () => {
      tone.stop();
      ringtone.current = null;
    };
  }, [view.phase]);

  /**
   * The other side's audio goes into an element that is never seen.
   */
  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    element.srcObject = remoteStream;
    if (remoteStream) void element.play().catch(() => {});
  }, [remoteStream]);

  /**
   * A finished call says so for a moment and then goes away.
   */
  useEffect(() => {
    if (view.phase !== 'ended') return;
    const timer = setTimeout(onDismiss, ENDED_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [view.phase, onDismiss]);

  const title = chat?.title ?? 'Unknown';
  const incoming = view.direction === 'incoming';
  const ringing = view.phase === 'ringing';

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-panel px-6 text-center">
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
      <Avatar chatId={view.peerId} photo={chat?.photo ?? null} title={title} kind={chat?.kind ?? 'user'} big />
      <div className="flex flex-col items-center gap-1">
        <h2 className="text-2xl font-semibold">{title}</h2>
        <p className="text-[15px] text-muted" role="status">
          {statusOf(view, incoming, seconds)}
        </p>
      </div>
      {view.error ? <p className="max-w-[40ch] text-sm text-danger">{view.error}</p> : null}
      {view.fingerprint ? (
        <p className="font-mono text-xs text-muted" title="The fingerprint both sides compare to be sure they share the same key">
          key {view.fingerprint}
        </p>
      ) : null}

      {ringing && incoming ? (
        <div className="flex items-center gap-6">
          <button
            type="button"
            className="flex size-16 items-center justify-center rounded-full bg-danger text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={onDecline}
            aria-label="Decline the call"
          >
            <Icon name="call-end" size={28} />
          </button>
          <button
            type="button"
            className="flex size-16 items-center justify-center rounded-full bg-online text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={onAccept}
            aria-label="Answer the call"
          >
            <Icon name="call" size={28} />
          </button>
        </div>
      ) : null}

      {ringing && !incoming ? (
        <button
          type="button"
          className="flex size-16 items-center justify-center rounded-full bg-danger text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={onHangUp}
          aria-label="Cancel the call"
        >
          <Icon name="call-end" size={28} />
        </button>
      ) : null}

      {view.phase === 'connecting' ? <Spinner size={28} label="Connecting the call…" /> : null}

      {view.phase === 'active' ? (
        <div className="flex items-center gap-6">
          <button
            type="button"
            className="flex size-16 items-center justify-center rounded-full bg-panel-2 text-fg transition-colors hover:bg-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={onToggleMute}
            aria-pressed={view.muted}
            aria-label={view.muted ? 'Unmute the microphone' : 'Mute the microphone'}
          >
            {view.muted ? <Icon name="mic-off" size={28} /> : <Icon name="mic" size={28} />}
          </button>
          <button
            type="button"
            className="flex size-16 items-center justify-center rounded-full bg-danger text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={onHangUp}
            aria-label="End the call"
          >
            <Icon name="call-end" size={28} />
          </button>
        </div>
      ) : null}

      {view.phase === 'ended' ? (
        <button
          type="button"
          className="rounded-full bg-panel-2 px-5 py-2 text-[15px] text-fg transition-colors hover:bg-line focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={onDismiss}
        >
          Close
        </button>
      ) : null}
    </div>,
    document.body,
  );
}

/**
 * The line under the peer's name.
 */
function statusOf(view: CallView, incoming: boolean, seconds: number): string {
  if (view.phase === 'ended') return 'The call ended';
  if (view.phase === 'connecting') return 'Connecting…';
  if (view.phase === 'active') return formatDuration(seconds);
  return incoming ? 'Incoming call' : 'Calling…';
}

/**
 * The length of a call, in the way a phone writes it.
 */
function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}
