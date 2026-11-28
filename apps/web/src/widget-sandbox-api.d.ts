/**
Local type surface for the two sandbox host modules we import.

`@telegram/widget-sandbox` ships raw TypeScript whose own dev-only types and
`virtual:*` bundles are built by its Vite plugin, so compiling those sources
from our workspace fails. The host contract we use is small and stable; the
tsconfig `paths` entries point here, while Vite still resolves the real
modules at build and run time.
*/

export type WidgetAction =
  { kind: 'ready' } | { kind: 'openLink'; url: string } | { kind: 'openTelegramLink'; url: string } | { kind: 'haptic' };

export interface WidgetData {
  chatData?: string | null;
  publicData?: string | null;
}

export interface WidgetContext {
  isCopy?: boolean;
  canQuery?: boolean;
  backgroundQuery?: boolean;
  chatType?: 'private' | 'group' | 'supergroup' | 'channel';
  viewer?: { id: number; firstName?: string; lastName?: string; username?: string; isPremium?: boolean };
}

export interface WidgetTheme {
  colorScheme: 'light' | 'dark';
  params?: Record<string, string | undefined>;
  button?: { radius?: string };
  text?: { fontSize?: number | string; lineHeight?: number | string; padding?: string };
}

export type RendererFactory = (container: HTMLElement, theme: 'light' | 'dark') => unknown;

export interface WidgetHostOptions {
  theme: 'light' | 'dark' | WidgetTheme;
  locale?: string;
  data?: WidgetData;
  context?: WidgetContext;
  rendererFactory?: RendererFactory;
  features?: string[];
  visible?: boolean;
  stoppedLabel?: string;
  onRequest?: (request: { data: string }) => Promise<{ result: string }> | { result: string };
  onResize?: (height: number, anchor: 'top' | 'bottom') => void;
  onAction?: (action: WidgetAction) => void;
  onDead?: (reason: string) => void;
}

export declare class WidgetHost {
  constructor(container: HTMLElement, html: string, options: WidgetHostOptions);
  setVisible(visible: boolean): void;
  setTheme(theme: 'light' | 'dark' | WidgetTheme): void;
  destroy(): void;
}

export declare const ShadowDomRenderer: { factory: RendererFactory };
