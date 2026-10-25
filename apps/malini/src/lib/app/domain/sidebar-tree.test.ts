import { describe, expect, it } from 'vitest';
import { parseLeadScope } from '$shared/repositories/domain/lead-scope';
import { connectedRepositoryContexts } from '$shared/repositories/domain/repository-context';
import type { Repository } from '$shared/repositories/domain/repository';
import type { Workstream } from '$shared/repositories/domain/workstream';
import { ALL_FOCUS, type SidebarFocus } from './sidebar-focus';
import { sidebarTree, sidebarWorkstreamIds, type SidebarTree } from './sidebar-tree';

const repo = (fullName: string): Repository => ({
	id: fullName,
	fullName,
	defaultBranch: 'main',
	localPath: null,
	remoteUrl: null,
	createdAt: '2026-10-24T00:00:00.000Z',
});

const stream = (
	id: string,
	repository: string,
	startedBy: string | null = null,
	scope: string | null = null,
): Workstream => ({
	id,
	projectId: `local__${repository.replace('/', '__')}`,
	name: id,
	path: `/tmp/malini/workstreams/${id}`,
	branch: `malini/${id}`,
	baseBranch: 'main',
	status: 'active',
	checkoutState: 'healthy',
	checkoutIssue: null,
	resolvedPath: null,
	scope: parseLeadScope(scope),
	startedBy,
});

const REPOSITORIES = [
	'acme/api',
	'acme/web',
	'acme/idle',
	'solo/site',
	'folder',
	'logdash/sdk',
].map(repo);

const LEADS = [
	stream('home-lead', 'lead', null, 'home'),
	stream('acme-lead', 'lead', null, 'owner:acme'),
];

const WORKSTREAMS = [
	stream('api-work', 'acme/api'),
	stream('api-follow-up', 'acme/api', 'api-work'),
	stream('api-follow-up-check', 'acme/api', 'api-follow-up'),
	stream('web-from-home', 'acme/web', 'home-lead'),
	stream('site-from-home', 'solo/site', 'home-lead'),
	stream('api-from-acme', 'acme/api', 'acme-lead'),
	stream('folder-work', 'folder'),
	stream('sdk-from-api', 'logdash/sdk', 'api-work'),
];

function tree(focus: SidebarFocus = ALL_FOCUS, hidden: readonly string[] = []): SidebarTree {
	return sidebarTree({
		contexts: connectedRepositoryContexts({
			repositories: REPOSITORIES,
			workstreams: WORKSTREAMS,
		}),
		leads: LEADS,
		hiddenRepositoryIds: new Set(hidden),
		focus,
	});
}

function outline(sidebar: SidebarTree): string[] {
	const workstreams = (items: readonly Workstream[], depth: number): string[] =>
		items.map((workstream) => `${'  '.repeat(depth)}${workstream.id}`);
	const chats = (items: readonly Workstream[], depth: number): string[] =>
		items.map((lead) => `${'  '.repeat(depth)}chat ${lead.id}`);
	return [
		...chats(sidebar.homeLeads, 0),
		...sidebar.blocks.flatMap((block) =>
			block.kind === 'owner'
				? [
						`owner ${block.owner}`,
						...chats(block.leads, 1),
						...block.repositories.flatMap((repository) => [
							`  repository ${repository.repo.fullName}`,
							...workstreams(repository.workstreams, 2),
						]),
					]
				: [
						`repository ${block.repository.repo.fullName}`,
						...workstreams(block.repository.workstreams, 1),
					],
		),
	];
}

describe('sidebarTree', () => {
	it('puts Home chats first, then one block per owner, with every workstream under its repository', () => {
		expect(outline(tree())).toEqual([
			'chat home-lead',
			'owner acme',
			'  chat acme-lead',
			'  repository acme/api',
			'    api-work',
			'    api-follow-up',
			'    api-follow-up-check',
			'    api-from-acme',
			'  repository acme/web',
			'    web-from-home',
			'  repository acme/idle',
			'owner solo',
			'  repository solo/site',
			'    site-from-home',
			'repository folder',
			'  folder-work',
			'owner logdash',
			'  repository logdash/sdk',
			'    sdk-from-api',
		]);
	});

	it('focuses on one owner, with its chats and repositories', () => {
		expect(outline(tree({ kind: 'owner', owner: 'ACME' }))).toEqual([
			'owner ACME',
			'  chat acme-lead',
			'  repository acme/api',
			'    api-work',
			'    api-follow-up',
			'    api-follow-up-check',
			'    api-from-acme',
			'  repository acme/web',
			'    web-from-home',
			'  repository acme/idle',
		]);
	});

	it('focuses on one repository, with every workstream in it and no chats', () => {
		expect(outline(tree({ kind: 'repository', repositoryId: 'logdash/sdk' }))).toEqual([
			'repository logdash/sdk',
			'  sdk-from-api',
		]);
	});

	it('lists an unhidden repository without work, and keeps a hidden one out with its work', () => {
		expect(outline(tree())).toContain('  repository acme/idle');
		expect(outline(tree(ALL_FOCUS, ['acme/idle', 'acme/web']))).not.toContain(
			'  repository acme/idle',
		);
		expect(outline(tree(ALL_FOCUS, ['acme/web']))).not.toContain('    web-from-home');
	});

	it('lists every listed workstream once, in order', () => {
		expect(sidebarWorkstreamIds(tree())).toEqual([
			'home-lead',
			'acme-lead',
			'api-work',
			'api-follow-up',
			'api-follow-up-check',
			'api-from-acme',
			'web-from-home',
			'site-from-home',
			'folder-work',
			'sdk-from-api',
		]);
	});
});
