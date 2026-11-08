import { readEngineConfig } from '@pigeongram/backend-services/session/config';
import { errorResponse } from '@pigeongram/backend-services/session/http';
import { parseUploadGroupSpec, parseUploadSpec } from '@pigeongram/backend-services/session/upload-spec';
import { forwardToEngine } from './engine';
import type { ApiContext } from '../types';

/**
 * Single-file upload.
 *
 * The pre-flight runs at the edge, before the request is forwarded: workerd
 * reads a request stream after its response when a Durable Object answers
 * without consuming the body (cloudflare/workerd#918), so a malformed or
 * oversized upload must never reach it. The parser is shared with the engine,
 * so both sides agree on every rule before a byte is touched.
 */
export async function uploadHandler(c: ApiContext): Promise<Response> {
  try {
    parseUploadSpec(new URL(c.req.url), c.req.raw, readEngineConfig(c.env));
  } catch (error) {
    return errorResponse(error, c.get('correlationId'));
  }
  return forwardToEngine(c);
}

/**
 * Album upload.
 *
 * `POST /user/upload-group` carries 2–10 files concatenated in the order its
 * `manifest` query parameter declares. The same edge pre-flight applies; the
 * engine splits the one body back into the exact byte ranges.
 */
export async function uploadGroupHandler(c: ApiContext): Promise<Response> {
  try {
    parseUploadGroupSpec(new URL(c.req.url), c.req.raw, readEngineConfig(c.env));
  } catch (error) {
    return errorResponse(error, c.get('correlationId'));
  }
  return forwardToEngine(c);
}
