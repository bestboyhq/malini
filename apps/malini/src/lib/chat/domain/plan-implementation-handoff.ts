export function buildImplementationHandoffPrompt(input: {
	plan: string;
	originalRequest?: string | null;
}): string {
	const plan = input.plan.trim();
	if (!plan) throw new Error('Approved plan cannot be empty');
	const originalRequest = input.originalRequest?.trim() ?? '';
	return [
		'Implement the approved plan below in this fresh implementation chat.',
		'Treat the plan as the authoritative execution outline. Preserve the original request as context, verify assumptions against the worktree, and report any necessary deviation explicitly.',
		...(originalRequest
			? ['ORIGINAL REQUEST', '---', originalRequest]
			: ['ORIGINAL REQUEST', '---', 'No persisted original request was available.']),
		'APPROVED PLAN',
		'---',
		plan,
	].join('\n\n');
}
