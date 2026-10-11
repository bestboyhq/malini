import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast, type ToastOptions } from '$hyper-ui/components/toast';
import type { PullRequestShip } from '$lib/pull-requests/domain/pull-request-ship';
import { pullRequestShipAggregate } from '$lib/pull-requests/infrastructure/aggregates/pull-request-ship.aggregate.svelte';
import { acceptShipChangeCommand } from './accept-ship-change.command';

const router = vi.hoisted(() => ({
	goto: vi.fn(async (_href: string) => undefined),
	params: { workstreamId: undefined as string | undefined },
}));

vi.mock('$shared/router/navigation', () => ({ goto: router.goto }));
vi.mock('$shared/router/state', () => ({
	page: {
		get params() {
			return router.params;
		},
	},
}));

afterEach(() => {
	pullRequestShipAggregate.reset();
	router.goto.mockClear();
	router.params.workstreamId = undefined;
	vi.restoreAllMocks();
});

function ship(overrides: Partial<PullRequestShip> = {}): PullRequestShip {
	return {
		workstreamId: 'ws-1',
		phase: 'queued',
		step: 'fixing-checks',
		pullRequestNumber: 42,
		pullRequestUrl: 'https://github.com/acme/web/pull/42',
		needsYou: null,
		lastError: null,
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	};
}

describe('a merge queue change', () => {
	it('tells you once when a workstream starts needing you, with a way to open it', () => {
		const warning = vi.spyOn(toast, 'warning').mockReturnValue(1);
		const stuck = ship({
			phase: 'needs-you',
			needsYou: { reason: 'fix-gave-up', detail: '', jobRunId: null },
			updatedAt: '2026-01-01T00:01:00.000Z',
		});
		acceptShipChangeCommand(
			{ workstreamId: 'ws-1', ship: ship(), mergedPullRequestNumber: null },
			'Signal Arc',
		);
		acceptShipChangeCommand(
			{ workstreamId: 'ws-1', ship: stuck, mergedPullRequestNumber: null },
			'Signal Arc',
		);
		acceptShipChangeCommand(
			{ workstreamId: 'ws-1', ship: stuck, mergedPullRequestNumber: null },
			'Signal Arc',
		);

		expect(warning).toHaveBeenCalledTimes(1);
		const [message, options] = warning.mock.calls[0] ?? [];
		expect(message).toBe('Signal Arc needs you · Fix gave up');
		openFrom(options);
		expect(router.goto).toHaveBeenCalledWith('/workstreams/ws-1');
		expect(pullRequestShipAggregate.shipFor('ws-1')?.phase).toBe('needs-you');
	});

	it('announces the merge and leaves the archived workstream when it is on screen', () => {
		const success = vi.spyOn(toast, 'success').mockReturnValue(1);
		router.params.workstreamId = 'ws-1';
		acceptShipChangeCommand(
			{ workstreamId: 'ws-1', ship: ship(), mergedPullRequestNumber: null },
			'Signal Arc',
		);
		acceptShipChangeCommand(
			{ workstreamId: 'ws-1', ship: null, mergedPullRequestNumber: 42 },
			'Signal Arc',
		);

		expect(success).toHaveBeenCalledWith(
			'Merged #42 · Signal Arc archived',
			expect.objectContaining({ context: { workstream: 'ws-1' } }),
		);
		expect(router.goto).toHaveBeenCalledWith('/');
		expect(pullRequestShipAggregate.shipFor('ws-1')).toBeNull();
	});

	it('stays on the page when another workstream merged', () => {
		vi.spyOn(toast, 'success').mockReturnValue(1);
		router.params.workstreamId = 'ws-2';
		acceptShipChangeCommand(
			{ workstreamId: 'ws-1', ship: null, mergedPullRequestNumber: 42 },
			'Signal Arc',
		);

		expect(router.goto).not.toHaveBeenCalled();
	});
});

function openFrom(options: ToastOptions | undefined): void {
	expect(options?.action?.label).toBe('Open');
	options?.action?.onclick();
}
