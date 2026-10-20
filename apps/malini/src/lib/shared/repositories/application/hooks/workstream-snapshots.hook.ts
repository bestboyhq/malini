import type { WorkstreamSnapshotReader } from '$shared/repositories/domain/workstream-snapshot';
import { workstreamSnapshotsService } from '$shared/repositories/infrastructure/services/workstream-snapshots.service';

export function workstreamSnapshotsHook(): WorkstreamSnapshotReader {
	return workstreamSnapshotsService;
}
