import type { SavedSecret } from '$contract/secrets';

export type SecretGroup = Readonly<{ repository: string | null; secrets: readonly SavedSecret[] }>;

export function secretGroups(secrets: readonly SavedSecret[]): SecretGroup[] {
	const groups = new Map<string, SavedSecret[]>();
	for (const secret of secrets) {
		const key = secret.repository?.toLowerCase() ?? '';
		groups.set(key, [...(groups.get(key) ?? []), secret]);
	}
	return [...groups.entries()]
		.sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
		.map(([, grouped]) => ({ repository: grouped[0]?.repository ?? null, secrets: grouped }));
}
