export type PromptDispatchStage = 'prepare-session' | 'prepare-stream' | 'deliver' | 'cancel';

export type PromptDispatchFailure =
	'session-boot' | 'already-running' | 'cancel-race' | 'prompt-delivery';

const SESSION_BOOT_STAGES: ReadonlySet<PromptDispatchStage> = new Set([
	'prepare-session',
	'prepare-stream',
]);

export function isAlreadyActiveError(message: string): boolean {
	return message.toLowerCase().includes('already has an active run');
}

export function isCancelRaceError(message: string): boolean {
	return message.toLowerCase().includes('cancel race');
}

export function classifyPromptDispatchFailure(input: {
	stage: PromptDispatchStage;
	message: unknown;
}): PromptDispatchFailure {
	const message = dispatchFailureMessage(input.message);
	if (isAlreadyActiveError(message)) return 'already-running';
	if (isCancelRaceError(message)) return 'cancel-race';
	return SESSION_BOOT_STAGES.has(input.stage) ? 'session-boot' : 'prompt-delivery';
}

function dispatchFailureMessage(value: unknown): string {
	if (value instanceof Error) return value.message;
	if (typeof value === 'string') return value;
	if (
		typeof value === 'object' &&
		value !== null &&
		'message' in value &&
		typeof value.message === 'string'
	) {
		return value.message;
	}
	return '';
}
