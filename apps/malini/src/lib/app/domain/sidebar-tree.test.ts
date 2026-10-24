import { describe, expect, it } from 'vitest';
import { parseLeadScope } from '$shared/repositories/domain/lead-scope';
import { connectedRepositoryContexts } from '$shared/repositories/domain/repository-context';
import type { Repository } from '$shared/repositories/domain/repository';
import type { Workstream } from '$shared/repositories/domain/workstream';
import { ALL_FOCUS, type SidebarFocus } from './sidebar-focus';
import {
	sidebarTree,
	sidebarWorkstreamIds,
	type SidebarChild,
	type SidebarLead,
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

const REPOSITORIES = ['acme/api', 'acme/web', 'solo/site', 'folder', 'logdash/sdk'].map(repo);

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

function tree(
	focus: SidebarFocus = ALL_FOCUS,
	hidden: readonly string[] = [],
	openRepositoryId: string | null = null,
	saved: readonly string[] = [],
): SidebarTree {
	return sidebarTree({
		contexts: connectedRepositoryContexts({
			repositories: REPOSITORIES,
			workstreams: WORKSTREAMS,
		}),
		leads: LEADS,
		hiddenRepositoryIds: new Set(hidden),
		savedRepositoryIds: new Set(saved),
		focus,
		openRepositoryId,
		workstreamOrder: [],
	});
}

function outline(sidebar: SidebarTree): string[] {
	const children = (items: readonly SidebarChild[], depth: number): string[] =>
		items.flatMap((child) => [
			`${'  '.repeat(depth)}${child.workstream.id} (${child.repository.repo.fullName})`,
			...children(child.children, depth + 1),
		]);
	const leads = (items: readonly SidebarLead[], depth: number): string[] =>
		items.flatMap((lead) => [
			`${'  '.repeat(depth)}chat ${lead.workstream.id}`,
			...children(lead.children, depth + 1),
		]);
	return [
		...leads(sidebar.homeLeads, 0),
		...sidebar.blocks.flatMap((block) =>
			block.kind === 'owner'
				? [
						`owner ${block.owner}`,
						...leads(block.leads, 1),
						...block.repositories.flatMap((repository) => [
							`  repository ${repository.row.repo.fullName}`,
							...children(repository.workstreams, 2),
						]),
					]
				: [
						`repository ${block.repository.row.repo.fullName}`,
						...children(block.repository.workstreams, 1),
					],
		),
	];
}

describe('sidebarTree', () => {
	it('puts Home chats first, then one block per owner, with work folded under whoever started it', () => {
		expect(outline(tree())).toEqual([
			'chat home-lead',
			'  web-from-home (acme/web)',
			'  site-from-home (solo/site)',
			'owner acme',
			'  chat acme-lead',
			'    api-from-acme (acme/api)',
			'  repository acme/api',
			'    api-work (acme/api)',
			'      api-follow-up (acme/api)',
			'        api-follow-up-check (acme/api)',
			'      sdk-from-api (logdash/sdk)',
			'repository folder',
			'  folder-work (folder)',
		]);
	});

	it('focuses on one owner, where work started from Home sits under its repository', () => {
		expect(outline(tree({ kind: 'owner', owner: 'ACME' }))).toEqual([
			'owner ACME',
			'  chat acme-lead',
			'    api-from-acme (acme/api)',
			'  repository acme/api',
			'    api-work (acme/api)',
			'      api-follow-up (acme/api)',
			'        api-follow-up-check (acme/api)',
			'      sdk-from-api (logdash/sdk)',
			'  repository acme/web',
			'    web-from-home (acme/web)',
		]);
	});

	it('focuses on one repository, with every workstream in it and no chats', () => {
		expect(outline(tree({ kind: 'repository', repositoryId: 'logdash/sdk' }))).toEqual([
			'repository logdash/sdk',
			'  sdk-from-api (logdash/sdk)',
		]);
		expect(outline(tree({ kind: 'repository', repositoryId: 'solo/site' }))).toEqual([
			'repository solo/site',
			'  site-from-home (solo/site)',
		]);
	});

	it('keeps a hidden repository out, except for work a chat started there', () => {
		expect(outline(tree(ALL_FOCUS, ['acme/web', 'folder'])).slice(0, 3)).toEqual([
			'chat home-lead',
			'  web-from-home (acme/web)',
			'  site-from-home (solo/site)',
		]);
		expect(outline(tree(ALL_FOCUS, ['acme/web', 'folder']))).not.toContain('repository folder');
	});

	it('lists a repository whose work waits saved for later, unless it is hidden', () => {
		expect(outline(tree())).not.toContain('owner solo');
		expect(outline(tree(ALL_FOCUS, [], null, ['solo/site']))).toContain('  repository solo/site');
		expect(outline(tree(ALL_FOCUS, ['solo/site'], null, ['solo/site']))).not.toContain(
			'  repository solo/site',
		);
	});

	it('lists an open repository without work, and every listed workstream once in order', () => {
		expect(outline(tree(ALL_FOCUS, [], 'solo/site'))).toContain('owner solo');
		expect(sidebarWorkstreamIds(tree())).toEqual([
			'home-lead',
			'web-from-home',
			'site-from-home',
			'acme-lead',
			'api-from-acme',
			'api-work',
			'api-follow-up',
			'api-follow-up-check',
			'sdk-from-api',
			'folder-work',
		]);
	});
});
