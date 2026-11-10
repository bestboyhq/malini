export const RETIRED_CHATS_PROJECT_ID = 'malini-lead-space';

export function isRetiredChat(chat: Readonly<{ projectId: string }>): boolean {
	return chat.projectId === RETIRED_CHATS_PROJECT_ID;
}
