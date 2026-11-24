import { chatRoute } from '$lib/chat/infrastructure/stores/chat-route.store.svelte';
import { chatSessionStore } from '$lib/chat/infrastructure/stores/chat-session.store.svelte';
import { sendCommandPromptCommand } from './send-command-prompt.command';
import { sendFirstPromptCommand } from './send-first-prompt.command';
import { shipInNewChatCommand } from './ship-in-new-chat.command';

export { shipPromptCommand };

function shipPromptCommand(
	request: Readonly<{ workstreamId: string; prompt: string; subject: string; inNewChat: boolean }>,
): void {
	const { workstreamId, prompt, subject, inNewChat } = request;
	if (inNewChat) {
		shipInNewChatCommand({ workstreamId, fork: null, prompt, subject });
		return;
	}
	const shown = chatRoute.isCurrentWorkstream(workstreamId) ? chatSessionStore.sessionId : null;
	if (shown === null) {
		sendFirstPromptCommand({ workstreamId, prompt });
		return;
	}
	sendCommandPromptCommand({ workstreamId, sessionId: shown, prompt, subject });
}
