<script lang="ts">
	import { page } from '$shared/router/state';
	import { Automations } from '$lib/jobs/jobs.api';
	import { jobsView } from '../jobs-view';

	const TITLES = {
		overview: 'Automations',
		activity: 'Activity',
		recipes: 'Recipes',
	} as const;

	const view = $derived(jobsView(page.route.id));
	const selectedJobId = $derived(page.params.jobId ?? null);
</script>

<svelte:head>
	<title>Malini · {TITLES[view]}</title>
</svelte:head>

<main class="flex h-full min-h-0 p-2" data-testid="jobs-page">
	<div
		class="bg-surface-50 border-surface-50-border flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl border-[0.5px]"
	>
		<Automations {view} {selectedJobId} />
	</div>
</main>
