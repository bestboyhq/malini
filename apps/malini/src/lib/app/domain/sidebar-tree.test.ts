import { describe, expect, it } from 'vitest';
import { parseLeadScope } from '$shared/repositories/domain/lead-scope';
import { connectedRepositoryContexts } from '$shared/repositories/domain/repository-context';
import type { Repository } from '$shared/repositories/domain/repository';
import type { Workstream } from '$shared/repositories/domain/workstream';
import { DEFAULT_SIDEBAR_ARRANGEMENT, type SidebarArrangement } from './sidebar-arrangement';
import { ALL_FOCUS, type SidebarFocus } from './sidebar-focus';
import type { SidebarSectionKey } from './sidebar-sections';
import {
	sidebarTree,
	sidebarWorkstreamIds,
	type SidebarBranch,
	type SidebarTree,
} from './sidebar-tree';

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
	createdAt = '2026-10-24T00:00:00.000Z',
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
	createdAt,
	activeAt: createdAt,
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

const SECTIONS: Readonly<Record<string, SidebarSectionKey>> = {
	'home-lead': 'needs-you',
	'api-work': 'needs-you',
	'web-from-home': 'needs-you',
	'site-from-home': 'in-progress',
	'api-follow-up': 'in-progress',
};

const activeAt = (workstream: Workstream): number => Date.parse(workstream.activeAt);

const sectionOf = (workstream: Workstream): SidebarSectionKey => SECTIONS[workstream.id] ?? 'idle';

function tree(
	focus: SidebarFocus = ALL_FOCUS,
	hidden: readonly string[] = [],
	arrangement: SidebarArrangement = DEFAULT_SIDEBAR_ARRANGEMENT,
): SidebarTree {
	return sidebarTree({
		contexts: connectedRepositoryContexts({
			repositories: REPOSITORIES,
			workstreams: WORKSTREAMS,
		}),
		leads: LEADS,
		hiddenRepositoryIds: new Set(hidden),
		focus,
		arrangement,
		activeAt,
		sectionOf,
	});
}

function arranged(change: Partial<SidebarArrangement>): SidebarArrangement {
	return { ...DEFAULT_SIDEBAR_ARRANGEMENT, ...change };
}

function outline(sidebar: SidebarTree): string[] {
	return [
		...branchOutline(sidebar),
		...sidebar.sections.flatMap((section) => [
			`section ${section.label}`,
			...branchOutline(section).map((line) => `  ${line}`),
		]),
	];
}

