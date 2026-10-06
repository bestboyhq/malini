import type { MaliniDatabase } from '../db/driver';
import { all, nowIso8601, run } from '../db/rows';

export type ContainerOwner = 'workstream' | 'shared' | 'extension';

export function parseContainerOwner(value: string): ContainerOwner {
	if (value === 'workstream' || value === 'shared' || value === 'extension') return value;
	throw new Error(
		`docker container owner must be workstream, shared, or extension, not \`${value}\``,
	);
}

export interface OwnedContainerRecord {
	containerId: string;
	containerName: string;
	bundleIdentifier: string;
	appInstanceId: string;
	workstreamId: string | null;
	composeProject: string;
	service: string;
	owner: ContainerOwner;
	cwd: string;
	startedAt: string;
	releasedAt: string | null;
	appPid: number | null;
}

interface ContainerRow {
	container_id: string;
	container_name: string;
	bundle_identifier: string;
	app_instance_id: string;
	workstream_id: string | null;
	compose_project: string;
	service: string;
	owner: string;
	cwd: string;
	started_at: string;
	released_at: string | null;
	app_pid: number | null;
}

function recordFromRow(row: ContainerRow): OwnedContainerRecord {
	let owner: ContainerOwner;
	try {
		owner = parseContainerOwner(row.owner);
	} catch {
		owner = 'extension';
	}
	return {
		containerId: row.container_id,
		containerName: row.container_name,
		bundleIdentifier: row.bundle_identifier,
		appInstanceId: row.app_instance_id,
		workstreamId: row.workstream_id,
		composeProject: row.compose_project,
		service: row.service,
		owner,
		cwd: row.cwd,
		startedAt: row.started_at,
		releasedAt: row.released_at,
		appPid: row.app_pid,
	};
}

export function recordStartedContainers(
	db: MaliniDatabase,
	records: readonly Omit<OwnedContainerRecord, 'releasedAt'>[],
): void {
	db.transaction(() => {
		for (const record of records) {
			run(
				db,
				`INSERT INTO docker_containers (
				   container_id, container_name, bundle_identifier, app_instance_id, workstream_id,
				   compose_project, service, owner, cwd, started_at, released_at, app_pid
				 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
				 ON CONFLICT(container_id) DO UPDATE SET
				   container_name = excluded.container_name,
				   bundle_identifier = excluded.bundle_identifier,
				   app_instance_id = excluded.app_instance_id,
				   workstream_id = excluded.workstream_id,
				   compose_project = excluded.compose_project,
				   service = excluded.service,
				   owner = excluded.owner,
				   cwd = excluded.cwd,
				   app_pid = excluded.app_pid,
				   released_at = NULL`,
				record.containerId,
				record.containerName,
				record.bundleIdentifier,
				record.appInstanceId,
				record.workstreamId,
				record.composeProject,
				record.service,
				record.owner,
				record.cwd,
				record.startedAt,
				record.appPid,
			);
		}
	});
}

export function markContainerReleased(
	db: MaliniDatabase,
	containerId: string,
	releasedAt: string = nowIso8601(),
): void {
	run(
		db,
		`UPDATE docker_containers SET released_at = ?
		 WHERE container_id = ? AND released_at IS NULL`,
		releasedAt,
		containerId,
	);
}

export function durableContainerRecords(
	db: MaliniDatabase,
	bundleIdentifier: string,
): OwnedContainerRecord[] {
	return all<ContainerRow>(
		db,
		`SELECT container_id, container_name, bundle_identifier, app_instance_id, workstream_id,
		        compose_project, service, owner, cwd, started_at, released_at, app_pid
		 FROM docker_containers
		 WHERE bundle_identifier = ? AND released_at IS NULL
		 ORDER BY started_at, container_id`,
		bundleIdentifier,
	).map(recordFromRow);
}
