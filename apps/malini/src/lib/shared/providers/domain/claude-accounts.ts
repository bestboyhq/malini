export type ClaudeSignInState = 'idle' | 'waiting-for-browser' | 'confirming';

export const MAX_REMEMBERED_CLAUDE_ACCOUNTS = 5;

export function rememberClaudeAccount(remembered: readonly string[], email: string): string[] {
	return [email, ...remembered.filter((known) => known !== email)].slice(
		0,
		MAX_REMEMBERED_CLAUDE_ACCOUNTS,
	);
}

export function otherClaudeAccounts(
	remembered: readonly string[],
	current: string | null,
): string[] {
	return remembered.filter((email) => email !== current);
}

export function normalizeRememberedClaudeAccounts(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.filter((email): email is string => typeof email === 'string' && email.includes('@'))
		.reduceRight<string[]>((remembered, email) => rememberClaudeAccount(remembered, email), []);
}
