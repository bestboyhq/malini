import { normalizeRememberedClaudeAccounts } from '$shared/providers/domain/claude-accounts';

const CLAUDE_ACCOUNTS_KEY = 'malini.providers.claude-accounts:v1';

class ClaudeAccountsStorage {
	read(storage: Pick<Storage, 'getItem'> | null = browserStorage()): string[] {
		try {
			const raw = storage?.getItem(CLAUDE_ACCOUNTS_KEY);
			return normalizeRememberedClaudeAccounts(raw ? JSON.parse(raw) : null);
		} catch {
			return [];
		}
	}

	write(
		remembered: readonly string[],
		storage: Pick<Storage, 'setItem'> | null = browserStorage(),
	): void {
		try {
			storage?.setItem(CLAUDE_ACCOUNTS_KEY, JSON.stringify(remembered));
		} catch {}
	}
}

export const claudeAccountsStorage = new ClaudeAccountsStorage();

function browserStorage(): Storage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}
