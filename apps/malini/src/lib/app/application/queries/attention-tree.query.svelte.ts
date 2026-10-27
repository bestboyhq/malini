import { treeChatSummary, type TreeChatSummary } from '$lib/app/domain/attention-tree';
import { workstreamChatSummaryQuery } from '$lib/chat/application/queries/workstream-chat-summary.query.svelte';
import {
	activeWorkstreamsQuery,
	workstreamLeads,
	type Workstream,
} from '$shared/repositories/repositories.api';

export type WorkstreamTree = Readonly<{ lead: Workstream; started: readonly Workstream[] }>;

class AttentionTreeQuery {
	readonly #leads: ReadonlyMap<string, string> = $derived(
		workstreamLeads(activeWorkstreamsQuery.data),
	);

	readonly #trees: ReadonlyMap<string, WorkstreamTree> = $derived.by(() => {
		const byId = new Map(
			activeWorkstreamsQuery.data.map((workstream) => [workstream.id, workstream]),
		);
		const trees = new Map<string, WorkstreamTree>();
		for (const workstream of activeWorkstreamsQuery.data) {
			const lead = byId.get(this.#leads.get(workstream.id) ?? workstream.id) ?? workstream;
			const tree = trees.get(lead.id) ?? { lead, started: [] };
			trees.set(
				lead.id,
				lead === workstream ? tree : { lead, started: [...tree.started, workstream] },
			);
		}
		return trees;
	});

	public readonly leadOf: (workstreamId: string) => string = $derived(
		(workstreamId: string) => this.#leads.get(workstreamId) ?? workstreamId,
	);

	public readonly treeOf: (workstream: Workstream) => WorkstreamTree = $derived(
		(workstream: Workstream) =>
			this.#trees.get(this.leadOf(workstream.id)) ?? {
				lead: workstream,
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
				this.leadOf(workstreamId) !== workstreamId,
			),
	);
}

export const attentionTreeQuery = new AttentionTreeQuery();
