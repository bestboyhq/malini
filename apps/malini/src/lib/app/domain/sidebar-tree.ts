import { leadScopeOwns } from '$shared/repositories/domain/lead-scope';
import type { ConnectedRepositoryContext } from '$shared/repositories/domain/repository-context';
import { inSidebarOrder } from '$shared/repositories/domain/sidebar-order';
import type { Workstream } from '$shared/repositories/domain/workstream';
import { displayWorkstreamName } from '$shared/repositories/domain/workstream-names';
import { ownerGroupId } from './repository-groups';
import {
	sectionedGrouping,
	type SidebarArrangement,
	type SidebarOrdering,
	type SidebarSubgrouping,
} from './sidebar-arrangement';
import type { SidebarFocus } from './sidebar-focus';
import { SIDEBAR_SECTIONS, type SidebarSectionKey } from './sidebar-sections';

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

export type SidebarBranch = Readonly<{
	chats: readonly Workstream[];
	blocks: readonly SidebarBlock[];
	started: ReadonlyMap<string, readonly Workstream[]>;
}>;

export type SidebarSection = SidebarBranch & Readonly<{ key: SidebarSectionKey; label: string }>;

export type SidebarTree = SidebarBranch & Readonly<{ sections: readonly SidebarSection[] }>;

export type SidebarTreeInput = Readonly<{
	contexts: readonly ConnectedRepositoryContext[];
	leads: readonly Workstream[];
	hiddenRepositoryIds: ReadonlySet<string>;
	focus: SidebarFocus;
	arrangement: SidebarArrangement;
	workstreamOrder: readonly string[];
	activeAt: (workstream: Workstream) => number;
	sectionOf: (workstream: Workstream) => SidebarSectionKey;
}>;

type OwnerContents = { leads: Workstream[]; repositories: ConnectedRepositoryContext[] };

type Listed = Readonly<{
	contexts: readonly ConnectedRepositoryContext[];
	leads: readonly Workstream[];
}>;

type Nested = Listed & Readonly<{ started: ReadonlyMap<string, readonly Workstream[]> }>;

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
	const leads = input.leads.filter((lead) => leadIsListed(lead, focus));
	const repositories = input.contexts.filter(
		(repository) =>
			!input.hiddenRepositoryIds.has(repository.repo.id) && repositoryInFocus(repository, focus),
	);
	const startedOrder = (workstreams: readonly Workstream[]): Workstream[] =>
		sorted(inSidebarOrder(workstreams, input.workstreamOrder), ordering, keys.workstream);
	const chatOf = startingChat([
		...input.leads,
		...input.contexts.flatMap((repository) => repository.workstreams),
	]);
	if (!sectionedGrouping(grouping)) {
		const folders = focus.kind === 'owner' || (focus.kind === 'all' && grouping === 'owner');
		const {
			contexts,
			leads: topLeads,
			started,
		} = nestStarted({ contexts: repositories, leads }, chatOf, startedOrder);
		return {
			...branch(contexts, topLeads, focus, ordering, folders, keys),
			started,
			sections: [],
		};
	}
	const subgrouping = sectionSubgrouping(arrangement.subgrouping, focus);
	const sections = SIDEBAR_SECTIONS[grouping].flatMap(({ key, label }): SidebarSection[] => {
		const inSection = (workstream: Workstream): boolean => input.sectionOf(workstream) === key;
		const nested = nestStarted(
			{
				contexts: repositories.map((repository) => ({
					...repository,
					workstreams: repository.workstreams.filter(inSection),
				})),
				leads: leads.filter(inSection),
			},
			chatOf,
			startedOrder,
		);
		const contexts = nested.contexts.filter((repository) => repository.workstreams.length > 0);
		const section =
			subgrouping === 'none'
				? flatBranch(contexts, nested.leads, ordering, keys)
				: branch(contexts, nested.leads, focus, ordering, subgrouping === 'owner', keys);
		return section.chats.length + section.blocks.length > 0
			? [{ key, label, ...section, started: nested.started }]
			: [];
	});
	return { chats: [], blocks: [], started: new Map(), sections };
}

