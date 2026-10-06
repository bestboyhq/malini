import { describe, expect, it } from 'vitest';

import {
	emptyInspectorPanelKeepAliveState,
	inspectorPanelKeepAliveEntry,
	reconcileInspectorPanelKeepAlive,
	type InspectorPanelKeepAliveInput,
	type InspectorPanelKeepAliveState,
} from './inspector-panel-keep-alive';

type Panel = Readonly<{ id: string }>;
type Context = Readonly<{ workstreamId: string; revision: number }>;
type State = InspectorPanelKeepAliveState<Panel, Context>;

const files = { id: 'malini.repository.files-panel' };
const terminal = { id: 'example.terminal.panel' };
const docker = { id: 'example.workstream-setup.panel' };
const browser = { id: 'example.browser.panel' };
const panels = [files, terminal, docker, browser] as const;

function contextFor(workstreamId: string, revision = 0): Context {
	return { workstreamId, revision };
}

function reconcile(
	current: State,
	input: Partial<InspectorPanelKeepAliveInput<Panel, Context>> = {},
): State {
	const workstreamId = input.workstreamId ?? 'workstream-a';
	return reconcileInspectorPanelKeepAlive(current, {
		workstreamId,
		panels,
		hiddenPanelIds: [],
		activePanelId: files.id,
		ready: true,
		allowActivePanelMount: true,
		mountBeforeReady: false,
		context: contextFor(workstreamId),
		...input,
	});
}

function visit(current: State, workstreamId: string, limit?: number): State {
	const arriving = reconcile(current, {
		workstreamId,
		ready: false,
		context: contextFor('runtime-still-elsewhere'),
		...(limit === undefined ? {} : { limit }),
	});
	return reconcile(arriving, { workstreamId, ...(limit === undefined ? {} : { limit }) });
}

function mountedWorkstreams(state: State): string[] {
	return state.entries.map(({ workstreamId }) => workstreamId);
}

