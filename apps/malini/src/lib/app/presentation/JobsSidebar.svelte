<script lang="ts">
	import { page } from '$shared/router/state';
	import { AutomationsNav } from '$lib/jobs/jobs.api';
	import { jobTriggersQuery } from '$lib/routines/application/queries/job-triggers.query.svelte';
	import { pendingGatedRunCountQuery } from '$lib/routines/application/queries/pending-gated-run-count.query.svelte';
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
	const triggerOf = $derived(jobTriggersQuery.data);
	const waitingCount = $derived(pendingGatedRunCountQuery.data);
</script>

<SidebarFrame testId="jobs-sidebar">
	<AutomationsNav {backHref} {backLabel} {view} {selectedJobId} {triggerOf} {waitingCount} />
	<SidebarFooter />
</SidebarFrame>
