import { flushSync, mount, unmount } from 'svelte';
import { beforeEach, describe, expect, it } from 'vitest';

import { inspectorDrawer } from '$shared/extensions/inspector-drawer.store.svelte';

import ExtensionInspectorShell from './ExtensionInspectorShell.svelte';
import {
	contextBoundPanel,
	InspectorSwitchProps,
	RuntimeWorkstream,
	runtimeBoundPanel,
} from './fixtures/inspector-switch-harness.svelte';

type Presented = Readonly<{ workstreamId: string | null; text: string }>;

type Harness = Readonly<{
	host: HTMLElement;
	props: InspectorSwitchProps;
	runtime: RuntimeWorkstream;
	arrive(workstreamId: string): Promise<readonly Presented[]>;
	commit(): Promise<readonly Presented[]>;
	visit(workstreamId: string): Promise<void>;
	stop(): void;
}>;

describe('switching workstreams in the inspector', () => {
	beforeEach(() => {
		globalThis.localStorage?.clear();
	});

	it('returns to a visited workstream with its own kept-alive panel before the runtime switches', async () => {
		const mounts: string[] = [];
		const harness = render([contextBoundPanel('malini.repository.files-panel', mounts)]);
		await harness.visit('workstream-a');
		await harness.visit('workstream-b');

		const firstFrame = await harness.arrive('workstream-a');

		expect(firstFrame).toEqual([{ workstreamId: 'workstream-a', text: 'Files of workstream-a' }]);
		expect(mounts).toEqual(['workstream-a', 'workstream-b']);
		expect(inspectorBusy(harness.host)).toBe(false);
		expect(presentedTakesInput(harness.host)).toBe(true);
		harness.stop();
	});

	it('never presents another workstream panel under the route, in any frame of a switch', async () => {
		const harness = render([contextBoundPanel('malini.repository.files-panel', [])]);
		const frames: Array<Readonly<{ route: string; presented: readonly Presented[] }>> = [];
		for (const route of ['workstream-a', 'workstream-b', 'workstream-a', 'workstream-b']) {
			frames.push({ route, presented: await harness.arrive(route) });
			frames.push({ route, presented: await harness.commit() });
		}

		for (const { route, presented } of frames) {
			expect(presented).toEqual([{ workstreamId: route, text: `Files of ${route}` }]);
		}
		harness.stop();
	});

	it('shows a context-bound panel on a first visit before the runtime reaches the workstream', async () => {
		const harness = render([contextBoundPanel('malini.repository.files-panel', [])]);
		await harness.visit('workstream-a');

		expect(await harness.arrive('workstream-c')).toEqual([
			{ workstreamId: 'workstream-c', text: 'Files of workstream-c' },
		]);
		expect(presentedTakesInput(harness.host)).toBe(true);
		harness.stop();
	});

	it('keeps the panel mounted while the drawer is closed and presents it again on reopening', async () => {
		const mounts: string[] = [];
		const harness = render([contextBoundPanel('malini.repository.files-panel', mounts)]);
		await harness.visit('workstream-a');

		harness.host.querySelector<HTMLElement>('[data-testid="extension-inspector-hide"]')?.click();
		await settle();
		expect(presented(harness.host)).toEqual([]);

		inspectorDrawer.open('workstream-a');
		await settle();
		expect(presented(harness.host)).toEqual([
			{ workstreamId: 'workstream-a', text: 'Files of workstream-a' },
		]);
		expect(mounts).toEqual(['workstream-a']);
		harness.stop();
	});

	it('holds back a runtime-bound panel until the runtime reaches the workstream', async () => {
		const runtime = new RuntimeWorkstream();
		const harness = render([runtimeBoundPanel('example.terminal.panel', runtime)], runtime);
		await harness.visit('workstream-a');
		await harness.visit('workstream-b');

		expect(await harness.arrive('workstream-a')).toEqual([]);
		expect(harness.host.querySelector('[data-testid="inspector-cold-shell"]')).not.toBeNull();
		expect(inspectorBusy(harness.host)).toBe(true);
		expect(await harness.commit()).toEqual([
			{ workstreamId: 'workstream-a', text: 'Terminal of workstream-a' },
		]);
		harness.stop();
	});
});

function render(
	panels: InspectorSwitchProps['panels'],
	runtime: RuntimeWorkstream = new RuntimeWorkstream(),
): Harness {
	const props = new InspectorSwitchProps();
	props.panels = panels;
	props.ready = false;
	const host = document.createElement('div');
	document.body.append(host);
	const app = mount(ExtensionInspectorShell, {
		target: host,
		props: {
			get workstreamId() {
				return props.workstreamId;
			},
			get panels() {
				return props.panels;
			},
			get context() {
				return props.context;
			},
			get ready() {
				return props.ready;
			},
		},
	});
	flushSync();

	const arrive = async (workstreamId: string): Promise<readonly Presented[]> => {
		props.workstreamId = workstreamId;
		props.ready = false;
		flushSync();
		await settle();
		return presented(host);
	};
	const commit = async (): Promise<readonly Presented[]> => {
		runtime.switchTo(props.workstreamId);
		props.ready = true;
		flushSync();
		await settle();
		return presented(host);
	};
	return {
		host,
		props,
		runtime,
		arrive,
		commit,
		visit: async (workstreamId) => {
			await arrive(workstreamId);
			await commit();
		},
		stop: () => {
			void unmount(app);
			host.remove();
		},
	};
}

function presented(host: HTMLElement): readonly Presented[] {
	return [...host.querySelectorAll('[data-testid="extension-inspector-content"]')].map(
		(content) => ({
			workstreamId: content.getAttribute('data-navigation-workstream-id'),
			text: content.textContent?.trim() ?? '',
		}),
	);
}

function presentedTakesInput(host: HTMLElement): boolean {
	const content = host.querySelector<HTMLElement>('[data-testid="extension-inspector-content"]');
	return content !== null && !content.inert;
}

function inspectorBusy(host: HTMLElement): boolean {
	return host.querySelector('[aria-label="Inspector"]')?.getAttribute('aria-busy') === 'true';
}

async function settle(): Promise<void> {
	for (let turn = 0; turn < 4; turn += 1) {
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		flushSync();
	}
}
