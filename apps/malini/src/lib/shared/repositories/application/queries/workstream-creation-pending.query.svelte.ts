import { isWorkstreamCreationPending } from '$shared/repositories/infrastructure/services/workstream-creation-marker.storage';

export { workstreamCreationPendingQuery };

class WorkstreamCreationPendingQuery {
	public readonly data: (workstreamId: string) => boolean = $derived((workstreamId: string) =>
		isWorkstreamCreationPending(workstreamId),
	);
}

const workstreamCreationPendingQuery = new WorkstreamCreationPendingQuery();
