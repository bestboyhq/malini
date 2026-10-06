import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workstreamChangeTotalsAggregate } from '$shared/repositories/infrastructure/aggregates/change-totals.aggregate.svelte';
import { activeWorkstreamFreshnessStore } from '$shared/repositories/infrastructure/stores/active-workstream-freshness.store.svelte';
import { refreshWorkstreamAfterChangeCommand } from './refresh-workstream-after-change.command';

const router = vi.hoisted(() => ({ params: { workstreamId: undefined as string | undefined } }));

vi.mock('$shared/router/state', () => ({
	page: {
		get params() {
			return router.params;
		},
	},
}));

beforeEach(() => {
	router.params = { workstreamId: 'ws-active' };
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('refreshing a workstream after its files change', () => {
	it('refreshes the open workstream’s totals and local repository state together', () => {
		const refreshNow = vi.spyOn(activeWorkstreamFreshnessStore, 'refreshNow');
		const refreshTotals = vi.spyOn(workstreamChangeTotalsAggregate, 'refreshWorkstream');

		refreshWorkstreamAfterChangeCommand('ws-active');

		expect(refreshNow).toHaveBeenCalledWith({ totals: true, localRepository: true });
		expect(refreshTotals).not.toHaveBeenCalled();
	});

	it('refreshes only the totals of a workstream in the background', () => {
		const refreshNow = vi.spyOn(activeWorkstreamFreshnessStore, 'refreshNow');
		const refreshTotals = vi.spyOn(workstreamChangeTotalsAggregate, 'refreshWorkstream');

		refreshWorkstreamAfterChangeCommand('ws-other');

		expect(refreshTotals).toHaveBeenCalledWith('ws-other');
		expect(refreshNow).not.toHaveBeenCalled();
	});
});
