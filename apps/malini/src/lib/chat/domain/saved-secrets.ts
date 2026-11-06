import type { SecretsSavedEvent } from '$contract/secrets';

export type SavedSecretsWake = Readonly<{ saved: string | null; rest: string }>;

const EVERY_REPOSITORY = 'every repository';
const SECTION_BREAK = '\n\n';
const SAVED_LINE = /^Saved (.+?) for (.+?): \$/u;
const UNSAVED_LINE = /^(.+?) (?:was|were) left empty, /u;

export function savedSecretsPrompt(
	saved: Pick<SecretsSavedEvent, 'names' | 'unsaved' | 'repository'>,
): string {
	const one = saved.names.length === 1;
	const lines = [
		`Saved ${listed(saved.names)} for ${saved.repository ?? EVERY_REPOSITORY}: ${listed(saved.names.map((name) => `$${name}`))} ${one ? 'is' : 'are'} set in every command you run from now on, and Malini masks ${one ? 'its value' : 'their values'} as [secret] in every output.`,
	];
	if (saved.unsaved.length > 0) {
		lines.push(
			`${listed(saved.unsaved)} ${saved.unsaved.length === 1 ? 'was' : 'were'} left empty, so ${saved.unsaved.length === 1 ? 'it is' : 'they are'} still not set.`,
		);
	}
	return lines.join('\n');
}

export function savedSecretsWake(prompt: string): SavedSecretsWake {
	const sections = prompt.split(SECTION_BREAK);
	const saved = sections.map(savedNames);
	const names = saved.flatMap((section) => section ?? []);
	return {
		saved: names.length === 0 ? null : listed(names),
		rest: sections.filter((_, index) => saved[index] === null).join(SECTION_BREAK),
	};
}

function savedNames(section: string): readonly string[] | null {
	const [savedLine = '', unsavedLine = ''] = section.split('\n');
	const match = SAVED_LINE.exec(savedLine);
	if (!match) return null;
	const names = listedNames(match[1]);
	const repository = match[2] === EVERY_REPOSITORY ? null : (match[2] ?? null);
	const unsaved = listedNames(UNSAVED_LINE.exec(unsavedLine)?.[1]);
	return savedSecretsPrompt({ names, unsaved, repository }) === section ? names : null;
}

function listedNames(list: string | undefined): string[] {
	return list === undefined ? [] : list.split(/, | and /u);
}

function listed(items: readonly string[]): string {
	if (items.length <= 1) return items.join('');
	return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}
