// Sets the development condition so React loads its development build.
// Under Vitest's production `NODE_ENV` React's `index.js` selects the
// production build, which does not export `act` (@testing-library/react
// requires it). This setup file runs before any test module imports React.
//
// NOTE: this also makes the source-level `import.meta.env.PROD` read true
// in the web project (Vite's test mode forces production env), which the
// PWA registration test stubs explicitly per-test.
process.env.NODE_ENV = 'development';

// jsdom builds its window at the opaque `about:blank` origin, and an opaque
// origin has no localStorage. The SPA persists the theme and the dynamic-color
// choices there, so the suite needs a storage in the DOM it tests against.
if (globalThis.localStorage === undefined) {
  const items = new Map<string, string>();
  const storage = {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key: string) => items.get(key) ?? null,
    key: (index: number) => [...items.keys()][index] ?? null,
    removeItem: (key: string) => void items.delete(key),
    setItem: (key: string, value: string) => void items.set(key, value),
  } satisfies Storage;
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
}
