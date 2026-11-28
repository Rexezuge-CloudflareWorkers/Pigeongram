import type { WidgetHost, WidgetHostOptions } from '@telegram/widget-sandbox/host/widget-host';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTelegramLinkHandler } from '../telegram-links';
import type { MessageDto, MessageMediaDto, WidgetMediaDto } from '../types';
import { inflateWidgetPayload } from '../widget-decode';
import { loadWidgetSandbox } from '../widget-loader';
import { ConfirmDialog } from './ConfirmDialog';
import { MessageUnsupported } from './UnsupportedMedia';
import { useTheme } from './useTheme';

/**
A layer-233 widget, rendered read-only in the official sandbox.

The sandbox is the security boundary: widget HTML is bot-supplied, so a
plain iframe would give a runaway widget neither CPU/memory limits nor a
validator. Strict policy stays on. We install no `onRequest`, so every bot
query is refused by the sandbox and no network marker is drawn; state,
storage and shared-widget polling belong to a later, interactive pass.

The bubble reserves the bot's size anchors before the sandbox boots, keeps
the last reported height per message so a scroll-back does not jump, and
stops the widget when it leaves the viewport. If the payload cannot be
inflated (an older browser) or the host dies, the labelled card stays.
*/

const MIN_HEIGHT = 50;
const MAX_HEIGHT = 600;
const MIN_WIDTH = 200;
const MAX_WIDTH = 420;
const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 180;
const MAX_CACHED_HEIGHTS = 200;

const heights = new Map<string, number>();

