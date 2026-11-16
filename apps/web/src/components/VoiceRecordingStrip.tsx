import { elapsedLabel } from '../recorder';
import type { VoiceRecorderState } from '../useVoiceRecorder';
import { Icon } from './Icon';

/**
The composer's recording state: the live timer, what is happening, and the two
ways out — cancel the recording or stop and send it. It replaces the text row
while a voice message is being captured, so the text box and the send button do
not compete with it.
*/

interface VoiceRecordingStripProps {
  state: VoiceRecorderState;
  /**
   * Whole seconds captured so far.
   */
  seconds: number;
  onCancel: () => void;
  onStop: () => void;
}

export function VoiceRecordingStrip({ state, seconds, onCancel, onStop }: VoiceRecordingStripProps) {
  return (
    <div className="recording-strip" role="group" aria-label="Voice Recording">
      <span className="recording-dot" aria-hidden="true" />
      <span className="recording-time" aria-hidden="true">
        {state === 'starting' ? '0:00' : elapsedLabel(seconds)}
      </span>
      <span className="recording-status" role="status">
        {state === 'starting' ? 'Starting Microphone…' : 'Recording Voice Message…'}
      </span>
      <button
        type="button"
        className="recording-action"
        data-icon-only
        aria-label="Cancel Recording"
        title="Cancel Recording"
        onClick={onCancel}
      >
        <Icon name="delete" size={18} />
      </button>
      <button
        type="button"
        className="recording-action recording-stop"
        data-icon-only
        aria-label="Stop And Send"
        title="Stop And Send"
        disabled={state === 'starting'}
        onClick={onStop}
      >
        <Icon name="send" size={18} />
      </button>
    </div>
  );
}
