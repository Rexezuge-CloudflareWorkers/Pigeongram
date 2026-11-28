#!/usr/bin/env node
/**
 * Generates one deployment's VAPID keypair.
 *
 * The public key is build-time configuration (`VITE_VAPID_PUBLIC_KEY`); the
 * private key is a worker secret (`VAPID_PRIVATE_KEY`). Run this once per
 * deployment, store the two values in the deployment's variable and secret
 * stores, and keep them paired: changing the private key invalidates every
 * browser subscription, so a rotation means readers must enable notifications
 * again.
 *
 * Usage: `pnpm run generate:vapid`
 */

import { generateKeyPairSync } from 'node:crypto';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const jwk = privateKey.export({ format: 'jwk' }) as { x: string; y: string };
const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;

console.log('VITE_VAPID_PUBLIC_KEY=' + publicKey.toString('base64url'));
console.log('VAPID_PRIVATE_KEY=' + pkcs8.toString('base64url'));
