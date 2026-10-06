<script lang="ts">
	import { onMount } from 'svelte';
	import { ToastHost } from '$hyper-ui/components/toast';
	import { page } from '$shared/router/state';
	import Router from '$shared/router/Router.svelte';
	import { router } from '$shared/router/hash-router.svelte';
	import { ChatLifecycleMonitor } from '$lib/chat/chat.api';
	import { ExtensionRuntimeHost } from '$lib/extensions/extensions.api';
	import { watchRepositorySurfaceHook } from '$lib/pull-requests/application/hooks/watch-repository-surface.hook';
	import { notFound, routes } from '$lib/app/routes';
	import { bootAppHook } from '$lib/app/application/hooks/boot-app.hook';
	import { bootRoute, readLastRoute, rememberLastRoute } from '$shared/router/last-route';
	import AppShell from './AppShell.svelte';
	import CloseConfirmationDialog from './CloseConfirmationDialog.svelte';

	const startingRoute = bootRoute(window.location.hash, readLastRoute(), routes);
	if (window.location.hash !== `#${startingRoute}`) {
		window.history.replaceState(window.history.state, '', `#${startingRoute}`);
	}
	const stopRouter = router.start({ routes, notFound });
	const stopRemembering = router.afterNavigate(({ to }) => {
		if (to) rememberLastRoute(to.url);
	});

	$effect(() => watchRepositorySurfaceHook(() => page.params.workstreamId ?? ''));

	onMount(() => {
		const stopBoot = bootAppHook();
		return () => {
			stopBoot();
			stopRemembering();
			stopRouter();
		};
	});
</script>

<AppShell>
	<ExtensionRuntimeHost workstreamId={page.params.workstreamId ?? ''}>
		<ChatLifecycleMonitor />
		<Router />
	</ExtensionRuntimeHost>
</AppShell>

<CloseConfirmationDialog />

<ToastHost />
