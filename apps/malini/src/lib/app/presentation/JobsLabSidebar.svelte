<script lang="ts">
	import { JobsLabNav } from '$lib/jobs/jobs.api';
	import SidebarFooter from './SidebarFooter.svelte';
	import SidebarFrame from './SidebarFrame.svelte';

	interface Props {
		backHref: string;
		backLabel: string;
	}

	let { backHref, backLabel }: Props = $props();
</script>

<SidebarFrame testId="jobs-lab-sidebar">
	<JobsLabNav {backHref} {backLabel} />
	<SidebarFooter />
</SidebarFrame>
