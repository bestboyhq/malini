import type { ExtensionWorkstream } from '@malini/extension-api';
import { flushSync, mount, unmount } from 'svelte';
import WorkstreamTopBarStatus from './WorkstreamTopBarStatus.svelte';

export type TopBarStatusRoute = Readonly<{
	workstreamId: string;
	extensionReady: boolean;
	extensionGeneration: number;
	extensionError?: string | null;
	extensionWorkstreamId?: string | null;
}>;

export type TopBarStatusHarness = Readonly<{
	show(route: TopBarStatusRoute): void;
	stop(): void;
}>;

export function mountWorkstreamTopBarStatus(route: TopBarStatusRoute): TopBarStatusHarness {
	const host = document.createElement('div');
	document.body.append(host);
	const props = $state({
		...routeProps(route),
		agentSessionId: null,
		repositoryScopeReady: true,
		remotePullRequestsSupported: true,
		repositoryExtensionRegistered: true,
		agentRunning: false,
		overrideStatus: null,
		submitPrompt: async (): Promise<void> => undefined,
		chatEvidence: () => ({}),
		onpanelrequested: (): void => undefined,
		ongitstatusstale: (): void => undefined,
	});
	const app = mount(WorkstreamTopBarStatus, { target: host, props });
	flushSync();
	return {
		show(next: TopBarStatusRoute): void {
			Object.assign(props, routeProps(next));
			flushSync();
		},
		stop(): void {
			void unmount(app);
			host.remove();
		},
	};
}

export type ExtensionRuntimeReadings = Readonly<{
	ready(workstreamId: string): boolean;
	workstream(): ExtensionWorkstream | null;
	generation(): number;
	error(): string | null;
}>;

export type RuntimeTopBarStatusHarness = Readonly<{
	currentWorkstreamId(): string;
	goTo(workstreamId: string): void;
	stop(): void;
}>;

export function mountWorkstreamTopBarStatusOnTheRuntime(
	workstreamId: string,
	runtime: ExtensionRuntimeReadings,
): RuntimeTopBarStatusHarness {
	const host = document.createElement('div');
	document.body.append(host);
	const route = $state({ workstreamId });
	const app = mount(WorkstreamTopBarStatus, {
		target: host,
		props: {
			get workstreamId(): string {
				return route.workstreamId;
			},
			get extensionReady(): boolean {
				return runtime.ready(route.workstreamId);
			},
			get extensionWorkstream(): ExtensionWorkstream | null {
				return runtime.workstream();
			},
			get extensionGeneration(): number {
				return runtime.generation();
			},
			get extensionError(): string | null {
				return runtime.error();
			},
			agentSessionId: null,
			repositoryScopeReady: true,
			remotePullRequestsSupported: true,
			repositoryExtensionRegistered: true,
			agentRunning: false,
			overrideStatus: null,
			submitPrompt: async (): Promise<void> => undefined,
			chatEvidence: () => ({}),
			onpanelrequested: (): void => undefined,
			ongitstatusstale: (): void => undefined,
		},
	});
	flushSync();
	return {
		currentWorkstreamId: () => route.workstreamId,
		goTo(next: string): void {
			route.workstreamId = next;
			flushSync();
		},
		stop(): void {
			void unmount(app);
			host.remove();
		},
	};
}

function routeProps(route: TopBarStatusRoute): Readonly<{
	workstreamId: string;
	extensionReady: boolean;
	extensionError: string | null;
	extensionGeneration: number;
	extensionWorkstream: ExtensionWorkstream | null;
}> {
	return {
		workstreamId: route.workstreamId,
		extensionReady: route.extensionReady,
		extensionError: route.extensionError ?? null,
		extensionGeneration: route.extensionGeneration,
		extensionWorkstream: extensionWorkstreamOf(route),
	};
}

function extensionWorkstreamOf(route: TopBarStatusRoute): ExtensionWorkstream | null {
	if (route.extensionWorkstreamId !== undefined) {
		return route.extensionWorkstreamId === null
			? null
			: activatedWorkstream(route.extensionWorkstreamId, route.extensionGeneration);
	}
	return route.extensionReady
		? activatedWorkstream(route.workstreamId, route.extensionGeneration)
		: null;
}

const activations = new Map<string, ExtensionWorkstream>();

function activatedWorkstream(workstreamId: string, generation: number): ExtensionWorkstream {
	const key = `${workstreamId}:${generation}`;
	const known = activations.get(key);
	if (known) return known;
	const activated: ExtensionWorkstream = {
		id: workstreamId,
		path: `/tmp/${workstreamId}`,
		repositoryPath: `/tmp/${workstreamId}`,
		branch: `feature/${workstreamId}`,
		baseBranch: 'main',
	};
	activations.set(key, activated);
	return activated;
}
