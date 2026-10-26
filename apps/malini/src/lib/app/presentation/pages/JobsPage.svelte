<script lang="ts">
	import { page } from '$shared/router/state';
	import { Automations } from '$lib/jobs/jobs.api';
	import { jobsView } from '../jobs-view';

	const TITLES = {
		overview: 'Automations',
		activity: 'Activity',
		explorer: 'Explorer',
		recipes: 'Recipes',
	} as const;

	const view = $derived(jobsView(page.route.id));
	const selectedJobId = $derived(page.params.jobId ?? null);
	const improving = $derived(page.route.id === '/jobs/[jobId]/improve');
</script>

<svelte:head>
	<title>Malini · {improving ? 'Improve' : TITLES[view]}</title>
</svelte:head>

<main class="flex h-full min-h-0 min-w-0 flex-col" data-testid="jobs-page">
	<div class="native-page-drag-strip" data-native-drag-region></div>
	<Automations {view} {selectedJobId} {improving} />
</main>