function nestStarted(
	{ contexts, leads }: Listed,
	chatOf: (workstream: Workstream) => Workstream | undefined,
	order: (workstreams: readonly Workstream[]) => Workstream[],
): Nested {
	const listedChats = new Set(leads.map(({ id }) => id));
	const started = new Map<string, Workstream[]>();
	for (const workstream of order(contexts.flatMap((repository) => repository.workstreams))) {
		const chat = chatOf(workstream);
		if (!chat || !listedChats.has(chat.id)) continue;
		started.set(chat.id, [...(started.get(chat.id) ?? []), workstream]);
	}
	const nestedIds = new Set([...started.values()].flat().map((workstream) => workstream.id));
	return {
		contexts: contexts.map((repository) => ({
			...repository,
			workstreams: repository.workstreams.filter((workstream) => !nestedIds.has(workstream.id)),
		})),
		leads,
		started,
	};
}

function startingChat(
	workstreams: readonly Workstream[],
): (workstream: Workstream) => Workstream | undefined {
	const byId = new Map(workstreams.map((workstream) => [workstream.id, workstream]));
	const starterOf = (workstream: Workstream): Workstream | undefined =>
		workstream.startedBy === null ? undefined : byId.get(workstream.startedBy);
	return (workstream) => {
		if (workstream.scope !== null) return undefined;
		const seen = new Set([workstream.id]);
		for (
			let starter = starterOf(workstream);
			starter && !seen.has(starter.id);
			starter = starterOf(starter)
		) {
			if (starter.scope !== null) return starter;
			seen.add(starter.id);
		}
		return undefined;
	};
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
	leads: readonly Workstream[],
	focus: SidebarFocus,
	ordering: SidebarOrdering,
	folders: boolean,
	keys: TreeKeys,
): Omit<SidebarBranch, 'started'> {
	const listedLeads = sorted(leads, ordering, keys.workstream);
	const repositories = sorted(
		contexts.map((repository) => ({
			...repository,
			workstreams: sorted(repository.workstreams, ordering, keys.workstream),
		})),
		ordering,
		keys.repository,
	);
	return {
		chats: listedLeads.filter((workstream) => workstream.scope?.kind === 'home' || !folders),
		blocks: sorted(sidebarBlocks(repositories, listedLeads, focus, folders), ordering, keys.block),
	};
}

function flatBranch(
	contexts: readonly ConnectedRepositoryContext[],
	leads: readonly Workstream[],
	ordering: SidebarOrdering,
	keys: TreeKeys,
): Omit<SidebarBranch, 'started'> {
	const workstreams = [...leads, ...contexts.flatMap((repository) => repository.workstreams)];
	return { chats: sorted(workstreams, ordering, keys.workstream), blocks: [] };
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
	if (folders && focus.kind === 'owner') ownerBlock(focus.owner);
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
				? newestOf([
						...item.leads.map(workstream.newest),
						...item.repositories.map(repository.newest),
					])
				: repository.newest(item.repository),
		active: (item) =>
			item.kind === 'owner'
				? Math.max(0, ...item.leads.map(activeAt), ...item.repositories.map(repository.active))
				: repository.active(item.repository),
	};
	return { workstream, repository, block };
}

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

export function branchWorkstreamIds({ chats, blocks, started }: SidebarBranch): string[] {
	const ids = (workstreams: readonly Workstream[]): string[] =>
		workstreams.flatMap((workstream) => [workstream.id, ...ids(started.get(workstream.id) ?? [])]);
	return [
		...ids(chats),
		...blocks.flatMap((block) =>
			block.kind === 'owner'
				? [
						...ids(block.leads),
						...block.repositories.flatMap((repository) => ids(repository.workstreams)),
					]
				: ids(block.repository.workstreams),
		),
	];
}
