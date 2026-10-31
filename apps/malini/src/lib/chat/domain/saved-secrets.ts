import type { SecretsSavedEvent } from '$contract/secrets';

export function savedSecretsPrompt(
	saved: Pick<SecretsSavedEvent, 'names' | 'unsaved' | 'repository'>,
): string {
	const one = saved.names.length === 1;
	const lines = [
		`Saved ${listed(saved.names)} for ${saved.repository ?? 'every repository'}: ${listed(saved.names.map((name) => `$${name}`))} ${one ? 'is' : 'are'} set in every command you run from now on, and Malini masks ${one ? 'its value' : 'their values'} as [secret] in every output.`,
	];
	if (saved.unsaved.length > 0) {
		lines.push(
			`${listed(saved.unsaved)} ${saved.unsaved.length === 1 ? 'was' : 'were'} left empty, so ${saved.unsaved.length === 1 ? 'it is' : 'they are'} still not set.`,
		);
	}
	return lines.join('\n');
}

function listed(items: readonly string[]): string {
	if (items.length <= 1) return items.join('');
	return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}
