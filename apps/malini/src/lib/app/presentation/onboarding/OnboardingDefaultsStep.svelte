<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { Checkbox } from '$hyper-ui/components/checkbox';
	import { Icon } from '$hyper-ui/icons';
	import {
		customizeOnboardingDefaultsCommand,
		chooseOnboardingDefaultsCommand,
	} from '$lib/app/application/commands/choose-onboarding-defaults.command';
	import { onboardingQuery } from '$lib/app/application/queries/onboarding.query.svelte';
	import {
		RECOMMENDED,
		UPDATE_FROM_MAIN_MODES,
		type DefaultsChoice,
	} from '$lib/app/domain/automation-defaults';
	import { loadAutomationsCommand } from '$lib/automations/application/commands/load-automations.command';
	import { watchAutomationsHook } from '$lib/automations/application/hooks/watch-automations.hook';
	import {
		BRAIN_FINE_PRINT,
		DEFAULT_SWITCHES,
		RECOMMENDED_UPDATE_FROM_MAIN,
		UPDATE_FROM_MAIN_DETAILS,
		UPDATE_FROM_MAIN_LABELS,
		switchDetail,
	} from '../automation-defaults-copy';
	import ChoiceSwitch from '../settings/ChoiceSwitch.svelte';

	const choice = $derived(onboardingQuery.data.defaultsChoice);
	const custom = $derived(onboardingQuery.data.customDefaults);
	const brain = $derived(choice === 'recommended' ? RECOMMENDED.brain : custom.brain);

	onMount(() => {
		loadAutomationsCommand();
		return watchAutomationsHook();
	});
</script>

<div class="-mx-4.5 flex flex-col gap-2.5" role="radiogroup" aria-label="Defaults">
	{@render option(
		'recommended',
		'Recommended',
		"What we'd pick. Agents handle the chores, you handle the decisions.",
	)}
	{#if choice === 'recommended'}
		<ul class="mb-1 ml-12.5 flex flex-col gap-0.5" aria-label="Recommended defaults">
			{#each DEFAULT_SWITCHES as item (item.key)}
				{@render recommended(item.title, item.detail)}
			{/each}
			{@render recommended(RECOMMENDED_UPDATE_FROM_MAIN.title, RECOMMENDED_UPDATE_FROM_MAIN.detail)}
		</ul>
	{/if}
	{@render option('custom', 'Customize', 'Pick each one yourself.')}
	{#if choice === 'custom'}
		<div class="mb-1 ml-11 flex flex-col gap-0.5" role="group" aria-label="Customize">
			{#each DEFAULT_SWITCHES as item (item.key)}
				<Checkbox
					checked={custom[item.key]}
					wrap
					class="py-2"
					onchange={(checked) => customizeOnboardingDefaultsCommand({ [item.key]: checked })}
				>
					{#snippet label()}
						<span class="text-[15px] leading-6 font-medium">{item.title}</span>
					{/snippet}
					{#snippet description()}
						<span class="text-sm leading-5">{switchDetail(item)}</span>
					{/snippet}
				</Checkbox>
			{/each}
			<div class="flex flex-col py-2 pl-7.5">
				<div class="flex items-center justify-between gap-3">
					<p class="text-fg-default text-[15px] leading-6 font-medium">Update from main</p>
					<ChoiceSwitch
						label="Update from main"
						choices={UPDATE_FROM_MAIN_MODES}
						labels={UPDATE_FROM_MAIN_LABELS}
						selected={custom.updateFromMain}
						onchoose={(updateFromMain) => customizeOnboardingDefaultsCommand({ updateFromMain })}
					/>
				</div>
				<p class="text-fg-tertiary text-sm leading-5">
					{UPDATE_FROM_MAIN_DETAILS[custom.updateFromMain]}
				</p>
			</div>
		</div>
	{/if}
</div>

{#if brain}
	<p class="text-fg-tertiary mt-4 text-xs leading-4 text-pretty">{BRAIN_FINE_PRINT}</p>
{/if}

{#snippet option(value: DefaultsChoice, title: string, detail: string)}
	{@const selected = choice === value}
	<Button
		bare
		role="radio"
		ariaChecked={selected}
		class={[
			'flex w-full items-start gap-3.5 rounded-2xl border-[0.5px] px-4.5 py-4 text-left',
			selected
				? 'bg-surface-150 border-surface-150-border'
				: 'bg-surface-100 border-surface-100-border hover:bg-surface-100-hover',
		]}
		onclick={() => chooseOnboardingDefaultsCommand(value)}
	>
		<span
			class={[
				'mt-[3px] grid size-[18px] shrink-0 place-items-center rounded-full border-[1.5px]',
				selected ? 'border-button-primary' : 'border-surface-150-border',
			]}
			aria-hidden="true"
		>
			{#if selected}<span class="bg-button-primary size-2 rounded-full"></span>{/if}
		</span>
		<span class="flex min-w-0 flex-col">
			<span class="text-fg-default text-[15px] font-medium">{title}</span>
			<span class="text-fg-tertiary mt-0.5 text-sm leading-5">{detail}</span>
		</span>
	</Button>
{/snippet}

{#snippet recommended(title: string, detail: string)}
	<li class="flex items-start gap-3 py-2">
		<Icon name="check" size={18} class="text-fg-tertiary mt-[3px] shrink-0" />
		<span class="flex min-w-0 flex-col">
			<span class="text-fg-default text-[15px] leading-6 font-medium">{title}</span>
			<span class="text-fg-tertiary text-sm leading-5">{detail}</span>
		</span>
	</li>
{/snippet}
