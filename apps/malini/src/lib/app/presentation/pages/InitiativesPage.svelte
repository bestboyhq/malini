<script lang="ts">
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { startDependencyWorkstreamCommand } from '$lib/app/application/commands/start-dependency-workstream.command';
	import { workstreamStandingQuery } from '$lib/app/application/queries/workstream-standing.query.svelte';
	import { loadInitiativesCommand } from '$lib/initiatives/application/commands/load-initiatives.command';
	import { initiativesQuery } from '$lib/initiatives/application/queries/initiatives.query.svelte';
	import { Initiatives } from '$lib/initiatives/initiatives.api';

	const initiatives = $derived(initiativesQuery.loaded ? initiativesQuery.data : null);
	const linkedDots = $derived(
		initiatives
			?.flatMap(({ dependencies }) => dependencies)
			.flatMap(({ workstreams }) => workstreams)
			.map(({ workstreamId }) => workstreamStandingQuery.of(workstreamId)?.dot ?? 'gone')
			.join(' ') ?? null,
	);

	let seenDots: string | null = null;

	$effect(() => {
		if (linkedDots === null) return;
		if (seenDots !== null && seenDots !== linkedDots) loadInitiativesCommand();
		seenDots = linkedDots;
	});
</script>

<svelte:head>
	<title>Malini · Initiatives</title>
</svelte:head>

<main class="flex h-full min-h-0 min-w-0 flex-col" data-testid="initiatives-page">
	<div class="native-page-drag-strip" data-native-drag-region></div>
	<ScrollableDiv class="min-h-0 flex-1">
		<Initiatives
			standingOf={workstreamStandingQuery.of}
			onstart={startDependencyWorkstreamCommand}
		/>
	</ScrollableDiv>
</main>
