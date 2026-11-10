import type { ConnectedRepositoryContext } from '$shared/repositories/domain/repository-context';
import type { Workstream } from '$shared/repositories/domain/workstream';
import { displayWorkstreamName } from '$shared/repositories/domain/workstream-names';
import { ownerGroupId } from './repository-groups';
import {
	sectionedGrouping,
	showsAttentionOnly,
	type SidebarArrangement,
	type SidebarOrdering,
	type SidebarSubgrouping,
} from './sidebar-arrangement';
import type { SidebarFocus } from './sidebar-focus';
import { ATTENTION_SECTIONS, SIDEBAR_SECTIONS, type SidebarSectionKey } from './sidebar-sections';

export type SidebarOwner = Readonly<{
	kind: 'owner';
	id: string;
	owner: string;
	repositories: readonly ConnectedRepositoryContext[];
}>;

export type SidebarRepositoryBlock = Readonly<{
	kind: 'repository';
	id: string;
	repository: ConnectedRepositoryContext;
}>;

export type SidebarBlock = SidebarOwner | SidebarRepositoryBlock;

export type SidebarBranch = Readonly<{
	flat: readonly Workstream[];
	blocks: readonly SidebarBlock[];
}>;

export type SidebarSection = SidebarBranch & Readonly<{ key: SidebarSectionKey; label: string }>;

export type SidebarTree = SidebarBranch &
	Readonly<{ sections: readonly SidebarSection[]; hidden: number }>;

export type SidebarTreeInput = Readonly<{
	contexts: readonly ConnectedRepositoryContext[];
	hiddenRepositoryIds: ReadonlySet<string>;
	focus: SidebarFocus;
	arrangement: SidebarArrangement;
	activeAt: (workstream: Workstream) => number;
	sectionOf: (workstream: Workstream) => SidebarSectionKey;
}>;

type SortKeys<T> = Readonly<{
	name: (item: T) => string;
	newest: (item: T) => string;
	active: (item: T) => number;
}>;

type TreeKeys = Readonly<{
	workstream: SortKeys<Workstream>;
	repository: SortKeys<ConnectedRepositoryContext>;
	block: SortKeys<SidebarBlock>;
}>;

const NAMES = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sidebarTree(input: SidebarTreeInput): SidebarTree {
	const { arrangement, focus } = input;
	const { grouping, ordering } = arrangement;
	const keys = treeKeys(input.activeAt, input.contexts);
	const repositories = input.contexts.filter(
		(repository) =>
			!input.hiddenRepositoryIds.has(repository.repo.id) && repositoryInFocus(repository, focus),
	);
	if (!sectionedGrouping(grouping)) {
		const folders = focus.kind === 'owner' || (focus.kind === 'all' && grouping === 'owner');
		return { ...branch(repositories, ordering, folders, keys), sections: [], hidden: 0 };
	}
	const subgrouping = sectionSubgrouping(arrangement.subgrouping, focus);
	const listed = SIDEBAR_SECTIONS[grouping].flatMap(({ key, label }): SidebarSection[] => {
		const contexts = repositories
			.map((repository) => ({
				...repository,
				workstreams: repository.workstreams.filter(
					(workstream) => input.sectionOf(workstream) === key,
				),
			}))
			.filter((repository) => repository.workstreams.length > 0);
		const section =
			subgrouping === 'none'
				? flatBranch(contexts, ordering, keys)
				: branch(contexts, ordering, subgrouping === 'owner', keys);
		return section.flat.length + section.blocks.length > 0 ? [{ key, label, ...section }] : [];
	});
	const attentionOnly = showsAttentionOnly(arrangement);
	const sections = attentionOnly
		? listed.filter(({ key }) => ATTENTION_SECTIONS.includes(key))
		: listed;
	const hidden = listed
		.filter((section) => !sections.includes(section))
		.reduce((count, section) => count + branchWorkstreamIds(section).length, 0);
	return { flat: [], blocks: [], sections, hidden };
}

export function sectionSubgrouping(
	subgrouping: SidebarSubgrouping,
	focus: SidebarFocus,
): SidebarSubgrouping {
	if (focus.kind === 'repository') return 'none';
	if (focus.kind === 'owner' && subgrouping === 'owner') return 'repository';
	return subgrouping;
}

function branch(
	contexts: readonly ConnectedRepositoryContext[],
	ordering: SidebarOrdering,
	folders: boolean,
	keys: TreeKeys,
): SidebarBranch {
	const repositories = sorted(
		contexts.map((repository) => ({
			...repository,
			workstreams: sorted(repository.workstreams, ordering, keys.workstream),
		})),
		ordering,
		keys.repository,
	);
	return { flat: [], blocks: sorted(sidebarBlocks(repositories, folders), ordering, keys.block) };
}

