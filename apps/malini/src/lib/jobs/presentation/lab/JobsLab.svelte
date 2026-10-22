<script lang="ts">
	import { onMount } from 'svelte';
	import type { JobDefinitionRecord } from '$contract/jobs';
	import { Badge } from '$hyper-ui/components/badge';
	import { Button } from '$hyper-ui/components/button';
	import { loadProviderCapabilitiesCommand } from '$shared/providers/providers.api';
	import {
		refreshWorkstreamsCommand,
		syncWorkstreamsHook,
	} from '$shared/repositories/repositories.api';
	import { loadJobsCommand } from '$lib/jobs/application/commands/load-jobs.command';
	import { watchJobsHook } from '$lib/jobs/application/hooks/watch-jobs.hook';
	import { builtinJobDefinitionsQuery } from '$lib/jobs/application/queries/builtin-job-definitions.query.svelte';
	import { customJobDefinitionsQuery } from '$lib/jobs/application/queries/custom-job-definitions.query.svelte';
	import { labDefaultSetup, type LabJobSetup } from './lab-triggers';
	import LabVariantActivity from './LabVariantActivity.svelte';
	import LabVariantRecipes from './LabVariantRecipes.svelte';
	import LabVariantSentence from './LabVariantSentence.svelte';
	import LabVariantTable from './LabVariantTable.svelte';

	type Variant = 'sentence' | 'activity' | 'recipes' | 'table';

	const VARIANTS: readonly Readonly<{ value: Variant; label: string; idea: string }>[] = [
		{
			value: 'sentence',
			label: 'A · Sentence',
			idea: 'Every job reads as one sentence: when this happens, do that, then this.',
		},
		{
			value: 'activity',
			label: 'B · Activity',
			idea: 'Lead with what ran and what waits for you; jobs are filters, setup is a sheet.',
		},
		{
			value: 'recipes',
			label: 'C · Recipes',
			idea: 'Describe what you want or start from a recipe; your automations are cards.',
		},
		{
			value: 'table',
			label: 'D · Table',
			idea: 'One dense table: when, how it runs, last run. Switch modes inline.',
		},
	];

	let variant = $state<Variant>('sentence');
	let setups = $state<Record<string, LabJobSetup>>({});

	const builtins = $derived(builtinJobDefinitionsQuery.data);
	const custom = $derived(customJobDefinitionsQuery.data);
	const jobs = $derived<readonly JobDefinitionRecord[]>([...custom, ...builtins]);
	const idea = $derived(VARIANTS.find((option) => option.value === variant)?.idea ?? '');

	onMount(() => {
		loadJobsCommand();
		refreshWorkstreamsCommand();
		loadProviderCapabilitiesCommand();
		const stopWatchingJobs = watchJobsHook();
		const stopSyncingWorkstreams = syncWorkstreamsHook();
		return () => {
			stopSyncingWorkstreams();
			stopWatchingJobs();
		};
	});

	function setupOf(definition: JobDefinitionRecord): LabJobSetup {
		return setups[definition.id] ?? labDefaultSetup(definition);
	}

	function onSetup(definition: JobDefinitionRecord, setup: LabJobSetup): void {
		setups[definition.id] = setup;
	}
</script>

<main class="flex h-full min-h-0 flex-col" data-testid="jobs-lab">
	<header class="flex shrink-0 items-center gap-4 px-6 pt-3 pb-4">
		<h1 class="text-fg-default text-xl font-semibold tracking-tight">Jobs</h1>
		<Badge variant="warning">Lab</Badge>
		<nav
			class="bg-surface-50 border-surface-50-border inline-flex gap-0.5 rounded-[9px] border-[0.5px] p-0.5"
			aria-label="Variants"
		>
			{#each VARIANTS as option (option.value)}
				<Button
					size="sm"
					variant="ghost"
					active={option.value === variant}
					ariaPressed={option.value === variant}
					onclick={() => (variant = option.value)}
				>
					{option.label}
				</Button>
			{/each}
		</nav>
		<p class="text-fg-tertiary min-w-0 flex-1 truncate text-xs">{idea}</p>
	</header>
	{#if variant === 'sentence'}
		<LabVariantSentence {jobs} {setupOf} onsetup={onSetup} />
	{:else if variant === 'activity'}
		<LabVariantActivity {jobs} {setupOf} onsetup={onSetup} />
	{:else if variant === 'recipes'}
		<LabVariantRecipes {jobs} {setupOf} onsetup={onSetup} />
	{:else}
		<LabVariantTable {jobs} {setupOf} onsetup={onSetup} />
	{/if}
</main>
