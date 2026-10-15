<script lang="ts">
	import { onMount } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { fly } from 'svelte/transition';
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
	import { ONBOARDING_STEPS, type OnboardingStep } from '$lib/app/domain/onboarding';
	import { finishOnboardingCommand } from '$lib/app/application/commands/finish-onboarding.command';
	import { goToOnboardingStepCommand } from '$lib/app/application/commands/go-to-onboarding-step.command';
	import { showOnboardingHook } from '$lib/app/application/hooks/show-onboarding.hook';
	import { onboardingQuery } from '$lib/app/application/queries/onboarding.query.svelte';
	import { ensureSkillSuggestionsCommand } from '$lib/skills/application/commands/ensure-skill-suggestions.command';
	import { skillCatalogTotalsQuery } from '$lib/skills/application/queries/skill-catalog-totals.query.svelte';
	import { JobsIntro } from '$lib/jobs/jobs.api';
	import { SkillPresetBoard } from '$lib/skills/skills.api';
	import { ClaudeCodeSetup } from '$shared/providers/providers.api';
	import OnboardingRepositoryStep from './OnboardingRepositoryStep.svelte';

	const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
	const STEP_COPY: Readonly<
		Record<OnboardingStep, Readonly<{ title: string; description: string }>>
	> = {
		'claude-code': {
			title: 'Connect Claude Code',
			description:
				'malini runs the Claude Code on this Mac, signed in with your own Claude plan. Every chat gets an agent of its own.',
		},
		skills: {
			title: 'Group your skills into presets',
			description:
				'Drag your skills into presets, so each chat gets only the skills its work needs.',
		},
		jobs: {
			title: 'Meet your jobs',
			description:
				'Jobs are agent work malini does for you, each in its own chat. These come built in, and you can run any of them from a chat by typing /.',
		},
		repository: {
			title: 'Open your first repository',
			description:
				'Every workstream gets its own git worktree and its own Claude Code, so you can run many at once.',
		},
	};

	const onboarding = $derived(onboardingQuery.data);
	const totals = $derived(skillCatalogTotalsQuery.data(null));
	const last = $derived(onboarding.index === ONBOARDING_STEPS.length - 1);
	const wide = $derived(onboarding.step === 'skills');
	const copy = $derived(STEP_COPY[onboarding.step]);
	const description = $derived(
		onboarding.step === 'skills' && totals
			? `Right now every chat loads all ${totals.skills} skills, ${COMPACT.format(totals.tokens).toLowerCase()} tokens before you type a word. Drag them into presets, so each chat gets only the skills its work needs.`
			: copy.description,
	);
	let moved = false;

	onMount(() => {
		ensureSkillSuggestionsCommand();
		return showOnboardingHook();
	});

	function go(step: number): void {
		moved = true;
		goToOnboardingStepCommand(step);
	}

	function focusHeading(node: HTMLElement): void {
		if (moved) node.focus({ preventScroll: true });
	}
</script>

<div class="flex min-h-full w-full items-center justify-center px-6 py-6" data-testid="onboarding">
	<article
		class={[
			'bg-surface-50 border-surface-50-border flex max-w-full flex-col rounded-[28px] border-[0.5px] px-9 pt-8 pb-7 shadow-xl',
			'transition-[width] duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
			wide ? 'h-[min(860px,calc(100vh_-_3rem))] w-[920px]' : 'w-[560px]',
		]}
		aria-labelledby="onboarding-heading"
		data-onboarding-step={onboarding.step}
	>
		<header class="flex items-center justify-between">
			<p class="text-fg-tertiary text-sm tabular-nums">
				Step {onboarding.index + 1} of {ONBOARDING_STEPS.length}
			</p>
			<ol class="flex items-center gap-2" aria-label="Setup progress">
				{#each ONBOARDING_STEPS as step, index (step)}
					<li aria-current={index === onboarding.index ? 'step' : undefined}>
						<span
							class={[
								'block h-1.5 rounded-full transition-[width] duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
								index === onboarding.index
									? 'bg-button-primary w-6'
									: 'bg-surface-50-selected w-1.5',
							]}
						></span>
					</li>
				{/each}
			</ol>
		</header>

		{#key onboarding.step}
			<div
				class="flex min-h-0 flex-1 flex-col"
				in:fly={{ x: 14 * onboarding.direction, duration: 260, easing: cubicOut }}
			>
				<h1
					id="onboarding-heading"
					class="text-fg-default mt-7 text-2xl font-medium tracking-tight outline-none"
					tabindex="-1"
					{@attach focusHeading}
				>
					{copy.title}
				</h1>
				<p class="text-fg-tertiary mt-2 max-w-[60ch] text-[15px] leading-6">{description}</p>

				<div class="mt-7 flex min-h-0 flex-1 flex-col">
					{#if onboarding.step === 'claude-code'}
						<ClaudeCodeSetup setup />
					{:else if onboarding.step === 'skills'}
						<SkillPresetBoard suggest class="min-h-[280px] flex-1" />
						<p class="text-fg-tertiary mt-3 flex items-center gap-1.5 text-xs">
							<Icon name="info" size={13} class="shrink-0" />
							Your first preset becomes the default for new chats. Switch a chat's preset from its composer.
						</p>
					{:else if onboarding.step === 'jobs'}
						<JobsIntro />
					{:else}
						<OnboardingRepositoryStep />
					{/if}
				</div>
			</div>
		{/key}

		<footer class={['flex shrink-0 items-center justify-between gap-3', wide ? 'mt-6' : 'mt-9']}>
			{#if onboarding.index === 0}
				<Button
					variant="ghost"
					size="lg"
					class="text-fg-tertiary -ml-3"
					onclick={finishOnboardingCommand}
				>
					Skip setup
				</Button>
			{:else}
				<Button
					variant="ghost"
					size="lg"
					class="text-fg-tertiary -ml-3"
					onclick={() => go(onboarding.index - 1)}
				>
					Back
				</Button>
			{/if}
			{#if last}
				<Button
					variant="ghost"
					size="lg"
					class="text-fg-secondary"
					onclick={finishOnboardingCommand}
				>
					Skip for now
				</Button>
			{:else}
				<Button
					variant="primary"
					size="lg"
					radius="full"
					class="px-6"
					data-testid="onboarding-continue"
					onclick={() => go(onboarding.index + 1)}
				>
					Continue
				</Button>
			{/if}
		</footer>
	</article>
</div>
