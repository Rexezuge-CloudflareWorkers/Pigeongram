import { Hono } from 'hono';

// Wrangler discovers the Durable Object class through this re-export.
export { SessionEngine } from './session-engine';

const app = new Hono<{ Bindings: CloudflareEnv }>();

app.get('/health', (c) => c.json({ status: 'ok', service: 'telegram-web-client' }));

export default app;
