import { workstreamGitStatusAggregate } from '$shared/repositories/infrastructure/aggregates/workstream-git-status.aggregate.svelte';
import { workstreamsAggregate } from '$shared/repositories/infrastructure/aggregates/workstreams.aggregate.svelte';

export { workstreamHeadQuery };

type WorkstreamHead = Readonly<{ sha: string; subject: string | null }>;

class WorkstreamHeadQuery {
	public readonly data: (workstreamId: string) => WorkstreamHead | null = $derived(
		(workstreamId: string) => {
			const status = workstreamGitStatusAggregate.status;
			const workstream = workstreamsAggregate.workstreams.find(({ id }) => id === workstreamId);
			if (!status?.headSha || status.branch !== workstream?.branch) return null;
			return { sha: status.headSha, subject: status.headSubject };
		},
	);
}

const workstreamHeadQuery = new WorkstreamHeadQuery();
