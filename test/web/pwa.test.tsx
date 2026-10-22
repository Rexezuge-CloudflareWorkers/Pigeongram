import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePwa } from '../../pages/src/pwa/usePwa';

interface FakeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

function Probe() {
  const pwa = usePwa();
  return (
    <button type="button" disabled={!pwa.canInstall} onClick={pwa.install}>
      Install
    </button>
  );
}

function fakeServiceWorker(register: () => void): void {
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } });
}

describe('the progressive web app', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('offers the install prompt the browser raised', async () => {
    render(<Probe />);
    const idle = screen.getByRole('button', { name: 'Install' }) as HTMLButtonElement;
    expect(idle.disabled).toBe(true);

    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = new Event('beforeinstallprompt') as FakeInstallPromptEvent;
    event.prompt = prompt;
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    globalThis.dispatchEvent(event);

    const offered = (await screen.findByRole('button', { name: 'Install' })) as HTMLButtonElement;
    expect(offered.disabled).toBe(false);
    offered.click();
    expect(prompt).toHaveBeenCalled();
  });

  it('registers the worker in a production build', () => {
    const register = vi.fn().mockResolvedValue(undefined);
    fakeServiceWorker(register);
    vi.stubEnv('PROD', true);
    render(<Probe />);
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/', type: 'classic' });
  });

  it('leaves the worker out of the development build', () => {
    const register = vi.fn().mockResolvedValue(undefined);
    fakeServiceWorker(register);
    render(<Probe />);
    expect(register).not.toHaveBeenCalled();
  });
});
