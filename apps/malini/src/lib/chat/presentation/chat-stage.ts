export type ChatStage = 'fresh' | 'transcript' | 'error' | 'cold' | 'empty';

export function chatStage(input: {
	freshChat: boolean;
	presentedSessionId: string | null;
	bootError: string | null;
	presentationPending: boolean;
}): ChatStage {
	if (input.freshChat) return 'fresh';
	if (input.presentedSessionId && !input.bootError) return 'transcript';
	if (input.bootError) return 'error';
	if (input.presentationPending) return 'cold';
	return 'empty';
}
