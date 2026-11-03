import { describe, expect, it } from 'vitest';
import type { GithubRepository, Repository } from '$shared/repositories/domain/repository';
import {
	commandCenterGroups,
	findableRepositories,
	type CommandCenterSearch,
} from './command-center';

function repository(fullName: string, description: string | null = null): GithubRepository {
	return {
		fullName,
		description,
		cloneUrl: `https://github.com/${fullName}.git`,
		private: false,
		pushedAt: null,
	};
}

const REPOSITORIES = [
	repository('bestboyhq/malini', 'Agents in workstreams'),
	repository('bestboyhq/grip'),
	repository('szymeo/dotfiles'),
];

function search(overrides: Partial<CommandCenterSearch>): CommandCenterSearch {
	return {
		mode: 'commands',
		query: '',
		repositories: REPOSITORIES,
		inWorkstream: true,
		...overrides,
	};
}

function names(groups: ReturnType<typeof commandCenterGroups>): readonly string[][] {
	return groups.map((group) =>
		group.entries.map((entry) => {
			if (entry.kind === 'command') return entry.command.label;
			if (entry.kind === 'repository') return entry.repository.fullName;
			if (entry.kind === 'clone-url') return entry.url;
			return `create ${entry.name}`;
		}),
	);
}

describe('the command center', () => {
	it('lists every command, and New chat only inside a workstream', () => {
		expect(names(commandCenterGroups(search({})))).toEqual([
			['Find a repository', 'New repository', 'Open a folder', 'New chat', 'Settings'],
		]);
		expect(names(commandCenterGroups(search({ inWorkstream: false }))).flat()).not.toContain(
			'New chat',
		);
	});

	it('finds commands and repositories from one search', () => {
		const groups = commandCenterGroups(search({ query: 'bestboy' }));
		expect(groups.map((group) => group.heading)).toEqual(['Your repositories']);
		expect(names(groups)).toEqual([['bestboyhq/malini', 'bestboyhq/grip']]);
		expect(names(commandCenterGroups(search({ query: 'new' })))).toEqual([
			['New repository', 'New chat'],
		]);
	});

	it('searches names and descriptions on every word while finding', () => {
		expect(names(commandCenterGroups(search({ mode: 'find', query: 'agents malini' })))).toEqual([
			['bestboyhq/malini'],
		]);
		expect(commandCenterGroups(search({ mode: 'find', query: 'grip' }))[0]?.heading).toBe(
			'1 found',
		);
		expect(commandCenterGroups(search({ mode: 'find' }))[0]?.heading).toBe('Newest push first');
	});

	it('offers to make a repository that nothing matches, and waits for the list', () => {
		expect(names(commandCenterGroups(search({ mode: 'find', query: 'rabbit den' })))).toEqual([
			['create rabbit den'],
		]);
		expect(commandCenterGroups(search({ mode: 'find', repositories: null }))).toEqual([]);
	});

	it('takes a pasted URL in any mode but New repository', () => {
		const url = 'git@github.com:bestboyhq/malini.git';
		expect(names(commandCenterGroups(search({ query: url })))).toEqual([[url]]);
		expect(
			names(commandCenterGroups(search({ mode: 'find', query: url, repositories: null }))),
		).toEqual([[url]]);
		expect(commandCenterGroups(search({ mode: 'new-repository', query: url }))).toEqual([]);
	});

	it('finds the repositories you already have that GitHub does not list, after the listed ones', () => {
		const connected: Repository[] = [
			{
				id: 'gh:bestboyhq/malini',
				fullName: 'BestboyHQ/Malini',
				defaultBranch: 'main',
				localPath: null,
				remoteUrl: 'https://github.com/bestboyhq/malini.git',
				createdAt: '',
			},
			{
				id: 'local:local__alpha',
				fullName: 'local/alpha',
				defaultBranch: 'main',
				localPath: '/Users/ada/alpha',
				remoteUrl: null,
				createdAt: '',
			},
		];
		expect(findableRepositories(REPOSITORIES, connected)?.map(({ fullName }) => fullName)).toEqual([
			'bestboyhq/malini',
			'bestboyhq/grip',
			'szymeo/dotfiles',
			'local/alpha',
		]);
		expect(findableRepositories(null, connected)).toBeNull();
	});
});