function flatBranch(
	contexts: readonly ConnectedRepositoryContext[],
	ordering: SidebarOrdering,
	keys: TreeKeys,
): SidebarBranch {
	const workstreams = contexts.flatMap((repository) => repository.workstreams);
	return { flat: sorted(workstreams, ordering, keys.workstream), blocks: [] };
}

function sidebarBlocks(
	repositories: readonly ConnectedRepositoryContext[],
	folders: boolean,
): SidebarBlock[] {
	const blocks: SidebarBlock[] = [];
	const owners = new Map<string, ConnectedRepositoryContext[]>();
	for (const repository of repositories) {
		const { owner } = repository;
		if (owner === null || !folders) {
			blocks.push({ kind: 'repository', id: repository.repo.id, repository });
			continue;
		}
		const id = ownerGroupId(owner);
		const owned = owners.get(id);
		if (owned) {
			owned.push(repository);
			continue;
		}
		const repositoriesOfOwner = [repository];
		owners.set(id, repositoriesOfOwner);
		blocks.push({ kind: 'owner', id, owner, repositories: repositoriesOfOwner });
	}
	return blocks;
}

function sorted<T>(items: readonly T[], ordering: SidebarOrdering, keys: SortKeys<T>): T[] {
	if (ordering === 'name') {
		return [...items].sort((left, right) => NAMES.compare(keys.name(left), keys.name(right)));
	}
	if (ordering === 'newest') {
		return [...items].sort((left, right) => keys.newest(right).localeCompare(keys.newest(left)));
	}
	if (ordering === 'active') {
		return [...items].sort((left, right) => keys.active(right) - keys.active(left));
	}
	return [...items];
}

function newestOf(dates: readonly string[]): string {
	return dates.reduce((newest, date) => (date > newest ? date : newest), '');
}

function treeKeys(
	activeAt: (workstream: Workstream) => number,
	contexts: readonly ConnectedRepositoryContext[],
): TreeKeys {
	const fullNames = new Map(
		contexts.flatMap(({ repo, workstreams }) => workstreams.map(({ id }) => [id, repo.fullName])),
	);
	const workstream: SortKeys<Workstream> = {
		name: (item) => displayWorkstreamName(item, fullNames.get(item.id)),
		newest: (item) => item.createdAt,
		active: activeAt,
	};
	const repository: SortKeys<ConnectedRepositoryContext> = {
		name: (item) => item.name,
		newest: (item) => newestOf([item.repo.createdAt, ...item.workstreams.map(workstream.newest)]),
		active: (item) => Math.max(0, ...item.workstreams.map(activeAt)),
	};
	const block: SortKeys<SidebarBlock> = {
		name: (item) => (item.kind === 'owner' ? item.owner : item.repository.name),
		newest: (item) =>
			item.kind === 'owner'
				? newestOf(item.repositories.map(repository.newest))
				: repository.newest(item.repository),
		active: (item) =>
			item.kind === 'owner'
				? Math.max(0, ...item.repositories.map(repository.active))
				: repository.active(item.repository),
	};
	return { workstream, repository, block };
}

function repositoryInFocus(repository: ConnectedRepositoryContext, focus: SidebarFocus): boolean {
	if (focus.kind === 'all') return true;
	if (focus.kind === 'repository') return repository.repo.id === focus.repositoryId;
	return repository.owner?.toLowerCase() === focus.owner.toLowerCase();
}

export function sidebarWorkstreamIds(tree: SidebarTree): string[] {
	return [tree, ...tree.sections].flatMap(branchWorkstreamIds);
}

export function sidebarRepositoryIds(tree: SidebarTree): string[] {
	return [
		...new Set(
			[tree, ...tree.sections].flatMap(({ blocks }) =>
				blocks.flatMap((block) =>
					block.kind === 'owner'
						? block.repositories.map(({ repo }) => repo.id)
						: [block.repository.repo.id],
				),
			),
		),
	];
}

export function branchWorkstreamIds({ flat, blocks }: SidebarBranch): string[] {
	return [
		...flat.map(({ id }) => id),
		...blocks.flatMap((block) =>
			(block.kind === 'owner' ? block.repositories : [block.repository]).flatMap((repository) =>
				repository.workstreams.map(({ id }) => id),
			),
		),
	];
}
