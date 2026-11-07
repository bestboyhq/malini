<script lang="ts">
	import { onMount } from 'svelte';
	import {
		isOneShotAutomationBuiltin,
		type AutomationDefinitionRecord,
	} from '$contract/automations';
	import { Button } from '$hyper-ui/components/button';
	import { loadProviderCapabilitiesCommand } from '$shared/providers/providers.api';
	import {
		refreshWorkstreamsCommand,
		syncWorkstreamsHook,
	} from '$shared/repositories/repositories.api';
	import { loadAutomationsCommand } from '$lib/automations/application/commands/load-automations.command';
	import { watchAutomationsHook } from '$lib/automations/application/hooks/watch-automations.hook';
	import { builtinAutomationDefinitionsQuery } from '$lib/automations/application/queries/builtin-automation-definitions.query.svelte';
	import { customAutomationDefinitionsQuery } from '$lib/automations/application/queries/custom-automation-definitions.query.svelte';
	import { automationDefinitionByIdQuery } from '$lib/automations/application/queries/automation-definition-by-id.query.svelte';
	import { automationsLoadQuery } from '$lib/automations/application/queries/automations-load.query.svelte';
	import type { AutomationsView } from './automations-state.svelte';
	import AutomationsActivity from './AutomationsActivity.svelte';
	import AutomationsExplorer from './AutomationsExplorer.svelte';
	import AutomationsOverview from './AutomationsOverview.svelte';
	import AutomationsRecipes from './AutomationsRecipes.svelte';
	import AutomationDetail from './AutomationDetail.svelte';
	import AutomationImprove from './AutomationImprove.svelte';

	interface Props {
		view: AutomationsView;
		selectedAutomationId: string | null;
		improving: boolean;
	}

	let { view, selectedAutomationId, improving }: Props = $props();

	const load = $derived(automationsLoadQuery.data);
	const builtins = $derived(builtinAutomationDefinitionsQuery.data);
	const custom = $derived(customAutomationDefinitionsQuery.data);
	const automations = $derived<readonly AutomationDefinitionRecord[]>([...custom, ...builtins]);
	const selected = $derived(automationDefinitionByIdQuery.data(selectedAutomationId));

	onMount(() => {
		loadAutomationsCommand();
		refreshWorkstreamsCommand();
		loadProviderCapabilitiesCommand();
		const stopWatchingAutomations = watchAutomationsHook();
		const stopSyncingWorkstreams = syncWorkstreamsHook();
		return () => {
			stopSyncingWorkstreams();
			stopWatchingAutomations();
		};
	});
</script>

{#if load.state === 'error'}
	<div
		class="border-error-content/20 bg-error mx-auto mt-4 w-full max-w-[880px] rounded-xl border-[0.5px] px-4 py-3"
		role="alert"
	>
		<p class="text-error-content text-xs">{load.error}</p>
		<div class="mt-2">
			<Button variant="secondary" size="sm" onclick={() => loadAutomationsCommand()}>Retry</Button>
		</div>
	</div>
{:else if selected}
	{#key selected.id}
		{#if improving && isOneShotAutomationBuiltin(selected.builtin)}
			<AutomationImprove automation={selected} builtin={selected.builtin} />
		{:else}
			<AutomationDetail automation={selected} {automations} />
		{/if}
	{/key}
{:else if selectedAutomationId === null || load.state === 'ready'}
	{#if view === 'activity'}
		<AutomationsActivity {automations} />
	{:else if view === 'explorer'}
		<AutomationsExplorer {automations} />
	{:else if view === 'recipes'}
		<AutomationsRecipes />
	{:else}
		<AutomationsOverview {automations} />
	{/if}
{/if}
