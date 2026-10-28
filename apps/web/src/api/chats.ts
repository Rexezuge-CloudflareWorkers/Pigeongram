import type {
  DialogDto,
  GetDialogsResult,
  GetMeResult,
  GetProfileResult,
  JoinChatParams,
  JoinChatResult,
  MeDto,
  PeerId,
  ResolveChatParams,
  ResolveChatResult,
  SetArchivedResult,
} from '../types';
import { batchResult, rpc, rpcBatch } from './request';

/**
 * The chat-list half of the bridge: the dialogs, the archive that is a read of
 * its own, the combined boot read, a peer's profile, and the resolution of a
 * chat a link or a forward names.
 */

export const fetchDialogs = (): Promise<GetDialogsResult> => rpc('getDialogs', { limit: 100 });

/**
Reads the account's archive: the chats Telegram keeps in the peer folder 1.
It is a separate read from the chat list, because one limit over both would
cost the main list the chats the archive holds.
*/
export const fetchArchivedDialogs = (): Promise<GetDialogsResult> => rpc('getDialogs', { limit: 100, archived: true });

/**
Moves a chat into the archive, or back out of it.
*/
export const setArchived = (chatId: PeerId, archived: boolean): Promise<SetArchivedResult> => rpc('setArchived', { chatId, archived });

/**
The signed-in shell's first read: who the account is and the chat list.

Both come back in one request, and the account's own profile is a failure
that must not cost the chat list: the shell shows the chat list either way.
*/
export async function fetchBootstrap(): Promise<{ me: MeDto | null; dialogs: DialogDto[] }> {
  const outcomes = await rpcBatch([{ method: 'getMe' }, { method: 'getDialogs', params: { limit: 100 } }]);
  const me = outcomes[0]?.ok ? (outcomes[0].result as GetMeResult).me : null;
  const dialogs = batchResult<GetDialogsResult>(outcomes[1], 'chat list').dialogs;
  return { me, dialogs };
}

/**
Reads a peer's profile: the bio of a person, the description and the member
count of a group or a channel. It is read on demand — the profile is what the
reader asks for when they open it, and a thread open would otherwise pay for
a read nobody looks at.
*/
export const fetchProfile = (chatId: PeerId): Promise<GetProfileResult> => rpc('getProfile', { chatId });

/**
Resolves the chat a link or a forward names. The engine turns the username or
marked id into a peer and answers its DTO with whether this account is in it.
*/
export const resolveChat = (params: ResolveChatParams): Promise<ResolveChatResult> => rpc('resolveChat', { ...params });

/**
Joins a resolved public chat, or reports that an admin must approve the
request or that a guard bot wants its web view opened.
*/
export const joinChat = (params: JoinChatParams): Promise<JoinChatResult> => rpc('joinChat', { ...params });
