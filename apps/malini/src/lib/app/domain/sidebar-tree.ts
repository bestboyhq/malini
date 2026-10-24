import { leadScopeOwns } from '$shared/repositories/domain/lead-scope';
import type { ConnectedRepositoryContext } from '$shared/repositories/domain/repository-context';
import { inSidebarOrder } from '$shared/repositories/domain/sidebar-order';
import type { Workstream } from '$shared/repositories/domain/workstream';
import { ownerGroupId } from './repository-groups';
import type { SidebarFocus } from './sidebar-focus';

export type SidebarChild = Readonly<{
	workstream: Workstream;
	repository: ConnectedRepositoryContext;
	children: readonly SidebarChild[];
}>;

export type SidebarLead = Readonly<{ workstream: Workstream; children: readonly SidebarChild[] }>;

export type SidebarRepository = Readonly<{
	row: ConnectedRepositoryContext;
	workstreams: readonly SidebarChild[];
}>;

export type SidebarOwner = Readonly<{
	kind: 'owner';
	id: string;
	owner: string;
	leads: readonly SidebarLead[];
	repositories: readonly SidebarRepository[];
}>;

export type SidebarRepositoryBlock = Readonly<{
	kind: 'repository';
	id: string;
	repository: SidebarRepository;
}>;

export type SidebarBlock = SidebarOwner | SidebarRepositoryBlock;

export type SidebarTree = Readonly<{
	homeLeads: readonly SidebarLead[];
	blocks: readonly SidebarBlock[];
}>;

export type SidebarTreeInput = Readonly<{
	contexts: readonly ConnectedRepositoryContext[];
	leads: readonly Workstream[];
	hiddenRepositoryIds: ReadonlySet<string>;
	focus: SidebarFocus;
	openRepositoryId: string | null;
	workstreamOrder: readonly string[];
}>;

type Placed = Readonly<{ workstream: Workstream; repository: ConnectedRepositoryContext }>;

type OwnerContents = { leads: SidebarLead[]; repositories: SidebarRepository[] };

type Anchor = Readonly<{ parentId: string }> | 'repository' | null;

export function sidebarTree(input: SidebarTreeInput): SidebarTree {
	const { contexts, focus, hiddenRepositoryIds } = input;
	const listedLeads = input.leads.filter((lead) => leadIsListed(lead, focus));
	const listedLeadIds = new Set(listedLeads.map((lead) => lead.id));
	const placed = inSidebarOrder(
		contexts.flatMap((repository) =>
			repository.workstreams.map((workstream) => ({ id: workstream.id, workstream, repository })),
		),
		input.workstreamOrder,
	);
	const byId = new Map(placed.map((entry) => [entry.workstream.id, entry]));
	const repositoryListed = (repository: ConnectedRepositoryContext): boolean =>
		!hiddenRepositoryIds.has(repository.repo.id) && repositoryInFocus(repository, focus);
	const anchors = new Map<string, Anchor>();

	function anchorOf(entry: Placed, visiting: ReadonlySet<string> = new Set()): Anchor {
		const known = anchors.get(entry.workstream.id);
		if (known !== undefined) return known;
		const anchor = resolveAnchor(entry, new Set([...visiting, entry.workstream.id]));
		anchors.set(entry.workstream.id, anchor);
		return anchor;
	}

	function resolveAnchor(entry: Placed, visiting: ReadonlySet<string>): Anchor {
		const parentId = entry.workstream.startedBy;
		if (parentId !== null && !visiting.has(parentId)) {
			if (listedLeadIds.has(parentId)) return { parentId };
			const parent = byId.get(parentId);
			if (parent && anchorOf(parent, visiting) !== null) return { parentId };
		}
		return repositoryListed(entry.repository) ? 'repository' : null;
	}

	const childrenByParent = new Map<string, Placed[]>();
	const topLevelByRepository = new Map<string, Placed[]>();
	for (const entry of placed) {
		const anchor = anchorOf(entry);
		if (anchor === null) continue;
		const key = anchor === 'repository' ? entry.repository.repo.id : anchor.parentId;
		const bucket = anchor === 'repository' ? topLevelByRepository : childrenByParent;
		bucket.set(key, [...(bucket.get(key) ?? []), entry]);
	}

	const childrenOf = (parentId: string): SidebarChild[] =>
		(childrenByParent.get(parentId) ?? []).map(({ workstream, repository }) => ({
			workstream,
			repository,
			children: childrenOf(workstream.id),
		}));

	const lead = (workstream: Workstream): SidebarLead => ({
		workstream,
		children: childrenOf(workstream.id),
	});

	const repositories = contexts
		.filter(
			(repository) =>
				repositoryListed(repository) &&
				((topLevelByRepository.get(repository.repo.id)?.length ?? 0) > 0 ||
					repository.repo.id === input.openRepositoryId ||
					(focus.kind === 'repository' && focus.repositoryId === repository.repo.id)),
		)
		.map((row) => ({
			row,
			workstreams: (topLevelByRepository.get(row.repo.id) ?? []).map(({ workstream }) => ({
				workstream,
				repository: row,
				children: childrenOf(workstream.id),
			})),
		}));

	return {
		homeLeads: listedLeads.filter((workstream) => workstream.scope?.kind === 'home').map(lead),
		blocks: sidebarBlocks(repositories, listedLeads, focus, lead),
	};
}

function sidebarBlocks(
	repositories: readonly SidebarRepository[],
	listedLeads: readonly Workstream[],
	focus: SidebarFocus,
	lead: (workstream: Workstream) => SidebarLead,
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
		const { owner } = repository.row;
		if (owner === null || focus.kind === 'repository') {
			blocks.push({ kind: 'repository', id: repository.row.repo.id, repository });
			continue;
		}
		ownerBlock(owner).repositories.push(repository);
	}
	for (const workstream of listedLeads) {
		const scope = workstream.scope;
		if (scope?.kind === 'owner') ownerBlock(scope.owner).leads.push(lead(workstream));
	}
	return blocks;
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
	const walk = (children: readonly SidebarChild[]): string[] =>
		children.flatMap((child) => [child.workstream.id, ...walk(child.children)]);
	const leads = (items: readonly SidebarLead[]): string[] =>
		items.flatMap((item) => [item.workstream.id, ...walk(item.children)]);
	return [
		...leads(tree.homeLeads),
		...tree.blocks.flatMap((block) =>
			block.kind === 'owner'
				? [
						...leads(block.leads),
						...block.repositories.flatMap((repository) => walk(repository.workstreams)),
					]
				: walk(block.repository.workstreams),
		),
	];
}

export function sidebarRepositoryIds(tree: SidebarTree): string[] {
	return tree.blocks.flatMap((block) =>
		block.kind === 'owner'
			? block.repositories.map(({ row }) => row.repo.id)
			: [block.repository.row.repo.id],
	);
}
