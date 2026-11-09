// Sets the development condition so React loads its development build.
// Under Vitest's production `NODE_ENV` React's `index.js` selects the
// production build, which does not export `act` (@testing-library/react
// requires it). This setup file runs before any test module imports React.
//
// NOTE: this also makes the source-level `import.meta.env.PROD` read true
// in the web project (Vite's test mode forces production env), which the
// PWA registration test stubs explicitly per-test.
process.env.NODE_ENV = 'development';
