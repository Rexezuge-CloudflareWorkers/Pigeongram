import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatBytes, mediaPreview } from '../format';
import type { UploadKind } from '../types';
import { canGroupUploads, MAX_UPLOAD_ITEMS, mediaKind } from '../upload';

/**
A review step between the file picker and the upload: every selected file is
listed with its kind and size, more files can be appended, individual ones can
be removed, and multi-file selections can go out as one Telegram album.

The composer owns the open state and hands over the files the picker returned;
`onSend` receives the reviewed selection and the group choice. Files beyond the
album limit are dropped with an inline notice, so the user can send them in a
second batch.
*/

interface UploadDialogProps {
  initialFiles: readonly File[];
  onCancel: () => void;
  onSend: (files: File[], grouped: boolean) => void;
}

export function UploadDialog({ initialFiles, onCancel, onSend }: UploadDialogProps) {
  const [files, setFiles] = useState<File[]>(() => initialFiles.slice(0, MAX_UPLOAD_ITEMS));
  const [notice, setNotice] = useState<string | null>(() =>
    initialFiles.length > MAX_UPLOAD_ITEMS ? overflowNotice(initialFiles.length - MAX_UPLOAD_ITEMS) : null,
  );
  // Albums are the better default for a multi-file selection, so the checkbox
  // starts checked; it is rendered disabled whenever the selection cannot group.
  const [grouped, setGrouped] = useState(true);
  const dialogRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const hintId = useId();

  const groupable = canGroupUploads(files);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    cancelRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCancel();
        event.preventDefault();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusables = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([tabindex="-1"])') ?? []),
      ];
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables.at(-1)!;
      const active = document.activeElement;
      const inside = dialogRef.current?.contains(active) ?? false;

      if (event.shiftKey && (!inside || active === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    addEventListener('keydown', onKeyDown, { capture: true });
    return () => removeEventListener('keydown', onKeyDown, { capture: true });
  }, [onCancel]);

  const addFiles = (picked: FileList | null): void => {
    if (!picked || picked.length === 0) return;
    const merged = [...files, ...Array.from(picked)];
    setFiles(merged.slice(0, MAX_UPLOAD_ITEMS));
    setNotice(merged.length > MAX_UPLOAD_ITEMS ? overflowNotice(merged.length - MAX_UPLOAD_ITEMS) : null);
  };

  const removeFile = (index: number): void => {
    setFiles((current) => current.filter((_, position) => position !== index));
    setNotice(null);
  };

  const send = (): void => {
    if (files.length === 0) return;
    onSend(files, grouped && groupable);
  };

  const sendLabel =
    files.length === 0
      ? 'Send'
      : grouped && groupable && files.length > 1
        ? `Send album (${files.length})`
        : files.length > 1
          ? `Send ${files.length} files`
          : 'Send';

  return createPortal(
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="flex max-h-[85vh] w-full max-w-[560px] flex-col rounded-3xl border border-line bg-panel-2 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hintId}
      >
        <div className="flex items-baseline justify-between gap-3 px-6 pt-6">
          <h2 id={titleId} className="text-xl font-semibold">
            Send files
          </h2>
          <span className="text-sm text-muted">
            {files.length} / {MAX_UPLOAD_ITEMS}
          </span>
        </div>
        <p id={hintId} className="px-6 pt-1 text-sm text-muted">
          Review the selection, then send the files together as an album or one by one.
        </p>

        <ul className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto px-6" aria-label="Selected files">
          {files.map((file, index) => (
            <UploadPreview
              key={`${file.name}:${file.size}:${file.lastModified}:${index}`}
              file={file}
              index={index}
              onRemove={() => removeFile(index)}
            />
          ))}
        </ul>

        {notice ? (
          <p className="px-6 pt-2 text-sm text-danger" role="status">
            {notice}
          </p>
        ) : null}

        <div className="px-6 pt-3">
          <button
            type="button"
            className="rounded-full border border-line px-4 py-2 text-sm font-semibold text-accent transition-colors hover:bg-accent/10 focus-visible:bg-accent/10 focus-visible:outline-none disabled:cursor-default disabled:opacity-50"
            disabled={files.length >= MAX_UPLOAD_ITEMS}
            onClick={() => fileRef.current?.click()}
          >
            Add files
          </button>
          <input
            ref={fileRef}
            type="file"
            multiple
            tabIndex={-1}
            aria-hidden="true"
            className="hidden"
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = '';
            }}
          />
        </div>

        <div className="mt-3 px-6">
          <label className="flex items-start gap-3 rounded-2xl bg-panel px-4 py-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0 accent-accent"
              checked={grouped && groupable}
              disabled={!groupable}
              onChange={(event) => setGrouped(event.target.checked)}
            />
            <span>
              <span className="block font-medium">Group Items</span>
              <span className="block text-sm text-muted">{groupHint(files.length, groupable)}</span>
            </span>
          </label>
        </div>

        <div className="flex justify-end gap-2 px-6 pb-6 pt-4">
          <button
            ref={cancelRef}
            type="button"
            className="min-w-[88px] rounded-full px-4 py-2 font-semibold text-accent transition-colors hover:bg-accent/10 focus-visible:bg-accent/10 focus-visible:outline-none"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="min-w-[88px] rounded-full bg-accent px-4 py-2 font-semibold text-[#0b1a1a] transition-colors hover:bg-accent/90 focus-visible:bg-accent/90 focus-visible:outline-none disabled:cursor-default disabled:opacity-50"
            disabled={files.length === 0}
            onClick={send}
          >
            {sendLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const KIND_ICONS: Record<UploadKind, string> = {
  photo: '🖼️',
  video: '🎬',
  animation: '🎞️',
  document: '📄',
};

interface UploadPreviewProps {
  file: File;
  index: number;
  onRemove: () => void;
}

function UploadPreview({ file, index, onRemove }: UploadPreviewProps) {
  const kind = mediaKind(file);
  // The object URL is derived, not stored: a photo preview is a blob URL the
  // browser owns, and the effect below hands it back when the row unmounts.
  const previewUrl = useMemo(() => {
    if (kind !== 'photo' && kind !== 'animation') return null;
    try {
      return URL.createObjectURL(file);
    } catch {
      return null;
    }
  }, [file, kind]);

  useEffect(
    () => () => {
      if (previewUrl !== null) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const size = formatBytes(file.size);

  return (
    <li className="flex items-center gap-3 rounded-2xl bg-panel px-3 py-2">
      <span className="w-5 shrink-0 text-center text-sm text-muted">{index + 1}</span>
      <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-panel-2 text-xl">
        {previewUrl ? (
          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <span aria-hidden="true">{KIND_ICONS[kind]}</span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{file.name || 'file'}</span>
        <span className="block text-xs text-muted">
          {mediaPreview(kind)}
          {size ? ` · ${size}` : ''}
        </span>
      </span>
      <button
        type="button"
        className="shrink-0 rounded-full px-2 py-1 text-lg text-muted transition-colors hover:bg-panel-2 hover:text-fg focus-visible:bg-panel-2 focus-visible:text-fg focus-visible:outline-none"
        aria-label={`Remove ${file.name || 'file'}`}
        onClick={onRemove}
      >
        ×
      </button>
    </li>
  );
}

function overflowNotice(dropped: number): string {
  return `Only ${MAX_UPLOAD_ITEMS} files can be sent at once; ${dropped === 1 ? 'one file was' : `${dropped} files were`} left out. Send the rest in another batch.`;
}

function groupHint(count: number, groupable: boolean): string {
  if (count < 2) return 'Select two or more files to send them as an album.';
  if (groupable) return 'Photos, videos and GIFs go together; documents group with documents.';
  return 'These files cannot share an album. They will be sent as separate messages.';
}
