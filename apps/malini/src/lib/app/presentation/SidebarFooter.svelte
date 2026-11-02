<script lang="ts">
	import { ProfileBadge, StatsReadout } from '$lib/stats/stats.api';
	import UpdateStatus from './UpdateStatus.svelte';

	let statsOpen: boolean = $state(false);
</script>

<UpdateStatus />

<div
	class="border-surface-50-border flex shrink-0 items-center gap-1 border-t py-1.5 pr-1.5 pl-2.5"
>
	<ProfileBadge onopenstats={() => (statsOpen = true)} />
	<StatsReadout bind:open={statsOpen} />
</div>
