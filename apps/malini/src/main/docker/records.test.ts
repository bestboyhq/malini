import { describe, expect, it } from 'vitest';
import { openMigratedDatabase } from '$main/db/open';
import { scalar } from '$main/db/rows';
import { durableContainerRecords, markContainerReleased, recordStartedContainers } from './records';

describe('docker containers', () => {
	it('records idempotently, releases once, and lists only live rows of a bundle', () => {
		const db = openMigratedDatabase(':memory:');
		const record = {
			containerId: 'abc',
			containerName: 'malini-web-1',
			bundleIdentifier: 'com.bestboyhq.malini',
			appInstanceId: 'inst-1',
			workstreamId: null,
			composeProject: 'malini-repo-scope',
			service: 'web',
			owner: 'shared' as const,
			cwd: '/tmp/repo',
			startedAt: '2026-08-01T00:00:00Z',
			appPid: 4242,
		};
		recordStartedContainers(db, [
			record,
			{
				...record,
				containerId: 'def',
				workstreamId: 'w-1',
				owner: 'workstream',
				bundleIdentifier: 'other',
			},
		]);
		recordStartedContainers(db, [{ ...record, appInstanceId: 'inst-2', appPid: null }]);
		expect(durableContainerRecords(db, 'com.bestboyhq.malini')).toEqual([
			{ ...record, appInstanceId: 'inst-2', appPid: null, releasedAt: null },
		]);
		markContainerReleased(db, 'abc', '2026-08-01T01:00:00Z');
		markContainerReleased(db, 'abc', '2026-08-01T02:00:00Z');
		expect(durableContainerRecords(db, 'com.bestboyhq.malini')).toEqual([]);
		expect(
			scalar(
				db,
				"SELECT COUNT(*) FROM docker_containers WHERE released_at = '2026-08-01T01:00:00Z'",
			),
		).toBe(1);
		recordStartedContainers(db, [record]);
		expect(durableContainerRecords(db, 'com.bestboyhq.malini')).toHaveLength(1);
		db.close();
	});
});
