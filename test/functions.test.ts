import { describe, expect, it } from 'vitest';
import { onRequest as apiProxy } from '../functions/api/[[path]]';
import { onRequest as userProxy } from '../functions/user/[[path]]';

/**
Invokes one Pages Function with a request for `path` and records what the
function hands to the `API_WORKER` service binding.
*/
async function forward(
  handler: (context: never) => Promise<Response>,
  path: string,
): Promise<{ forwarded: Request[]; response: Response }> {
  const forwarded: Request[] = [];
  const request = new Request(`https://pages.example.com${path}`, {
    headers: { 'cf-access-jwt-assertion': 'signed-token', 'x-test': 'kept' },
  });
  const context = {
    request,
    env: {
      API_WORKER: {
        fetch: async (incoming: Request): Promise<Response> => {
          forwarded.push(incoming);
          return new Response(null, { status: 204 });
        },
      },
    },
  } as unknown as never;
  return { forwarded, response: await handler(context) };
}

describe('Pages Functions', () => {
  it('forwards the public /api plane untouched', async () => {
    const { forwarded, response } = await forward(apiProxy, '/api/health?probe=1');
    expect(response.status).toBe(204);
    expect(forwarded).toHaveLength(1);
    expect(new URL(forwarded[0].url).pathname).toBe('/api/health');
    expect(new URL(forwarded[0].url).search).toBe('?probe=1');
  });

  it('forwards /user/* untouched, including the Access assertion', async () => {
    const { forwarded, response } = await forward(userProxy, '/user/state');
    expect(response.status).toBe(204);
    expect(forwarded).toHaveLength(1);
    expect(new URL(forwarded[0].url).pathname).toBe('/user/state');
    expect(forwarded[0].headers.get('cf-access-jwt-assertion')).toBe('signed-token');
  });

  it('forwards the Access entry point and its return path', async () => {
    const { forwarded } = await forward(userProxy, '/user/login?next=%2Fchat%2F2');
    expect(forwarded).toHaveLength(1);
    expect(new URL(forwarded[0].url).pathname).toBe('/user/login');
    expect(new URL(forwarded[0].url).search).toBe('?next=%2Fchat%2F2');
  });
});
