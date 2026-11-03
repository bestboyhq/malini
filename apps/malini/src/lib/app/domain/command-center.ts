import type { GithubRepository, Repository } from '$shared/repositories/domain/repository';
import { isCloneUrl } from '$shared/repositories/domain/repository-connection';

export type CommandCenterMode = 'commands' | 'find' | 'new-repository';

export type CommandCenterCommand = Readonly<{
	id: 'find' | 'new-repository' | 'open-folder' | 'new-chat' | 'settings';
	label: string;
	keys: readonly string[];
}>;

export type CommandCenterEntry =
	| Readonly<{ kind: 'command'; command: CommandCenterCommand }>
	| Readonly<{ kind: 'repository'; repository: GithubRepository }>
	| Readonly<{ kind: 'clone-url'; url: string }>
	| Readonly<{ kind: 'create'; name: string }>;

export type CommandCenterGroup = Readonly<{
	heading: string | null;
	entries: readonly CommandCenterEntry[];
}>;

export type CommandCenterSearch = Readonly<{
	mode: CommandCenterMode;
	query: string;
	repositories: readonly GithubRepository[] | null;
	inWorkstream: boolean;
}>;

export const COMMAND_CENTER_COMMANDS: readonly CommandCenterCommand[] = [
	{ id: 'find', label: 'Find a repository', keys: [] },
	{ id: 'new-repository', label: 'New repository', keys: [] },
	{ id: 'open-folder', label: 'Open a folder', keys: ['⌘', 'O'] },
	{ id: 'new-chat', label: 'New chat', keys: ['⌘', 'T'] },
	{ id: 'settings', label: 'Settings', keys: ['⌘', ','] },
];

const REPOSITORIES_BESIDE_COMMANDS = 5;

export function commandCenterGroups(search: CommandCenterSearch): readonly CommandCenterGroup[] {
	const typed = search.query.trim();
	if (search.mode === 'new-repository') return [];
	if (isCloneUrl(typed)) return [{ heading: null, entries: [{ kind: 'clone-url', url: typed }] }];
	const terms = typed.toLowerCase().split(/\s+/u).filter(Boolean);
	const found = (search.repositories ?? []).filter((repository) => {
		const text = `${repository.fullName} ${repository.description ?? ''}`.toLowerCase();
		return terms.every((term) => text.includes(term));
	});
	if (search.mode === 'find') {
		if (search.repositories === null) return [];
		if (found.length === 0) return [{ heading: null, entries: [{ kind: 'create', name: typed }] }];
		return [
			{
				heading: terms.length > 0 ? `${found.length} found` : 'Newest push first',
				entries: found.map(repositoryEntry),
			},
		];
	}
	const commands = COMMAND_CENTER_COMMANDS.filter(
		(command) =>
			(search.inWorkstream || command.id !== 'new-chat') &&
			terms.every((term) => command.label.toLowerCase().includes(term)),
	);
	const groups: CommandCenterGroup[] = [];
	if (commands.length > 0) {
		groups.push({
			heading: 'Commands',
			entries: commands.map((command) => ({ kind: 'command', command })),
		});
	}
	if (terms.length > 0 && found.length > 0) {
		groups.push({
			heading: 'Your repositories',
			entries: found.slice(0, REPOSITORIES_BESIDE_COMMANDS).map(repositoryEntry),
		});
	}
	return groups;
}

export function findableRepositories(
	github: readonly GithubRepository[] | null,
	connected: readonly Repository[],
): readonly GithubRepository[] | null {
	if (github === null) return null;
	const listed = new Set(github.map((repository) => repository.fullName.toLowerCase()));
	const elsewhere = connected
		.filter((repository) => !listed.has(repository.fullName.toLowerCase()))
		.map((repository) => ({
			fullName: repository.fullName,
			description: null,
			cloneUrl: repository.remoteUrl ?? '',
			private: false,
			pushedAt: null,
		}));
	return [...github, ...elsewhere];
}

function repositoryEntry(repository: GithubRepository): CommandCenterEntry {
	return { kind: 'repository', repository };
}
