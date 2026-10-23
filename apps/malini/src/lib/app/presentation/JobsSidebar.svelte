<script lang="ts">
	import { page } from '$shared/router/state';
	import { AutomationsNav } from '$lib/jobs/jobs.api';
	import { jobsView } from './jobs-view';
	import SidebarFooter from './SidebarFooter.svelte';
	import SidebarFrame from './SidebarFrame.svelte';

	interface Props {
		backHref: string;
		backLabel: string;
	}

	let { backHref, backLabel }: Props = $props();

	const view = $derived(jobsView(page.route.id));
	const selectedJobId = $derived(page.params.jobId ?? null);
</script>

<SidebarFrame testId="jobs-sidebar">
	<AutomationsNav {backHref} {backLabel} {view} {selectedJobId} />
	<SidebarFooter />
</SidebarFrame>
