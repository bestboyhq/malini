import { treeChatSummary, type TreeChatSummary } from '$lib/app/domain/attention-tree';
import { workstreamChatSummaryQuery } from '$lib/chat/application/queries/workstream-chat-summary.query.svelte';
import {
	activeWorkstreamsQuery,
	workstreamRoots,
	type Workstream,
} from '$shared/repositories/repositories.api';

export type WorkstreamTree = Readonly<{ root: Workstream; started: readonly Workstream[] }>;

class AttentionTreeQuery {
	readonly #roots: ReadonlyMap<string, string> = $derived(
		workstreamRoots(activeWorkstreamsQuery.data),
	);

	readonly #trees: ReadonlyMap<string, WorkstreamTree> = $derived.by(() => {
		const byId = new Map(
			activeWorkstreamsQuery.data.map((workstream) => [workstream.id, workstream]),
		);
		const trees = new Map<string, WorkstreamTree>();
		for (const workstream of activeWorkstreamsQuery.data) {
			const root = byId.get(this.#roots.get(workstream.id) ?? workstream.id) ?? workstream;
			const tree = trees.get(root.id) ?? { root, started: [] };
			trees.set(
				root.id,
				root === workstream ? tree : { root, started: [...tree.started, workstream] },
			);
		}
		return trees;
	});

	public readonly rootOf: (workstreamId: string) => string = $derived(
		(workstreamId: string) => this.#roots.get(workstreamId) ?? workstreamId,
	);

	public readonly treeOf: (workstream: Workstream) => WorkstreamTree = $derived(
		(workstream: Workstream) =>
			this.#trees.get(this.rootOf(workstream.id)) ?? {
				root: workstream,
				started: [],
			},
	);

	public readonly summary: (workstreamId: string) => TreeChatSummary = $derived(
		(workstreamId: string) =>
			treeChatSummary(
				workstreamChatSummaryQuery.data(workstreamId),
				(this.#trees.get(workstreamId)?.started ?? []).map(({ id }) =>
					workstreamChatSummaryQuery.data(id),
				),
				this.rootOf(workstreamId) !== workstreamId,
			),
	);
}

export const attentionTreeQuery = new AttentionTreeQuery();