function branchOutline(sidebar: SidebarBranch): string[] {
	const workstreams = (items: readonly Workstream[], depth: number): string[] =>
		items.map((workstream) => `${'  '.repeat(depth)}${workstream.id}`);
	const chats = (items: readonly Workstream[], depth: number): string[] =>
		items.map((lead) => `${'  '.repeat(depth)}${lead.scope === null ? '' : 'chat '}${lead.id}`);
	return [
		...chats(sidebar.chats, 0),
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

	it('groups by repository: no owner folders, and every chat above the repositories', () => {
		const byRepository = arranged({ grouping: 'repository' });
		expect(outline(tree(ALL_FOCUS, [], byRepository))).toEqual([
			'chat home-lead',
			'chat acme-lead',
			'repository acme/api',
			'  api-work',
			'  api-follow-up',
			'  api-follow-up-check',
			'  api-from-acme',
			'repository acme/web',
			'  web-from-home',
			'repository acme/idle',
			'repository solo/site',
			'  site-from-home',
			'repository folder',
			'  folder-work',
			'repository logdash/sdk',
			'  sdk-from-api',
		]);
		const acme: SidebarFocus = { kind: 'owner', owner: 'acme' };
		expect(outline(tree(acme, [], byRepository))).toEqual(outline(tree(acme)));
	});

	it('orders every level by name', () => {
		expect(outline(tree(ALL_FOCUS, [], arranged({ ordering: 'name' })))).toEqual([
			'chat home-lead',
			'owner acme',
			'  chat acme-lead',
			'  repository acme/api',
			'    api-follow-up',
			'    api-follow-up-check',
			'    api-from-acme',
			'    api-work',
			'  repository acme/idle',
			'  repository acme/web',
			'    web-from-home',
			'repository folder',
			'  folder-work',
			'owner logdash',
			'  repository logdash/sdk',
			'    sdk-from-api',
			'owner solo',
			'  repository solo/site',
			'    site-from-home',
		]);
	});

	it('orders newest first, a group by the newest work in it', () => {
		const at = (hour: number): string => `2026-10-25T${String(hour).padStart(2, '0')}:00:00.000Z`;
		const sidebar = sidebarTree({
			contexts: connectedRepositoryContexts({
				repositories: ['acme/api', 'acme/web', 'solo/site'].map(repo),
				workstreams: [
					stream('old-api', 'acme/api', null, null, at(8)),
					stream('new-site', 'solo/site', null, null, at(10)),
					stream('new-api', 'acme/api', null, null, at(9)),
				],
			}),
			leads: [
				stream('old-chat', 'lead', null, 'home', at(7)),
				stream('new-chat', 'lead', null, 'home', at(11)),
			],
			hiddenRepositoryIds: new Set(),
			focus: ALL_FOCUS,
			arrangement: arranged({ ordering: 'newest' }),
			activeAt,
			sectionOf,
		});
		expect(outline(sidebar)).toEqual([
			'chat new-chat',
			'chat old-chat',
			'owner solo',
			'  repository solo/site',
			'    new-site',
			'owner acme',
			'  repository acme/api',
			'    new-api',
			'    old-api',
			'  repository acme/web',
		]);
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

	it('splits by status into sections, each listing only the repositories with work in it', () => {
		const byStatus = arranged({ grouping: 'status', subgrouping: 'owner' });
		expect(outline(tree(ALL_FOCUS, [], byStatus))).toEqual([
			'section Needs you',
			'  chat home-lead',
			'  owner acme',
			'    repository acme/api',
			'      api-work',
			'    repository acme/web',
			'      web-from-home',
			'section In progress',
			'  owner acme',
			'    repository acme/api',
			'      api-follow-up',
			'  owner solo',
			'    repository solo/site',
			'      site-from-home',
			'section Idle',
			'  owner acme',
			'    chat acme-lead',
			'    repository acme/api',
			'      api-follow-up-check',
			'      api-from-acme',
			'  repository folder',
			'    folder-work',
			'  owner logdash',
			'    repository logdash/sdk',
			'      sdk-from-api',
		]);
	});

	it('sub-groups a section by repository, with its chats on top', () => {
		const sidebar = tree(
			ALL_FOCUS,
			[],
			arranged({ grouping: 'status', subgrouping: 'repository' }),
		);
		expect(outline(sidebar).slice(0, 6)).toEqual([
			'section Needs you',
			'  chat home-lead',
			'  repository acme/api',
			'    api-work',
			'  repository acme/web',
			'    web-from-home',
		]);
	});

	it('lists a section flat, chats and workstreams together, most recently active first', () => {
		const at = (hour: number): string => `2026-10-25T${String(hour).padStart(2, '0')}:00:00.000Z`;
		const sidebar = sidebarTree({
			contexts: connectedRepositoryContexts({
				repositories: ['acme/api', 'solo/site'].map(repo),
				workstreams: [
					stream('old-api', 'acme/api', null, null, at(8)),
					stream('new-site', 'solo/site', null, null, at(10)),
				],
			}),
			leads: [stream('chat', 'lead', null, 'home', at(9))],
			hiddenRepositoryIds: new Set(),
			focus: ALL_FOCUS,
			arrangement: { grouping: 'day', subgrouping: 'none', ordering: 'active' },
			activeAt,
			sectionOf: (workstream) => (workstream.id === 'old-api' ? 'yesterday' : 'today'),
		});
		expect(outline(sidebar)).toEqual([
			'section Today',
			'  new-site',
			'  chat chat',
			'section Yesterday',
			'  old-api',
		]);
	});

	it('lists a focused repository flat in every section', () => {
		const api: SidebarFocus = { kind: 'repository', repositoryId: 'acme/api' };
		expect(outline(tree(api, [], arranged({ grouping: 'status' })))).toEqual([
			'section Needs you',
			'  api-work',
			'section In progress',
			'  api-follow-up',
			'section Idle',
			'  api-follow-up-check',
			'  api-from-acme',
		]);
	});

	it('lists every workstream in the sections once', () => {
		expect(
			sidebarWorkstreamIds(tree(ALL_FOCUS, [], arranged({ grouping: 'status' }))).sort(),
		).toEqual(sidebarWorkstreamIds(tree()).sort());
	});
});
