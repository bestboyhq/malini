import type { WorkstreamCreationContext } from '$shared/repositories/domain/workstream-creation-context';
import { workstreamCreationContext } from '$shared/repositories/infrastructure/services/workstream-creation-marker.storage';

export { workstreamCreationContextQuery };

class WorkstreamCreationContextQuery {
	public readonly data: (workstreamId: string) => WorkstreamCreationContext | null = $derived(
		(workstreamId: string) => workstreamCreationContext(workstreamId),
	);
}

const workstreamCreationContextQuery = new WorkstreamCreationContextQuery();
