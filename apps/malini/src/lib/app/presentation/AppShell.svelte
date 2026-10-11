<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { afterNavigate, beforeNavigate } from '$shared/router/navigation';
	import TopBar from './TopBar.svelte';
	import {
		exposeRuntimeDiagnostics,
		runtimeDiagnostics,
	} from '$shared/performance/runtime-diagnostics.svelte';
	import {
		globalTopBarBandSlot,
		provideGlobalTopBarActions,
	} from '$shared/shell/global-topbar-actions.svelte';
	import { sidebarCollapsedQuery } from '$lib/app/application/queries/sidebar-collapsed.query.svelte';
	import { sidebarPresenceQuery } from '$lib/app/application/queries/sidebar-presence.query.svelte';
	import { forgetRemovedWorkstreamChatsHook } from '$lib/chat/application/hooks/forget-removed-workstream-chats.hook';
	import { forgetRemovedWorkstreamSurfacesHook } from '$lib/pull-requests/application/hooks/forget-removed-workstream-surfaces.hook';
	import { announceLocalBaseSyncHook } from '$lib/pull-requests/application/hooks/announce-local-base-sync.hook';
	import { watchShipStatesHook } from '$lib/pull-requests/application/hooks/watch-ship-states.hook';
	import {
		activeWorkstreamsQuery,
		connectedRepositoriesQuery,
		displayWorkstreamName,
		repositoryContextForWorkstream,
	} from '$shared/repositories/repositories.api';
	import { provideSettingsOrigin } from './settings/settings-origin';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
	const globalTopBarActions = provideGlobalTopBarActions();
	const settingsOrigin = provideSettingsOrigin();
	const stagePaysBandReserve = $derived(
		sidebarCollapsedQuery.data && sidebarPresenceQuery.data && !globalTopBarBandSlot.adopted,
	);
	const workstreams = $derived(activeWorkstreamsQuery.data);
	const repositories = $derived(connectedRepositoriesQuery.data);
	let shell: HTMLDivElement | undefined = $state();

	beforeNavigate(({ from, to }) => settingsOrigin.follow(from?.url, to?.url, shell));

	afterNavigate(({ to }) => {
		if (to?.url) runtimeDiagnostics.completeNavigation(`${to.url.pathname}${to.url.search}`);
	});

	onMount(() => {
		const stopRuntimeWatchdog = runtimeDiagnostics.installMainThreadWatchdog();
		const hideRuntimeDiagnostics = exposeRuntimeDiagnostics();
		const stopForgettingChats = forgetRemovedWorkstreamChatsHook();
		const stopForgettingSurfaces = forgetRemovedWorkstreamSurfacesHook();
		const stopAnnouncingLocalBaseSync = announceLocalBaseSyncHook();
		const stopWatchingShips = watchShipStatesHook(workstreamName);
		return () => {
			stopWatchingShips();
			stopAnnouncingLocalBaseSync();
			stopForgettingSurfaces();
			stopForgettingChats();
			stopRuntimeWatchdog();
			hideRuntimeDiagnostics();
			runtimeDiagnostics.reset();
		};
	});

	function workstreamName(workstreamId: string): string | null {
		const workstream = workstreams.find(({ id }) => id === workstreamId);
		if (!workstream) return null;
		const context = repositoryContextForWorkstream({ repositories, workstreams, workstreamId });
		return displayWorkstreamName(workstream, context?.repo.fullName);
	}
</script>

<div class="flex h-screen font-sans" bind:this={shell}>
	<TopBar actions={globalTopBarActions.actions} />

	<div class="native-shell-safe-frame flex h-full w-full">
		<div class="relative flex min-w-0 flex-1">
			<div class="flex min-w-0 flex-1">
				<div class="styled-scrollbar relative flex h-full w-full overflow-auto sm:overflow-hidden">
					<div class="flex h-full w-full flex-col gap-1 sm:gap-3">
						<div
							class="bg-surface-root flex h-full w-full overflow-hidden"
							class:native-band-row-reserve={stagePaysBandReserve}
							data-testid="workstream-content-card"
						>
							<div class="relative min-h-0 flex-1 overflow-hidden" data-testid="workstream-pane">
								<div class="h-full w-full">
									{@render children()}
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
