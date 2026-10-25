import { useCallback, useRef, useState } from 'react';
import { fetchProfile } from './api';
import type { PeerId, ProfileDto } from './types';

/**
 * The profile of the peer a reader opened.
 *
 * The profile is read on demand: the reader asks for it by opening the
 * profile, and a thread open pays for nothing. A profile that has been read
 * is kept, so opening it again is free — the engine hands out one event at a
 * time, and a second read would be a second round trip for the same answer.
 */

/**
 * How many profiles are kept. A reader walks through chats, and a profile
 * they looked at once is worth seeing again; the oldest falls out.
 */
const CACHE_LIMIT = 8;

export interface ProfileController {
  /**
   * The profile of the peer that was asked for, once it has been read.
   */
  profile: ProfileDto | null;
  /**
   * Whether a read is in flight.
   */
  loading: boolean;
  /**
   * Why the profile could not be read, when it could not.
   */
  error: string | null;
  /**
   * Reads a peer's profile, unless it is already known.
   */
  read: (chatId: PeerId) => void;
}

/**
 * The profile of the peer the reader is looking at.
 *
 * `peer` is the chat the profile is about, and everything the hook hands
 * back belongs to it: a profile never describes another peer. A reader who
 * moves on while a read is in flight must not be shown the answer to the chat
 * they left.
 */
export function useProfile(peer: PeerId | null): ProfileController {
  const [read, setRead] = useState<{ chatId: PeerId; profile: ProfileDto } | null>(null);
  const [loadingFor, setLoadingFor] = useState<PeerId | null>(null);
  const [failed, setFailed] = useState<{ chatId: PeerId; message: string } | null>(null);
  const cache = useRef(new Map<PeerId, ProfileDto>());
  const wanted = useRef<PeerId | null>(null);
  const pending = useRef<PeerId | null>(null);

  const load = useCallback((chatId: PeerId): void => {
    wanted.current = chatId;
    const cached = cache.current.get(chatId);
    if (cached) {
      setRead({ chatId, profile: cached });
      setFailed(null);
      setLoadingFor(null);
      return;
    }
    if (pending.current === chatId) return;
    pending.current = chatId;
    setLoadingFor(chatId);
    setFailed(null);
    void fetchProfile(chatId)
      .then((result) => {
        if (wanted.current !== chatId) return;
        cache.current.set(chatId, result.profile);
        remember(cache.current);
        setRead({ chatId, profile: result.profile });
        setLoadingFor(null);
      })
      .catch((failure: unknown) => {
        if (wanted.current !== chatId) return;
        setFailed({ chatId, message: failureText(failure) });
        setLoadingFor(null);
      })
      .finally(() => {
        if (pending.current === chatId) pending.current = null;
      });
  }, []);

  return {
    profile: read !== null && read.chatId === peer ? read.profile : null,
    loading: loadingFor !== null && loadingFor === peer,
    error: failed !== null && failed.chatId === peer ? failed.message : null,
    read: load,
  };
}

/**
 * Keeps the cache to its size: the oldest profile is the one that fell out.
 */
function remember(cache: Map<PeerId, ProfileDto>): void {
  if (cache.size <= CACHE_LIMIT) return;
  const oldest = cache.keys().next();
  if (oldest.done) return;
  cache.delete(oldest.value);
}

function failureText(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}
