<script lang="ts">
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { onMount } from 'svelte';
	import { loadRuntimeInfoCommand } from '$lib/app/application/commands/load-runtime-info.command';
	import { runtimeInfoQuery } from '$lib/app/application/queries/runtime-info.query.svelte';
	import RecentDiagnostics from '$lib/app/presentation/RecentDiagnostics.svelte';
	import { isDevelopmentBuild } from '$shared/env/build-mode';

	const runtime = $derived(runtimeInfoQuery.data);
	const showDiagnostics = isDevelopmentBuild();

	onMount(() => {
		loadRuntimeInfoCommand();
	});
</script>

<svelte:head>
	<title>malini · Runtime</title>
</svelte:head>

<main
	class={[
		'flex h-full flex-col items-center gap-6 px-8',
		showDiagnostics ? 'overflow-y-auto py-12' : 'justify-center',
	]}
>
	<div class="text-center">
		<h1 class="text-fg-default text-2xl font-semibold tracking-tight">malini</h1>
		<p class="text-fg-secondary mt-1 text-sm">
			Local-only workstreams for your coding agent. Repeated prompts become routines.
		</p>
	</div>

	{#if runtime}
		<dl
			class="border-surface-150-border bg-surface-150 text-fg-secondary grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 rounded-md border px-5 py-4 font-mono text-xs"
			data-testid="runtime-info"
		>
			<dt>app</dt>
			<dd class="text-fg-default" data-testid="runtime-app">{runtime.app}</dd>
			<dt>electron</dt>
			<dd class="text-fg-default" data-testid="runtime-electron">{runtime.electron}</dd>
			<dt>node</dt>
			<dd class="text-fg-default" data-testid="runtime-node">{runtime.node}</dd>
			<dt>chrome</dt>
			<dd class="text-fg-default" data-testid="runtime-chrome">{runtime.chrome}</dd>
			<dt>sqlite</dt>
			<dd class="text-fg-default" data-testid="runtime-sqlite">{runtime.sqlite}</dd>
			<dt>data</dt>
			<dd class="text-fg-default" data-testid="runtime-data">
				<SensitiveText text={runtime.dataDirectory} />
			</dd>
		</dl>
	{/if}

	{#if showDiagnostics}
		<RecentDiagnostics />
	{/if}
</main>
