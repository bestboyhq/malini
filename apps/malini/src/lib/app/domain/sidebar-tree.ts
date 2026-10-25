import { leadScopeOwns } from '$shared/repositories/domain/lead-scope';
import type { ConnectedRepositoryContext } from '$shared/repositories/domain/repository-context';
import type { Workstream } from '$shared/repositories/domain/workstream';
import { displayWorkstreamName } from '$shared/repositories/domain/workstream-names';
import { ownerGroupId } from './repository-groups';
import type { SidebarArrangement, SidebarOrdering } from './sidebar-arrangement';
import type { SidebarFocus } from './sidebar-focus';

export type SidebarOwner = Readonly<{
	kind: 'owner';
	id: string;
	owner: string;
	leads: readonly Workstream[];
	repositories: readonly ConnectedRepositoryContext[];
}>;

export type SidebarRepositoryBlock = Readonly<{
	kind: 'repository';
	id: string;
	repository: ConnectedRepositoryContext;
}>;

export type SidebarBlock = SidebarOwner | SidebarRepositoryBlock;

export type SidebarTree = Readonly<{
	chats: readonly Workstream[];
	blocks: readonly SidebarBlock[];
}>;

export type SidebarTreeInput = Readonly<{
	contexts: readonly ConnectedRepositoryContext[];
	leads: readonly Workstream[];
	hiddenRepositoryIds: ReadonlySet<string>;
	focus: SidebarFocus;
	arrangement: SidebarArrangement;
}>;

type OwnerContents = { leads: Workstream[]; repositories: ConnectedRepositoryContext[] };

type SortKeys<T> = Readonly<{ name: (item: T) => string; newest: (item: T) => string }>;

const NAMES = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sidebarTree({
	contexts,
	leads,
	hiddenRepositoryIds,
	focus,
	arrangement,
}: SidebarTreeInput): SidebarTree {
	const { ordering } = arrangement;
	const folders =
		focus.kind === 'owner' || (focus.kind === 'all' && arrangement.grouping === 'owner');
	const listedLeads = sorted(
		leads.filter((lead) => leadIsListed(lead, focus)),
		ordering,
		WORKSTREAM_KEYS,
	);
	const repositories = sorted(
		contexts
			.filter(
				(repository) =>
					!hiddenRepositoryIds.has(repository.repo.id) && repositoryInFocus(repository, focus),
			)
			.map((repository) => ({
				...repository,
				workstreams: sorted(repository.workstreams, ordering, workstreamKeys(repository)),
			})),
		ordering,
		REPOSITORY_KEYS,
	);
	return {
		chats: listedLeads.filter(
			(workstream) => workstream.scope?.kind === 'home' || (!folders && focus.kind === 'all'),
		),
		blocks: sorted(sidebarBlocks(repositories, listedLeads, focus, folders), ordering, BLOCK_KEYS),
	};
}

function sidebarBlocks(
	repositories: readonly ConnectedRepositoryContext[],
	listedLeads: readonly Workstream[],
	focus: SidebarFocus,
	folders: boolean,
): SidebarBlock[] {
	const blocks: SidebarBlock[] = [];
	const owners = new Map<string, OwnerContents>();
	const ownerBlock = (owner: string): OwnerContents => {
		const id = ownerGroupId(owner);
		const existing = owners.get(id);
		if (existing) return existing;
		const contents: OwnerContents = { leads: [], repositories: [] };
		owners.set(id, contents);
		blocks.push({ kind: 'owner', id, owner, ...contents });
		return contents;
	};
	if (focus.kind === 'owner') ownerBlock(focus.owner);
	for (const repository of repositories) {
		const { owner } = repository;
		if (owner === null || !folders) {
			blocks.push({ kind: 'repository', id: repository.repo.id, repository });
			continue;
		}
		ownerBlock(owner).repositories.push(repository);
	}
	if (!folders) return blocks;
	for (const workstream of listedLeads) {
		const scope = workstream.scope;
		if (scope?.kind === 'owner') ownerBlock(scope.owner).leads.push(workstream);
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
	return [...items];
}

function newestOf(dates: readonly string[]): string {
	return dates.reduce((newest, date) => (date > newest ? date : newest), '');
}

const WORKSTREAM_KEYS: SortKeys<Workstream> = {
	name: (workstream) => displayWorkstreamName(workstream),
	newest: (workstream) => workstream.createdAt,
};

function workstreamKeys(repository: ConnectedRepositoryContext): SortKeys<Workstream> {
	return {
		name: (workstream) => displayWorkstreamName(workstream, repository.repo.fullName),
		newest: (workstream) => workstream.createdAt,
	};
}

const REPOSITORY_KEYS: SortKeys<ConnectedRepositoryContext> = {
	name: (repository) => repository.name,
	newest: (repository) =>
		newestOf([
			repository.repo.createdAt,
			...repository.workstreams.map((workstream) => workstream.createdAt),
		]),
};

const BLOCK_KEYS: SortKeys<SidebarBlock> = {
	name: (block) => (block.kind === 'owner' ? block.owner : block.repository.name),
	newest: (block) =>
		block.kind === 'owner'
			? newestOf([
					...block.leads.map((lead) => lead.createdAt),
					...block.repositories.map(REPOSITORY_KEYS.newest),
				])
			: REPOSITORY_KEYS.newest(block.repository),
};

function leadIsListed(lead: Workstream, focus: SidebarFocus): boolean {
	if (lead.scope === null) return false;
	if (focus.kind === 'all') return true;
	return (
		focus.kind === 'owner' && lead.scope.kind === 'owner' && leadScopeOwns(lead.scope, focus.owner)
	);
}

function repositoryInFocus(repository: ConnectedRepositoryContext, focus: SidebarFocus): boolean {
	if (focus.kind === 'all') return true;
	if (focus.kind === 'repository') return repository.repo.id === focus.repositoryId;
	return repository.owner?.toLowerCase() === focus.owner.toLowerCase();
}

export function sidebarWorkstreamIds(tree: SidebarTree): string[] {
	const ids = (workstreams: readonly Workstream[]): string[] =>
		workstreams.map((workstream) => workstream.id);
	return [
		...ids(tree.chats),
		...tree.blocks.flatMap((block) =>
			block.kind === 'owner'
				? [
						...ids(block.leads),
						...block.repositories.flatMap((repository) => ids(repository.workstreams)),
					]
				: ids(block.repository.workstreams),
		),
	];
}

export function sidebarRepositoryIds(tree: SidebarTree): string[] {
	return tree.blocks.flatMap((block) =>
		block.kind === 'owner'
			? block.repositories.map(({ repo }) => repo.id)
			: [block.repository.repo.id],
	);
}
