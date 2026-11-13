<script lang="ts">
	import { onMount } from 'svelte';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { loadRuntimeInfoCommand } from '$lib/app/application/commands/load-runtime-info.command';
	import { runtimeInfoQuery } from '$lib/app/application/queries/runtime-info.query.svelte';
	import { ProfileBadge, StatsReadout } from '$lib/stats/stats.api';
	import HelpMenu from './HelpMenu.svelte';
	import UpdateStatus from './UpdateStatus.svelte';

	let statsOpen: boolean = $state(false);
	const version = $derived(runtimeInfoQuery.data?.app);

	onMount(loadRuntimeInfoCommand);
</script>

<UpdateStatus />

<div
	class="border-surface-50-border flex shrink-0 items-center gap-1 border-t py-1.5 pr-1.5 pl-2.5"
>
	<ProfileBadge onopenstats={() => (statsOpen = true)} />
	<div class="ml-auto flex min-w-0 items-center gap-0.5">
		<Tooltip content="Beta. Ships about five times a day" placement="top" class="shrink-0">
			<span
				class="text-fg-tertiary text-2xs flex h-6 items-center gap-1.5 px-1.5 font-medium whitespace-nowrap"
			>
				Beta
				{#if version}
					<span class="tabular-nums opacity-70">{version}</span>
				{/if}
			</span>
		</Tooltip>
		<HelpMenu />
		<StatsReadout bind:open={statsOpen} />
	</div>
</div>
