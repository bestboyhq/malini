import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '$shared/repositories/domain/repository';
import {
	UNOBSERVED_WORKSTREAM_CHECKOUT,
	type Workstream,
} from '$shared/repositories/domain/workstream';

const serviceMocks = vi.hoisted(() => ({
	workstreamsService: {
		listWorkstreams: vi.fn<() => Promise<Workstream[]>>(),
		listProjects: vi.fn<() => Promise<Project[]>>(),
	},
}));

vi.mock('$shared/repositories/infrastructure/services/workstreams.service', () => serviceMocks);

import { WorkstreamsAggregate } from './workstreams.aggregate.svelte';

function workstream(id: string, overrides: Partial<Workstream> = {}): Workstream {
	return {
		id,
		projectId: 'project-1',
		name: id,
		path: `/checkouts/${id}`,
		branch: `malini/${id}`,
		baseBranch: 'main',
		status: 'active',
		...UNOBSERVED_WORKSTREAM_CHECKOUT,
		...overrides,
	};
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((next) => {
		resolve = next;
	});
	return { promise, resolve };
}

describe('WorkstreamsAggregate', () => {
	beforeEach(() => {
		serviceMocks.workstreamsService.listWorkstreams.mockReset();
		serviceMocks.workstreamsService.listProjects.mockReset();
	});

	it('keeps the newer result when two refreshes race', async () => {
		const first = deferred<Workstream[]>();
		const second = deferred<Workstream[]>();
		serviceMocks.workstreamsService.listWorkstreams
			.mockImplementationOnce(() => first.promise)
			.mockImplementationOnce(() => second.promise);
		serviceMocks.workstreamsService.listProjects.mockResolvedValue([]);

		const aggregate = new WorkstreamsAggregate();
		const firstRefresh = aggregate.refresh();
		const secondRefresh = aggregate.refresh();

		second.resolve([workstream('b')]);
		await secondRefresh;
		first.resolve([workstream('a')]);
		await firstRefresh;

		expect(aggregate.workstreams.map(({ id }) => id)).toEqual(['b']);
		expect(aggregate.loaded).toBe(true);
		expect(aggregate.loading).toBe(false);
	});

	it('reports a failed refresh without discarding what it already showed', async () => {
		serviceMocks.workstreamsService.listWorkstreams
			.mockResolvedValueOnce([workstream('a')])
			.mockRejectedValueOnce(new Error('the bridge is unavailable'));
		serviceMocks.workstreamsService.listProjects.mockResolvedValue([]);

		const aggregate = new WorkstreamsAggregate();
		await aggregate.refresh();
		await aggregate.refresh();

		expect(aggregate.workstreams.map(({ id }) => id)).toEqual(['a']);
		expect(aggregate.lastError).toBe('the bridge is unavailable');
	});

	it('keeps a staged workstream visible until the native list reports it', async () => {
		serviceMocks.workstreamsService.listWorkstreams.mockResolvedValue([]);
		serviceMocks.workstreamsService.listProjects.mockResolvedValue([]);

		const aggregate = new WorkstreamsAggregate();
		aggregate.stagePendingWorkstream(workstream('pending'));
		await aggregate.refresh();

		expect(aggregate.workstreams.map(({ id }) => id)).toEqual(['pending']);

		aggregate.settlePendingWorkstream(workstream('pending'));
		serviceMocks.workstreamsService.listWorkstreams.mockResolvedValue([workstream('pending')]);
		await aggregate.refresh();

		expect(aggregate.workstreams.map(({ id }) => id)).toEqual(['pending']);
	});

	it('drops a discarded pending workstream', async () => {
		serviceMocks.workstreamsService.listWorkstreams.mockResolvedValue([]);
		serviceMocks.workstreamsService.listProjects.mockResolvedValue([]);

		const aggregate = new WorkstreamsAggregate();
		aggregate.stagePendingWorkstream(workstream('pending'));
		aggregate.discardPendingWorkstream('pending');
		await aggregate.refresh();

		expect(aggregate.workstreams).toEqual([]);
	});

	it('hides an optimistically retired workstream until the retirement is forgotten', async () => {
		serviceMocks.workstreamsService.listWorkstreams.mockResolvedValue([
			workstream('a'),
			workstream('b'),
		]);
		serviceMocks.workstreamsService.listProjects.mockResolvedValue([]);

		const aggregate = new WorkstreamsAggregate();
		await aggregate.refresh();
		expect(aggregate.retireWorkstreamOptimistically('a')?.id).toBe('a');
		expect(aggregate.workstreams.map(({ id }) => id)).toEqual(['b']);

		aggregate.restoreRetiredWorkstream(workstream('a'));
		expect(aggregate.workstreams.map(({ id }) => id)).toEqual(['a', 'b']);
	});
});
