import { errorMessage } from '$lib/chat/domain/error-message';
import type { PromptDispatchStage } from '$lib/chat/domain/prompt-dispatch-failure';

export class PromptDispatchError extends Error {
	readonly stage: PromptDispatchStage;

	constructor(stage: PromptDispatchStage, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'PromptDispatchError';
		this.stage = stage;
	}
}

export function stagedDispatchFailure(
	stage: PromptDispatchStage,
	cause: unknown,
	fallback: string,
): PromptDispatchError {
	if (cause instanceof PromptDispatchError) return cause;
	return new PromptDispatchError(stage, errorMessage(cause, fallback), { cause });
}

export function promptDispatchStage(error: unknown): PromptDispatchStage {
	return error instanceof PromptDispatchError ? error.stage : 'deliver';
}
