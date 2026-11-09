import type { Repository } from '$shared/repositories/domain/repository';
import { connectedRepositoryContexts } from '$shared/repositories/domain/repository-context';
import type { Workstream } from '$shared/repositories/domain/workstream';
import type { SidebarArrangement } from './sidebar-arrangement';
import { ALL_FOCUS } from './sidebar-focus';
import type { StatusSectionKey } from './sidebar-sections';
import { sidebarTree, type SidebarTree } from './sidebar-tree';

const CREATED_AT = '2026-11-01T00:00:00.000Z';

const SAMPLE: readonly Readonly<{
	repository: string;
	name: string;
	status: StatusSectionKey;
}>[] = [
	{ repository: 'you/notes', name: 'Tidy reading list', status: 'idle' },
	{ repository: 'acme/web', name: 'Fix login redirect', status: 'needs-you' },
	{ repository: 'acme/web', name: 'Dark mode tokens', status: 'in-progress' },
	{ repository: 'acme/web', name: 'Upgrade Svelte', status: 'idle' },
	{ repository: 'acme/api', name: 'Add rate limits', status: 'in-review' },
	{ repository: 'acme/api', name: 'Cache invalidation', status: 'in-progress' },
	{ repository: 'acme/billing', name: 'Invoice export', status: 'needs-you' },
];

const REPOSITORIES: readonly Repository[] = [...new Set(SAMPLE.map((row) => row.repository))].map(
	(fullName) => ({
		id: fullName,
		fullName,
		defaultBranch: 'main',
		localPath: null,
		remoteUrl: null,
		createdAt: CREATED_AT,
	}),
);

const WORKSTREAMS: readonly Workstream[] = SAMPLE.map(({ repository, name }) => ({
	id: name,
	projectId: `local__${repository.replace('/', '__')}`,
	name,
	path: `/preview/${name}`,
	branch: `preview/${name}`,
	baseBranch: 'main',
	status: 'active',
	checkoutState: 'healthy',
	checkoutIssue: null,
	resolvedPath: null,
	createdAt: CREATED_AT,
	activeAt: CREATED_AT,
	scope: null,
	startedBy: null,
}));

const STATUS_OF = new Map(SAMPLE.map(({ name, status }) => [name, status]));

export function onboardingSidebarPreview(arrangement: SidebarArrangement): SidebarTree {
	return sidebarTree({
		contexts: connectedRepositoryContexts({
			repositories: REPOSITORIES,
			workstreams: WORKSTREAMS,
		}),
		leads: [],
		hiddenRepositoryIds: new Set(),
		focus: ALL_FOCUS,
		arrangement,
		workstreamOrder: [],
		activeAt: () => 0,
		sectionOf: onboardingPreviewStatus,
	});
}

export function onboardingPreviewStatus({ name }: Workstream): StatusSectionKey {
	return STATUS_OF.get(name) ?? 'idle';
}

export function onboardingPreviewRepository({ name }: Workstream): string {
	const repository = SAMPLE.find((row) => row.name === name)?.repository ?? '';
	return repository.slice(repository.indexOf('/') + 1);
}
