import { describe, expect, it } from 'vitest';
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

const WORKSTREAMS = [
	stream('api-work', 'acme/api'),
	stream('api-follow-up', 'acme/api', 'api-work'),
	stream('api-follow-up-check', 'acme/api', 'api-follow-up'),
	stream('web-from-api', 'acme/web', 'api-work'),
	stream('site-work', 'solo/site'),
	stream('site-from-site', 'solo/site', 'site-work'),
	stream('folder-work', 'folder'),
	stream('sdk-from-api', 'logdash/sdk', 'api-work'),
	stream('sdk-work', 'logdash/sdk'),
];

const SECTIONS: Readonly<Record<string, SidebarSectionKey>> = {
	'api-work': 'needs-you',
	'api-follow-up': 'needs-you',
	'api-follow-up-check': 'needs-you',
	'web-from-api': 'needs-you',
	'sdk-from-api': 'needs-you',
	'site-work': 'in-progress',
	'site-from-site': 'in-progress',
};

const activeAt = (workstream: Workstream): number => Date.parse(workstream.activeAt);

const sectionOf = (workstream: Workstream): SidebarSectionKey => SECTIONS[workstream.id] ?? 'idle';

function tree(
	focus: SidebarFocus = ALL_FOCUS,
	hidden: readonly string[] = [],
	arrangement: SidebarArrangement = DEFAULT_SIDEBAR_ARRANGEMENT,
	workstreams: readonly Workstream[] = WORKSTREAMS,
): SidebarTree {
	return sidebarTree({
		contexts: connectedRepositoryContexts({ repositories: REPOSITORIES, workstreams }),
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
	const rows = (items: readonly Workstream[], depth: number): string[] =>
		items.map((workstream) => `${'  '.repeat(depth)}${workstream.id}`);
	return [
		...rows(sidebar.flat, 0),
		...sidebar.blocks.flatMap((block) =>
			block.kind === 'owner'
				? [
						`owner ${block.owner}`,
						...block.repositories.flatMap((repository) => [
							`  repository ${repository.repo.fullName}`,
							...rows(repository.workstreams, 2),
						]),
					]
				: [
						`repository ${block.repository.repo.fullName}`,
						...rows(block.repository.workstreams, 1),
					],
		),
	];
}

describe('sidebarTree', () => {
	it('lists one block per owner, with every workstream under its own repository', () => {
		expect(outline(tree())).toEqual([
			'owner acme',
			'  repository acme/api',
			'    api-work',
			'    api-follow-up',
			'    api-follow-up-check',
			'  repository acme/web',
			'    web-from-api',
			'  repository acme/idle',
			'owner solo',
			'  repository solo/site',
			'    site-work',
			'    site-from-site',
			'repository folder',
			'  folder-work',
			'owner logdash',
			'  repository logdash/sdk',
			'    sdk-from-api',
			'    sdk-work',
		]);
	});

	it('focuses on one owner, with its repositories', () => {
		expect(outline(tree({ kind: 'owner', owner: 'ACME' }))).toEqual([
			'owner acme',
			'  repository acme/api',
			'    api-work',
			'    api-follow-up',
			'    api-follow-up-check',
			'  repository acme/web',
			'    web-from-api',
			'  repository acme/idle',
		]);
	});

	it('lists every workstream of a startedBy cycle under its repository', () => {
		const cycle = [
			stream('ping', 'acme/api', 'pong'),
			stream('pong', 'acme/api', 'ping'),
			stream('pong-check', 'acme/api', 'pong'),
		];
		expect(outline(tree(ALL_FOCUS, [], DEFAULT_SIDEBAR_ARRANGEMENT, cycle)).slice(0, 7)).toEqual([
			'owner acme',
			'  repository acme/api',
			'    ping',
			'    pong',
			'    pong-check',
			'  repository acme/web',
			'  repository acme/idle',
		]);
	});

	it('focuses on one repository, with every workstream in it', () => {
		expect(outline(tree({ kind: 'repository', repositoryId: 'logdash/sdk' }))).toEqual([
			'repository logdash/sdk',
			'  sdk-from-api',
			'  sdk-work',
		]);
	});

	it('lists an unhidden repository without work, and keeps a hidden one out with its work', () => {
		expect(outline(tree())).toContain('  repository acme/idle');
		expect(outline(tree(ALL_FOCUS, ['acme/idle', 'acme/web']))).not.toContain(
			'  repository acme/idle',
		);
		expect(sidebarWorkstreamIds(tree(ALL_FOCUS, ['acme/web']))).not.toContain('web-from-api');
	});

	it('groups by repository: no owner folders', () => {
		const byRepository = arranged({ grouping: 'repository' });
		expect(outline(tree(ALL_FOCUS, [], byRepository))).toEqual([
			'repository acme/api',
			'  api-work',
			'  api-follow-up',
			'  api-follow-up-check',
			'repository acme/web',
			'  web-from-api',
			'repository acme/idle',
			'repository solo/site',
			'  site-work',
			'  site-from-site',
			'repository folder',
			'  folder-work',
			'repository logdash/sdk',
			'  sdk-from-api',
			'  sdk-work',
		]);
		const acme: SidebarFocus = { kind: 'owner', owner: 'acme' };
		expect(outline(tree(acme, [], byRepository))).toEqual(outline(tree(acme)));
	});

	it('orders every level by name', () => {
		const named = (id: string, repository: string, startedBy: string | null = null) => ({
			...stream(id, repository, startedBy),
			name: id.replace(/^[a-z]+-/u, ''),
		});
		const workstreams = [
			named('api-zeta', 'acme/api'),
			named('api-alpha', 'acme/api'),
			named('sdk-aaa', 'logdash/sdk', 'api-zeta'),
			named('api-beta', 'acme/api', 'api-zeta'),
		];
		expect(outline(tree(ALL_FOCUS, [], arranged({ ordering: 'name' }), workstreams))).toEqual([
			'owner acme',
			'  repository acme/api',
			'    api-alpha',
			'    api-beta',
			'    api-zeta',
			'  repository acme/idle',
			'  repository acme/web',
			'repository folder',
			'owner logdash',
			'  repository logdash/sdk',
			'    sdk-aaa',
			'owner solo',
			'  repository solo/site',
		]);
	});

	it('orders newest first, a group by the newest work in it', () => {
		const at = (hour: number): string => `2026-10-25T${String(hour).padStart(2, '0')}:00:00.000Z`;
		const sidebar = sidebarTree({
			contexts: connectedRepositoryContexts({
				repositories: ['acme/api', 'acme/web', 'solo/site'].map(repo),
				workstreams: [
					stream('old-api', 'acme/api', null, at(8)),
					stream('new-site', 'solo/site', null, at(10)),
					stream('new-api', 'acme/api', null, at(9)),
				],
			}),
			hiddenRepositoryIds: new Set(),
			focus: ALL_FOCUS,
			arrangement: arranged({ ordering: 'newest' }),
			activeAt,
			sectionOf,
		});
		expect(outline(sidebar)).toEqual([
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
			'api-work',
			'api-follow-up',
			'api-follow-up-check',
			'web-from-api',
			'site-work',
			'site-from-site',
			'folder-work',
			'sdk-from-api',
			'sdk-work',
		]);
	});

	it('splits by status into sections, each listing only the repositories with work in it', () => {
		const byStatus = arranged({ grouping: 'status', subgrouping: 'owner' });
		expect(outline(tree(ALL_FOCUS, [], byStatus))).toEqual([
			'section Needs you',
			'  owner acme',
			'    repository acme/api',
			'      api-work',
			'      api-follow-up',
			'      api-follow-up-check',
			'    repository acme/web',
			'      web-from-api',
			'  owner logdash',
			'    repository logdash/sdk',
			'      sdk-from-api',
			'section In progress',
			'  owner solo',
			'    repository solo/site',
			'      site-work',
			'      site-from-site',
			'section Idle',
			'  repository folder',
			'    folder-work',
			'  owner logdash',
			'    repository logdash/sdk',
			'      sdk-work',
		]);
	});

	it('keeps only the sections that need you and counts what it hides', () => {
		const attention = arranged({ grouping: 'status', subgrouping: 'none', show: 'attention' });
		const sidebar = tree(ALL_FOCUS, [], attention);
		expect(outline(sidebar)).toEqual([
			'section Needs you',
			'  api-work',
			'  api-follow-up',
			'  api-follow-up-check',
			'  web-from-api',
			'  sdk-from-api',
		]);
		expect(sidebar.hidden).toBe(
			sidebarWorkstreamIds(tree(ALL_FOCUS, [], arranged({ grouping: 'status' }))).length -
				sidebarWorkstreamIds(sidebar).length,
		);
		expect(sidebar.hidden).toBeGreaterThan(0);
	});

	it('hides nothing when it shows everything', () => {
		expect(tree(ALL_FOCUS, [], arranged({ grouping: 'status' })).hidden).toBe(0);
	});

	it('sub-groups a section by repository', () => {
		const sidebar = tree(
			ALL_FOCUS,
			[],
			arranged({ grouping: 'status', subgrouping: 'repository' }),
		);
		expect(outline(sidebar).slice(0, 8)).toEqual([
			'section Needs you',
			'  repository acme/api',
			'    api-work',
			'    api-follow-up',
			'    api-follow-up-check',
			'  repository acme/web',
			'    web-from-api',
			'  repository logdash/sdk',
		]);
	});

	it('lists a section flat, most recently active first', () => {
		const at = (hour: number): string => `2026-10-25T${String(hour).padStart(2, '0')}:00:00.000Z`;
		const sidebar = sidebarTree({
			contexts: connectedRepositoryContexts({
				repositories: ['acme/api', 'solo/site'].map(repo),
				workstreams: [
					stream('old-api', 'acme/api', null, at(8)),
					stream('new-site', 'solo/site', null, at(10)),
					stream('mid-site', 'solo/site', null, at(9)),
				],
			}),
			hiddenRepositoryIds: new Set(),
			focus: ALL_FOCUS,
			arrangement: arranged({ grouping: 'day', subgrouping: 'none', ordering: 'active' }),
			activeAt,
			sectionOf: (workstream) => (workstream.id === 'old-api' ? 'yesterday' : 'today'),
		});
		expect(outline(sidebar)).toEqual([
			'section Today',
			'  new-site',
			'  mid-site',
			'section Yesterday',
			'  old-api',
		]);
	});

	it('lists a focused repository flat in every section', () => {
		const api: SidebarFocus = { kind: 'repository', repositoryId: 'acme/api' };
		expect(outline(tree(api, [], arranged({ grouping: 'status' })))).toEqual([
			'section Needs you',
			'  api-work',
			'  api-follow-up',
			'  api-follow-up-check',
		]);
	});

	it('lists every workstream in the sections once', () => {
		expect(
			sidebarWorkstreamIds(tree(ALL_FOCUS, [], arranged({ grouping: 'status' }))).sort(),
		).toEqual(sidebarWorkstreamIds(tree()).sort());
	});
});
