import { leadScopeOwns } from '$shared/repositories/domain/lead-scope';
import type { ConnectedRepositoryContext } from '$shared/repositories/domain/repository-context';
import type { Workstream } from '$shared/repositories/domain/workstream';
import { ownerGroupId } from './repository-groups';
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
	homeLeads: readonly Workstream[];
	blocks: readonly SidebarBlock[];
}>;

export type SidebarTreeInput = Readonly<{
	contexts: readonly ConnectedRepositoryContext[];
	leads: readonly Workstream[];
	hiddenRepositoryIds: ReadonlySet<string>;
	focus: SidebarFocus;
}>;

type OwnerContents = { leads: Workstream[]; repositories: ConnectedRepositoryContext[] };

export function sidebarTree({
	contexts,
	leads,
	hiddenRepositoryIds,
	focus,
}: SidebarTreeInput): SidebarTree {
	const listedLeads = leads.filter((lead) => leadIsListed(lead, focus));
	const repositories = contexts.filter(
		(repository) =>
			!hiddenRepositoryIds.has(repository.repo.id) && repositoryInFocus(repository, focus),
	);
	return {
		homeLeads: listedLeads.filter((workstream) => workstream.scope?.kind === 'home'),
		blocks: sidebarBlocks(repositories, listedLeads, focus),
	};
}

function sidebarBlocks(
	repositories: readonly ConnectedRepositoryContext[],
	listedLeads: readonly Workstream[],
	focus: SidebarFocus,
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
		if (owner === null || focus.kind === 'repository') {
			blocks.push({ kind: 'repository', id: repository.repo.id, repository });
			continue;
		}
		ownerBlock(owner).repositories.push(repository);
	}
	for (const workstream of listedLeads) {
		const scope = workstream.scope;
		if (scope?.kind === 'owner') ownerBlock(scope.owner).leads.push(workstream);
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
	const ids = (workstreams: readonly Workstream[]): string[] =>
		workstreams.map((workstream) => workstream.id);
	return [
		...ids(tree.homeLeads),
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
