import type { AgentCheckout, AgentLineage } from '$contract/agent';
import type { Workstream } from '$contract/repositories';
import type { MaliniDatabase } from '$main/db/driver';
import { listRepositoryCatalog } from './repository-catalog';
import { getWorkstream, listWorkstreams } from './workstreams.repository';

export async function workstreamLineage(
	db: MaliniDatabase,
	workstreamId: string,
): Promise<AgentLineage | null> {
	const workstream = getWorkstream(db, workstreamId);
	if (workstream === null) return null;
	const parent = workstream.startedBy === null ? null : getWorkstream(db, workstream.startedBy);
	if (parent === null) return null;
	const catalog = await listRepositoryCatalog(db);
	const workstreamCheckout = (sibling: Workstream): AgentCheckout => ({
		repository:
			catalog.find((repository) => repository.projectIds.includes(sibling.projectId))?.fullName ??
			sibling.projectId,
		branch: sibling.branch,
		path: sibling.path,
	});
	return {
		startedBy: { name: parent.name },
		siblings: listWorkstreams(db)
			.filter((other) => other.startedBy === parent.id && other.id !== workstream.id)
			.map(workstreamCheckout),
	};
}