describe('inspector panel keep-alive', () => {
	it('mounts panels lazily and retains their instances through browser-tab switches', () => {
		let state = reconcile(emptyInspectorPanelKeepAliveState());
		expect(inspectorPanelKeepAliveEntry(state, 'workstream-a')?.panels).toEqual([files]);

		state = reconcile(state, { activePanelId: terminal.id });
		state = reconcile(state, { activePanelId: docker.id });
		state = reconcile(state, { activePanelId: terminal.id });

		expect(inspectorPanelKeepAliveEntry(state, 'workstream-a')?.panels).toEqual([
			files,
			terminal,
			docker,
		]);
	});

	it('is stable when nothing changed, so an effect that reconciles on every run settles', () => {
		const context = contextFor('workstream-a');
		const state = reconcile(emptyInspectorPanelKeepAliveState(), { context });

		expect(reconcile(state, { context })).toBe(state);
		expect(reconcile(state, { context, ready: false })).toBe(state);
	});

	it('retains mounted panels while the runtime is not ready and drops unregistered ones once it is', () => {
		let state = reconcile(emptyInspectorPanelKeepAliveState(), { activePanelId: terminal.id });
		state = reconcile(state, { activePanelId: null, panels: [], ready: false });
		expect(inspectorPanelKeepAliveEntry(state, 'workstream-a')?.panels).toEqual([terminal]);

		state = reconcile(state, { activePanelId: null, panels: [files, docker] });
		expect(inspectorPanelKeepAliveEntry(state, 'workstream-a')).toBeNull();
	});

	it('keeps a visited workstream mounted with its own context while another one is presented', () => {
		let state = visit(emptyInspectorPanelKeepAliveState(), 'workstream-a');
		const firstVisit = inspectorPanelKeepAliveEntry(state, 'workstream-a');
		state = visit(state, 'workstream-b');

		state = reconcile(state, {
			workstreamId: 'workstream-a',
			ready: false,
			context: contextFor('workstream-b', 7),
		});

		const returning = inspectorPanelKeepAliveEntry(state, 'workstream-a');
		expect(returning).toBe(firstVisit);
		expect(returning?.context).toEqual(contextFor('workstream-a'));
		expect(inspectorPanelKeepAliveEntry(state, 'workstream-b')?.context).toEqual(
			contextFor('workstream-b'),
		);
	});

	it('mounts nothing for a workstream the runtime has not reached yet', () => {
		let state = visit(emptyInspectorPanelKeepAliveState(), 'workstream-a');

		state = reconcile(state, {
			workstreamId: 'workstream-c',
			ready: false,
			context: contextFor('workstream-a', 3),
		});

		expect(inspectorPanelKeepAliveEntry(state, 'workstream-c')).toBeNull();
		expect(mountedWorkstreams(state)).toEqual(['workstream-a']);
	});

	it('mounts a context-bound panel before the runtime is ready, with the destination context', () => {
		let state = visit(emptyInspectorPanelKeepAliveState(), 'workstream-a');

		state = reconcile(state, {
			workstreamId: 'workstream-c',
			ready: false,
			mountBeforeReady: true,
			context: contextFor('workstream-c'),
		});

		expect(inspectorPanelKeepAliveEntry(state, 'workstream-c')).toEqual({
			workstreamId: 'workstream-c',
			panels: [files],
			context: contextFor('workstream-c'),
		});
		expect(inspectorPanelKeepAliveEntry(state, 'workstream-a')?.context).toEqual(
			contextFor('workstream-a'),
		);
	});

	it('keeps a revisited workstream on its own frozen context until the runtime reaches it', () => {
		let state = visit(emptyInspectorPanelKeepAliveState(), 'workstream-a');
		state = visit(state, 'workstream-b');

		state = reconcile(state, {
			workstreamId: 'workstream-a',
			ready: false,
			mountBeforeReady: true,
			activePanelId: terminal.id,
			context: contextFor('workstream-a', 5),
		});

		const entry = inspectorPanelKeepAliveEntry(state, 'workstream-a');
		expect(entry?.panels).toEqual([files, terminal]);
		expect(entry?.context).toEqual(contextFor('workstream-a'));
	});

	it('hands the presented workstream the fresh context once the runtime reaches it', () => {
		let state = visit(emptyInspectorPanelKeepAliveState(), 'workstream-a');
		state = visit(state, 'workstream-b');

		state = reconcile(state, {
			workstreamId: 'workstream-a',
			context: contextFor('workstream-a', 2),
		});

		expect(inspectorPanelKeepAliveEntry(state, 'workstream-a')?.context).toEqual(
			contextFor('workstream-a', 2),
		);
		expect(inspectorPanelKeepAliveEntry(state, 'workstream-b')?.context).toEqual(
			contextFor('workstream-b'),
		);
	});

	it('drops a panel from every workstream once it is no longer registered', () => {
		let state = visit(emptyInspectorPanelKeepAliveState(), 'workstream-a');
		state = visit(state, 'workstream-b');

		state = reconcile(state, {
			workstreamId: 'workstream-b',
			panels: [terminal],
			activePanelId: terminal.id,
		});

		expect(inspectorPanelKeepAliveEntry(state, 'workstream-a')).toBeNull();
		expect(inspectorPanelKeepAliveEntry(state, 'workstream-b')?.panels).toEqual([terminal]);
	});

	it('evicts the least recently presented workstream beyond the limit', () => {
		let state = visit(emptyInspectorPanelKeepAliveState(), 'workstream-a', 2);
		state = visit(state, 'workstream-b', 2);
		state = visit(state, 'workstream-a', 2);
		state = visit(state, 'workstream-c', 2);

		expect(mountedWorkstreams(state)).toEqual(['workstream-a', 'workstream-c']);
	});

	it('keeps render order stable when an older workstream is presented again', () => {
		let state = visit(emptyInspectorPanelKeepAliveState(), 'workstream-a');
		state = visit(state, 'workstream-b');
		state = visit(state, 'workstream-a');

		expect(mountedWorkstreams(state)).toEqual(['workstream-a', 'workstream-b']);
	});

	it('defers a new host while the drawer or directory covers it without evicting mounted hosts', () => {
		let state = visit(emptyInspectorPanelKeepAliveState(), 'workstream-a');

		state = reconcile(state, { activePanelId: terminal.id, allowActivePanelMount: false });
		expect(inspectorPanelKeepAliveEntry(state, 'workstream-a')?.panels).toEqual([files]);

		state = reconcile(state, {
			workstreamId: 'workstream-b',
			activePanelId: terminal.id,
			allowActivePanelMount: false,
		});
		expect(inspectorPanelKeepAliveEntry(state, 'workstream-b')).toBeNull();
		expect(inspectorPanelKeepAliveEntry(state, 'workstream-a')?.panels).toEqual([files]);

		state = reconcile(state, { workstreamId: 'workstream-b', activePanelId: terminal.id });
		expect(inspectorPanelKeepAliveEntry(state, 'workstream-b')?.panels).toEqual([terminal]);
	});

	it('closes a hidden panel before the runtime is ready', () => {
		let state = reconcile(emptyInspectorPanelKeepAliveState(), { activePanelId: terminal.id });

		state = reconcile(state, { hiddenPanelIds: [terminal.id], ready: false });

		expect(inspectorPanelKeepAliveEntry(state, 'workstream-a')).toBeNull();
	});
});
