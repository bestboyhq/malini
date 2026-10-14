import type { ExtensionWorkstream } from '@malini/extension-api';
import { flushSync, mount, unmount } from 'svelte';
import WorkstreamTopBarStatus from './WorkstreamTopBarStatus.svelte';

export type TopBarStatusRoute = Readonly<{
	workstreamId: string;
	extensionReady: boolean;
	extensionGeneration: number;
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
		ongitstatusstale: (): void => undefined,
		onarchive: (): void => undefined,
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

function routeProps(route: TopBarStatusRoute): Readonly<{
	workstreamId: string;
	extensionReady: boolean;
	extensionGeneration: number;
	extensionWorkstream: ExtensionWorkstream | null;
}> {
	return {
		workstreamId: route.workstreamId,
		extensionReady: route.extensionReady,
		extensionGeneration: route.extensionGeneration,
		extensionWorkstream: route.extensionReady
			? activatedWorkstream(route.workstreamId, route.extensionGeneration)
			: null,
	};
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
