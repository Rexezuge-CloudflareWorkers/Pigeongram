import { readBranding } from '../branding';

/**
 * The product name the SPA itself renders.
 *
 * The build inlines `VITE_APP_NAME` here; the fallback is the same branding
 * default the document title and the web app manifest use, so tests and a fork
 * that sets nothing still agree.
 */
export const APP_NAME = readBranding({ VITE_APP_NAME: import.meta.env.VITE_APP_NAME }).name;
