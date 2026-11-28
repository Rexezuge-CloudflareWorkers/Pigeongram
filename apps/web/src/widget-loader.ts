import type { RendererFactory } from '@telegram/widget-sandbox/host/renderer';
import type { WidgetHost } from '@telegram/widget-sandbox/host/widget-host';

/**
The widget sandbox is loaded on the first widget a thread actually shows.

Its QuickJS worker, validator bundles and Shadow DOM renderer are far too
large to ride the first paint of a chat. The dynamic import also keeps the
sandbox's `virtual:*` bundles out of the initial chunk; Vite's plugin builds
them only for this code-split piece. The promise is shared so several
widgets appearing at once boot one copy of the module.
*/
export interface WidgetSandboxModule {
  WidgetHost: typeof WidgetHost;
  rendererFactory: RendererFactory;
}

let pending: Promise<WidgetSandboxModule> | undefined;

export function loadWidgetSandbox(): Promise<WidgetSandboxModule> {
  return (pending ??= Promise.all([
    import('@telegram/widget-sandbox/host/widget-host'),
    import('@telegram/widget-sandbox/host/shadow-renderer'),
  ]).then(([host, renderer]) => ({
    WidgetHost: host.WidgetHost,
    rendererFactory: renderer.ShadowDomRenderer.factory,
  })));
}
