import { useTranslation } from 'react-i18next';
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
  Whole seconds captured so far.
  */
  seconds: number;
  onCancel: () => void;
  onStop: () => void;
}

export function VoiceRecordingStrip({ state, seconds, onCancel, onStop }: VoiceRecordingStripProps) {
  const { t } = useTranslation();
  return (
    <div className="recording-strip" role="group" aria-label={t('a11y.voiceRecording', 'Voice Recording')}>
      <span className="recording-dot" aria-hidden="true" />
      <span className="recording-time" aria-hidden="true">
        {state === 'starting' ? '0:00' : elapsedLabel(seconds)}
      </span>
      <span className="recording-status" role="status">
        {state === 'starting'
          ? t('composer.startingMicrophone', 'Starting Microphone…')
          : t('composer.recordingVoice', 'Recording Voice Message…')}
      </span>
      <button
        type="button"
        className="recording-action"
        data-icon-only
        aria-label={t('composer.cancelRecording', 'Cancel Recording')}
        title={t('composer.cancelRecording', 'Cancel Recording')}
        onClick={onCancel}
      >
        <Icon name="delete" size={18} />
      </button>
      <button
        type="button"
        className="recording-action recording-stop"
        data-icon-only
        aria-label={t('composer.stopAndSend', 'Stop And Send')}
        title={t('composer.stopAndSend', 'Stop And Send')}
        disabled={state === 'starting'}
        onClick={onStop}
      >
        <Icon name="send" size={18} />
      </button>
    </div>
  );
}
