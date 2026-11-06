<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import { fly } from 'svelte/transition';
	import { motionOff } from '$hyper-ui/motion/motion-off';
	import type { AutomationDefinitionRecord } from '$contract/automations';
	import { Button } from '$hyper-ui/components/button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { BusyIcon, Icon, type IconName } from '$hyper-ui/icons';
	import {
		AUTOMATIONS_ACTIVITY_HREF,
		AUTOMATIONS_EXPLORER_HREF,
		AUTOMATIONS_HREF,
		AUTOMATIONS_RECIPES_HREF,
		automationHref,
	} from '$shared/router/routes-hrefs';
	import { builtinAutomationDefinitionsQuery } from '$lib/automations/application/queries/builtin-automation-definitions.query.svelte';
	import { customAutomationDefinitionsQuery } from '$lib/automations/application/queries/custom-automation-definitions.query.svelte';
	import { liveAutomationsQuery } from '$lib/automations/application/queries/live-automations.query.svelte';
	import { automationRunsForDefinitionQuery } from '$lib/automations/application/queries/automation-runs-for-definition.query.svelte';
	import { canLeak } from '$lib/automations/domain/automation-boundary';
	import { asksYou } from '$lib/automations/domain/live-automations';
	import type { AutomationsView } from './automations-state.svelte';
	import { automationTriggerLook } from './triggers';

	interface Props {
		backHref: string;
		backLabel: string;
		view: AutomationsView;
		selectedAutomationId: string | null;
	}

	let { backHref, backLabel, view, selectedAutomationId }: Props = $props();

	const SECTIONS: readonly Readonly<{
		value: AutomationsView;
		label: string;
		icon: IconName;
		href: string;
	}>[] = [
		{ value: 'overview', label: 'Overview', icon: 'sparkles', href: AUTOMATIONS_HREF },
		{ value: 'activity', label: 'Activity', icon: 'clock', href: AUTOMATIONS_ACTIVITY_HREF },
		{ value: 'explorer', label: 'Explorer', icon: 'workflow', href: AUTOMATIONS_EXPLORER_HREF },
		{ value: 'recipes', label: 'Recipes', icon: 'gift', href: AUTOMATIONS_RECIPES_HREF },
	];

	const builtins = $derived(builtinAutomationDefinitionsQuery.data);
	const custom = $derived(customAutomationDefinitionsQuery.data);
	const runsFor = $derived(automationRunsForDefinitionQuery.data);
	const automations = $derived<readonly AutomationDefinitionRecord[]>([...custom, ...builtins]);
	const asking = $derived(
		new Set(
			liveAutomationsQuery.data.filter(asksYou).map((entry) => entry.run?.definitionId ?? null),
		),
	);

	function slideIn(node: HTMLElement): ReturnType<typeof fly> {
		return fly(node, {
			x: 24,
			duration: motionOff() ? 0 : 220,
			easing: cubicOut,
		});
	}
</script>

<div class="flex min-h-0 flex-1 flex-col" in:slideIn data-testid="automations-nav">
	<div class="px-2.5 pt-1">
		<Button bare href={backHref} class="sidebar-row text-fg-secondary w-full gap-1.5 px-2">
			<Icon name="chevron-left" size={14} />
			<span class="min-w-0 truncate">{backLabel}</span>
		</Button>
	</div>

	<nav class="flex flex-col gap-px px-2.5 pt-4" aria-label="Automations">
		<h2 class="text-fg-tertiary px-2 pt-1 pb-2.5 text-xs font-medium">Automations</h2>
		{#each SECTIONS as section (section.value)}
			{@const current = selectedAutomationId === null && view === section.value}
			<Button
				bare
				href={section.href}
				{...current ? { ariaCurrent: 'page' as const } : {}}
				class={[
					'sidebar-row w-full gap-2 px-2',
					current ? 'sidebar-row-active' : 'text-fg-secondary',
				]}
			>
				<Icon name={section.icon} size={16} class="shrink-0" />
				<span class="min-w-0 flex-1 truncate text-left">{section.label}</span>
			</Button>
		{/each}
	</nav>

	<h3 class="text-fg-tertiary px-4.5 pt-6 pb-2.5 text-xs font-medium">Your automations</h3>
	<ScrollableDiv class="min-h-0 flex-1" ariaLabel="Your automations">
		<ul class="flex flex-col gap-px px-2.5 pb-4">
			{#each automations as automation (automation.id)}
				{@const runs = runsFor(automation.id)}
				{@const current = selectedAutomationId === automation.id}
				{@const off = automation.trigger?.mode === 'off'}
				<li>
					<Button
						bare
						href={automationHref(automation.id)}
						{...current ? { ariaCurrent: 'page' as const } : {}}
						class={[
							'sidebar-row w-full gap-2 px-2',
							current ? 'sidebar-row-active' : 'text-fg-secondary',
						]}
					>
						<Icon
							name={automationTriggerLook(automation).icon}
							size={13}
							class="text-fg-tertiary shrink-0"
						/>
						<span
							class={[
								'min-w-0 flex-1 truncate text-left',
								off ? 'text-fg-tertiary' : 'text-fg-default',
							]}
						>
							{automation.name}
						</span>
						{#if asking.has(automation.id)}
							<Icon name="dot" size={12} class="text-brand-icon shrink-0" />
							<span class="sr-only">Needs you</span>
						{:else if runs.some((run) => run.status === 'running')}
							<BusyIcon size={11} />
							<span class="sr-only">Running</span>
						{:else if canLeak(automation, automations)}
							<span class="text-error-content text-2xs flex shrink-0 items-center gap-1">
								<Icon name="warning" size={11} />
								Can leak
							</span>
						{:else if off}
							<span class="text-fg-tertiary text-2xs shrink-0">Off</span>
						{:else if automation.trigger?.mode === 'ask'}
							<span class="text-fg-tertiary text-2xs shrink-0">Asks</span>
						{/if}
					</Button>
				</li>
			{/each}
		</ul>
	</ScrollableDiv>
</div>
