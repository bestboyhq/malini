import type { AgentRunProfile } from '$contract/agent';
import { hasOpenRun, isLifecycleKind } from '$contract/agent-state-machine';
import type { BrowserElementPrompt, BrowserTabArgs } from '$contract/browser';
import type { CommandRegistry } from '$main/ipc/registry';
import type { ElementThread } from '$lib/chat/chat.platform';
import type { PinStatus, ThreadPin } from './thread-pins';

const ELEMENT_SCREENSHOT_NAME = 'element.png';

export async function startElementThread(
	commands: Pick<CommandRegistry, 'call'>,
	tab: BrowserTabArgs,
	picked: BrowserElementPrompt,
	profile: AgentRunProfile,
): Promise<string> {
	const { workstreamId } = tab;
	const screenshot = await commands.call('chat.stage-attachment-bytes', {
		workstreamId,
		fileName: ELEMENT_SCREENSHOT_NAME,
		base64: picked.screenshot.base64,
	});
	const sessionId = await commands.call('chat.start-session', {
		workstreamId,
		provider: picked.provider,
		model: picked.model,
		origin: 'thread',
	});
	try {
		await commands.call('chat.send-prompt', {
			sessionId,
			prompt: picked.prompt,
			attachmentIds: [screenshot.id],
			elementReferences: [picked.element],
			profile,
		});
	} catch (error) {
		await commands.call('chat.archive-session', { sessionId }).catch(() => undefined);
		throw error;
	}
	return sessionId;
}

export function movesPin(eventType: unknown): boolean {
	return (
		typeof eventType === 'string' && (eventType === 'user.message' || isLifecycleKind(eventType))
	);
}

export function threadPin(thread: ElementThread): ThreadPin {
	return {
		sessionId: thread.sessionId,
		url: thread.url,
		domPath: thread.domPath,
		prompt: thread.prompt,
		status: pinStatus(thread),
		outcome: thread.outcome,
	};
}

function pinStatus({ status, waiting }: ElementThread): PinStatus {
	if (waiting) return 'waiting';
	if (hasOpenRun(status)) return 'working';
	return status === 'failed' ? 'failed' : 'done';
}