function cacheKey(message: MessageDto): string {
  return `${String(message.chatId)}:${String(message.id)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function rememberHeight(key: string, height: number): void {
  if (heights.size >= MAX_CACHED_HEIGHTS) {
    const oldest = heights.keys().next().value;
    if (oldest !== undefined) heights.delete(oldest);
  }
  heights.set(key, height);
}

function initialHeight(message: MessageDto, widget: WidgetMediaDto): number {
  if (widget.height > 0) return clamp(widget.height, MIN_HEIGHT, MAX_HEIGHT);
  return heights.get(cacheKey(message)) ?? DEFAULT_HEIGHT;
}

function widgetWidth(widget: WidgetMediaDto, available: number): number {
  if (widget.width > 0) return clamp(widget.width, MIN_WIDTH, MAX_WIDTH);
  return clamp(available > 0 ? available : DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH);
}

function chatType(chatId: number): 'private' | 'group' | 'supergroup' {
  if (chatId > 0) return 'private';
  // A forwarded copy is told nothing about the chat it now sits in.
  return chatId <= -1_000_000_000_000 ? 'supergroup' : 'group';
}

function bubbleTheme(scheme: 'light' | 'dark'): WidgetHostOptions['theme'] {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string): string => styles.getPropertyValue(name).trim();
  const color = (name: string): string => {
    const value = read(name);
    return /^#[0-9a-f]{6}$/i.test(value) ? value : '';
  };
  return {
    colorScheme: scheme,
    params: {
      bg_color: color('--md-sys-color-surface-container-highest') || undefined,
      text_color: color('--md-sys-color-on-surface') || undefined,
      hint_color: color('--md-sys-color-on-surface-variant') || undefined,
      link_color: color('--md-sys-color-primary') || undefined,
      button_color: color('--md-sys-color-primary') || undefined,
      button_text_color: color('--md-sys-color-on-primary') || undefined,
      secondary_bg_color: color('--md-sys-color-surface-container') || undefined,
    },
    button: { radius: '10px' },
    text: { fontSize: 16, lineHeight: 1.35, padding: '6px 10px' },
  };
}

export function WidgetMedia({ message, media, link = null }: { message: MessageDto; media: MessageMediaDto; link?: string | null }) {
  const widget = media.widget;
  const { t, i18n } = useTranslation();
  const { theme } = useTheme();
  const telegramLink = useTelegramLinkHandler();
  const telegramLinkRef = useRef(telegramLink);
  useEffect(() => {
    telegramLinkRef.current = telegramLink;
  }, [telegramLink]);

  const containerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<WidgetHost | null>(null);
  const visibleRef = useRef(false);
  // Keyed by payload so a new message resets itself without a synchronous
  // setState in the effect body: while a payload is inflating there is no
  // document yet, and a failure is tied to the payload that failed.
  const [inflated, setInflated] = useState<{ payload: string; html: string | null; failed: boolean } | null>(null);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [height, setHeight] = useState(() => (widget === undefined ? DEFAULT_HEIGHT : initialHeight(message, widget)));
  const current = inflated?.payload === widget?.payload ? inflated : null;
  const html = current?.html ?? null;
  const failed = current?.failed ?? false;

  useEffect(() => {
    if (widget === undefined) return;
    const payload = widget.payload;
    let alive = true;
    inflateWidgetPayload(payload)
      .then((document) => {
        if (alive) setInflated({ payload, html: document, failed: false });
      })
      .catch(() => {
        if (alive) setInflated({ payload, html: null, failed: true });
      });
    return () => {
      alive = false;
    };
  }, [widget?.payload]);

  useEffect(() => {
    if (html === null || failed || widget === undefined) return;
    let alive = true;
    let teardown: (() => void) | null = null;
    const key = cacheKey(message);
    loadWidgetSandbox()
      .then(({ WidgetHost: Host, rendererFactory }) => {
        const container = containerRef.current;
        if (!alive || container === null) return;
        const host = new Host(container, html, {
          theme: bubbleTheme(theme),
          locale: i18n.language,
          data: { chatData: widget.chatData, publicData: widget.publicData },
          context: {
            isCopy: widget.isCopy,
            canQuery: widget.canQuery,
            backgroundQuery: widget.canQueryInBackground,
            ...(!widget.isCopy && { chatType: chatType(message.chatId) }),
          },
          rendererFactory,
          features: ['webAnimations'],
          visible: false,
          stoppedLabel: t('widget.stopped', 'Widget Stopped'),
          // No onRequest: the sandbox refuses every bot query. No storage,
          // copy-text or shared-state callbacks in this read-only pass.
          onResize: (reported) => {
            const clamped = clamp(reported, MIN_HEIGHT, MAX_HEIGHT);
            rememberHeight(key, clamped);
            if (widget.height === 0) setHeight(clamped);
          },
          onAction: (action) => {
            if (action.kind === 'openLink') {
              setPendingLink(action.url);
              return;
            }
            if (action.kind === 'openTelegramLink' && telegramLinkRef.current?.(action.url) !== true) {
              window.open(action.url, '_blank', 'noopener,noreferrer');
            }
            // `ready` and `haptic` need no work here.
          },
          onDead: () => {
            if (alive) setInflated({ payload: widget.payload, html: null, failed: true });
          },
        });
        hostRef.current = host;
        host.setVisible(visibleRef.current);
        teardown = () => {
          host.destroy();
          hostRef.current = null;
        };
      })
      .catch(() => {
        if (alive) setInflated({ payload: widget.payload, html: null, failed: true });
      });
    return () => {
      alive = false;
      teardown?.();
    };
    // The host is fixed for one message and one document; theme changes are
    // pushed to it by the effect below instead of recreating the sandbox.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    html,
    failed,
    message.chatId,
    message.id,
    widget?.isCopy,
    widget?.canQuery,
    widget?.canQueryInBackground,
    widget?.height,
    widget?.width,
  ]);

  useEffect(() => {
    hostRef.current?.setTheme(bubbleTheme(theme));
  }, [theme]);

  useEffect(() => {
    const element = containerRef.current;
    if (element === null || html === null) return;
    if (typeof IntersectionObserver === 'undefined') {
      visibleRef.current = true;
      hostRef.current?.setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries[0]?.isIntersecting ?? false;
        visibleRef.current = visible;
        hostRef.current?.setVisible(visible);
      },
      { rootMargin: '100px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [html]);

  if (widget === undefined || failed) return <MessageUnsupported link={link} />;

  return (
    <>
      <div
        ref={containerRef}
        className="widget-bubble relative overflow-hidden rounded-xl"
        style={{ width: widget.width > 0 ? `${String(widgetWidth(widget, 0))}px` : '100%', height }}
        role="group"
        aria-label={t('a11y.widget', 'Widget')}
        data-widget-message
      >
        {html === null ? <div className="h-full w-full animate-pulse bg-surface-container" aria-hidden="true" /> : null}
      </div>
      {pendingLink === null ? null : (
        <ConfirmDialog
          title={t('widget.openLinkTitle', 'Open This Link?')}
          message={t('widget.openLinkMessage', 'Open {{url}} In A New Tab?', { url: pendingLink })}
          confirmLabel={t('widget.openLinkConfirm', 'Open Link')}
          tone="accent"
          onConfirm={() => {
            window.open(pendingLink, '_blank', 'noopener,noreferrer');
            setPendingLink(null);
          }}
          onCancel={() => setPendingLink(null)}
        />
      )}
    </>
  );
}
