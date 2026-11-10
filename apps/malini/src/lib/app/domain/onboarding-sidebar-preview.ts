import type { Repository } from '$shared/repositories/domain/repository';
import {
	connectedRepositoryContexts,
	projectIdentityIdsForRepository,
	repositoryName,
} from '$shared/repositories/domain/repository-context';
import type { Workstream } from '$shared/repositories/domain/workstream';
import type { SidebarArrangement } from './sidebar-arrangement';
import { ALL_FOCUS } from './sidebar-focus';
import type { StatusSectionKey } from './sidebar-sections';
import { sidebarTree, type SidebarTree } from './sidebar-tree';

const CREATED_AT = '2026-11-01T00:00:00.000Z';

const PREVIEW_REPOSITORY_COUNT = 4;
const SAMPLE_REPOSITORIES: readonly string[] = [
	'you/notes',
	'acme/web',
	'acme/api',
	'acme/billing',
];

const SAMPLE: readonly Readonly<{
	slot: number;
	name: string;
	status: StatusSectionKey;
}>[] = [
	{ slot: 0, name: 'Tidy reading list', status: 'idle' },
	{ slot: 1, name: 'Fix login redirect', status: 'needs-you' },
	{ slot: 1, name: 'Dark mode tokens', status: 'in-progress' },
	{ slot: 1, name: 'Upgrade Svelte', status: 'idle' },
	{ slot: 2, name: 'Add rate limits', status: 'in-review' },
	{ slot: 2, name: 'Cache invalidation', status: 'in-progress' },
	{ slot: 3, name: 'Invoice export', status: 'needs-you' },
];

const STATUS_OF = new Map(SAMPLE.map(({ name, status }) => [name, status]));

export type OnboardingSidebarPreview = Readonly<{
	tree: SidebarTree;
	repositoryNames: ReadonlyMap<string, string>;
}>;

function previewRepositories(recent: readonly string[]): readonly string[] {
	const distinct = [...new Set(recent)].slice(0, PREVIEW_REPOSITORY_COUNT);
	return distinct.length > 0 ? distinct : SAMPLE_REPOSITORIES;
}

export function onboardingSidebarPreview(
	arrangement: SidebarArrangement,
	recent: readonly string[],
): OnboardingSidebarPreview {
	const fullNames = previewRepositories(recent);
	const repositories: readonly Repository[] = fullNames.map((fullName) => ({
		id: fullName,
		fullName,
		defaultBranch: 'main',
		localPath: null,
		remoteUrl: null,
		createdAt: CREATED_AT,
	}));
	const rows = SAMPLE.map(({ slot, name }) => {
		const fullName = fullNames[slot % fullNames.length] ?? '';
		const workstream: Workstream = {
			id: name,
			projectId: projectIdentityIdsForRepository(fullName)[0] ?? fullName,
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
			startedBy: null,
		};
		return { workstream, repositoryName: repositoryName(fullName) };
	});
	const tree = sidebarTree({
		contexts: connectedRepositoryContexts({
			repositories,
			workstreams: rows.map((row) => row.workstream),
		}),
		hiddenRepositoryIds: new Set(),
		focus: ALL_FOCUS,
		arrangement,
		activeAt: () => 0,
		sectionOf: onboardingPreviewStatus,
	});
	return {
		tree,
		repositoryNames: new Map(rows.map((row) => [row.workstream.id, row.repositoryName])),
	};
}

export function onboardingPreviewStatus({ name }: Workstream): StatusSectionKey {
	return STATUS_OF.get(name) ?? 'idle';
}
