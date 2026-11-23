<script lang="ts">
	import { page } from '$shared/router/state';
	import { BrainNav } from '$lib/brain/brain.api';
	import SidebarFooter from './SidebarFooter.svelte';
	import SidebarFrame from './SidebarFrame.svelte';
	import UpdateStatus from './UpdateStatus.svelte';

	interface Props {
		backHref: string;
		backLabel: string;
	}

	let { backHref, backLabel }: Props = $props();
</script>

<SidebarFrame testId="brain-sidebar">
	<BrainNav {backHref} {backLabel} selectedPath={page.params.path ?? null} />
	<UpdateStatus />
	<SidebarFooter />
</SidebarFrame>
