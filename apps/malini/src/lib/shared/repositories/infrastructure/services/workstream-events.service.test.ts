import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakePlatform, type FakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';
import { workstreamEventsService } from './workstream-events.service';

let platform: FakePlatform;

beforeEach(() => {
	platform = createFakePlatform();
	setPlatformForTest(platform);
});

afterEach(() => {
	setPlatformForTest(null);
});

describe('workstream platform events', () => {
	it('forwards the workstream the file watcher named until released', () => {
		const fired: string[] = [];
		const release = workstreamEventsService.onFilesChanged((workstreamId) =>
			fired.push(workstreamId),
		);

		platform.emit('repositories:workstream-files-changed', {
			workstreamId: 'ws-x',
			changedAt: '2026-09-19T00:00:00.000Z',
		});
		release();
		platform.emit('repositories:workstream-files-changed', { workstreamId: 'ws-y', changedAt: '' });

		expect(fired).toEqual(['ws-x']);
		expect(platform.listenerCount('repositories:workstream-files-changed')).toBe(0);
	});

	it('drops file-watcher frames that do not name a workstream', () => {
		const fired: string[] = [];
		workstreamEventsService.onFilesChanged((workstreamId) => fired.push(workstreamId));

		platform.emit('repositories:workstream-files-changed', null);
		platform.emit('repositories:workstream-files-changed', { changedAt: '2026-09-19' });
		platform.emit('repositories:workstream-files-changed', { workstreamId: '' });

		expect(fired).toEqual([]);
	});

	it('reports both a created and a removed workstream, and stops on release', () => {
		let changes = 0;
		const release = workstreamEventsService.onWorkstreamsChanged(() => {
			changes += 1;
		});

		platform.emit('repositories:workstream-created', { workstreamId: 'ws-a' });
		platform.emit('repositories:workstream-removed', { workstreamId: 'ws-a', archived: true });
		release();
		platform.emit('repositories:workstream-created', { workstreamId: 'ws-b' });

		expect(changes).toBe(2);
	});

	it('reports install status and clone progress only for the workstream and clone asked about', () => {
		const statuses: unknown[] = [];
		const fractions: number[] = [];
		workstreamEventsService.onInstallStatus('ws-a', (payload) => statuses.push(payload.status));
		workstreamEventsService.onCloneProgress('rabbits__hutch', (fraction) =>
			fractions.push(fraction),
		);

		platform.emit('repositories:workstream-install-status', {
			workstreamId: 'ws-b',
			status: 'failed',
		});
		platform.emit('repositories:workstream-install-status', {
			workstreamId: 'ws-a',
			status: 'running',
		});
		platform.emit('repositories:clone-progress', { repo_id: 'foxes__den', fraction: 0.9 });
		platform.emit('repositories:clone-progress', { repo_id: 'rabbits__hutch', fraction: 'half' });
		platform.emit('repositories:clone-progress', { repo_id: 'rabbits__hutch', fraction: 0.5 });

		expect(statuses).toEqual(['running']);
		expect(fractions).toEqual([0.5]);
	});
});
