import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tailwind.css';
import { useSuppressNativeContextMenu } from './useSuppressNativeContextMenu';

/**
The app plus the document-level behavior that has to cover every screen it can
show — the launch splash and the login page included, not only the signed-in
shell.
*/
function Root() {
  useSuppressNativeContextMenu();
  return <App />;
}

createRoot(document.querySelector('#root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
