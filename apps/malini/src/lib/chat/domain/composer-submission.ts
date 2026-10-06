import type { PromptRequest } from '$lib/chat/domain/prompt-submission';

export type ComposerSubmission = Readonly<{
	draftScope: string;
	draftPrompt: string;
	freshIntentKey: string;
	request: PromptRequest;
}>;
