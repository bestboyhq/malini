import type { ChatRequestId, ChatRequestOutcome } from '$lib/chat/domain/chat-request';
import {
	createDestructiveConfirm,
	type DestructiveConfirm,
} from './chat-message-list/destructive-confirm.svelte';

export type DestructiveConfirmHarness = Readonly<{
	confirmation: DestructiveConfirm;
	accepted: readonly string[];
	settle(requestId: ChatRequestId, outcome: ChatRequestOutcome): void;
	stop(): void;
}>;

export function mountDestructiveConfirm(): DestructiveConfirmHarness {
	let outcomes = $state<Record<ChatRequestId, ChatRequestOutcome>>({});
	const accepted: string[] = [];
	const mounted: { confirmation: DestructiveConfirm | null } = { confirmation: null };
	const stop = $effect.root(() => {
		mounted.confirmation = createDestructiveConfirm({
			outcomeOf: (requestId) => outcomes[requestId] ?? null,
			onAccepted: (key) => accepted.push(key),
		});
	});
	const confirmation = mounted.confirmation;
	if (!confirmation) throw new Error('The destructive confirmation did not mount');
	return {
		confirmation,
		accepted,
		settle: (requestId, outcome) => {
			outcomes = { ...outcomes, [requestId]: outcome };
		},
		stop,
	};
}
