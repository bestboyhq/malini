<script lang="ts">
	import { page } from '$shared/router/state';
	import { Automations } from '$lib/automations/automations.api';
	import { automationsView } from '../automations-view';

	const TITLES = {
		overview: 'Automations',
		activity: 'Activity',
		explorer: 'Explorer',
		recipes: 'Recipes',
	} as const;

	const view = $derived(automationsView(page.route.id));
	const selectedAutomationId = $derived(page.params.automationId ?? null);
	const improving = $derived(page.route.id === '/automations/[automationId]/improve');
</script>

<svelte:head>
	<title>Malini · {improving ? 'Improve' : TITLES[view]}</title>
</svelte:head>

<main class="flex h-full min-h-0 min-w-0 flex-col" data-testid="automations-page">
	<div class="native-page-drag-strip" data-native-drag-region></div>
	<Automations {view} {selectedAutomationId} {improving} />
</main>
