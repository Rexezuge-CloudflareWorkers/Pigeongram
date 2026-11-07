/**
 * A tiny in-memory token bucket for the Free tier.
 *
 * State lives in the isolate, so the limit is per-instance rather than global,
 * but it is enough to blunt a burst without adding a billing dependency or a
 * Durable Object round trip to every request.
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkRateLimit(key: string, limitPerMinute: number, now = Date.now()): RateLimitResult {
  const capacity = Math.max(1, limitPerMinute);
  const refillPerMs = capacity / 60_000;
  const bucket = buckets.get(key) ?? { tokens: capacity, lastRefill: now };
  const elapsed = Math.max(0, now - bucket.lastRefill);
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs);
  bucket.lastRefill = now;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    buckets.set(key, bucket);
    return { allowed: true, retryAfterSeconds: 0 };
  }
  buckets.set(key, bucket);
  const deficit = 1 - bucket.tokens;
  const retryAfterMs = deficit / refillPerMs;
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
}

export function rateLimitKey(request: Request, identity: string | null): string {
  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
  return identity ?? ip;
}

export function resetRateLimitBucketsForTests(): void {
  buckets.clear();
}
