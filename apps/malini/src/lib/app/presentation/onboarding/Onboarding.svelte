<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { quartOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fade, type TransitionConfig } from 'svelte/transition';
	import { Button } from '$hyper-ui/components/button';
	import {
		ONBOARDING_STEPS,
		onboardingAccountsSettled,
		type OnboardingAccountStatuses,
		type OnboardingStep,
	} from '$lib/app/domain/onboarding';
	import { answerHeardAboutCommand } from '$lib/app/application/commands/answer-heard-about.command';
	import { finishOnboardingCommand } from '$lib/app/application/commands/finish-onboarding.command';
	import { goToOnboardingStepCommand } from '$lib/app/application/commands/go-to-onboarding-step.command';
	import { showOnboardingHook } from '$lib/app/application/hooks/show-onboarding.hook';
	import { onboardingQuery } from '$lib/app/application/queries/onboarding.query.svelte';
	import { JobsIntro } from '$lib/jobs/jobs.api';
	import { AfternoonTrial, SoundChoices } from '$shared/sounds/sounds.api';
	import { claudeCodeStatusQuery } from '$shared/providers/providers.api';
	import {
		githubAuthErrorQuery,
		githubAuthQuery,
		githubSetupStatus,
	} from '$shared/repositories/repositories.api';
	import OnboardingAccountsStep from './OnboardingAccountsStep.svelte';
	import OnboardingHeardAboutStep from './OnboardingHeardAboutStep.svelte';
	import OnboardingRepositoryStep from './OnboardingRepositoryStep.svelte';
	import { rehearseStepTransition, type Rehearsal } from './rehearse-step-transition';

	const STEP_COPY: Readonly<
		Record<OnboardingStep, Readonly<{ title: string; description: string | null }>>
	> = {
		accounts: {
			title: 'Connect Claude Code and GitHub',
			description:
				'Malini runs Claude Code with your Claude plan, and works in your GitHub repositories.',
		},
		jobs: {
			title: 'Meet your jobs',
			description:
				'Jobs are agent work Malini does for you, each in its own chat. These come built in, and you can run any of them from a chat by typing /.',
		},
		sounds: {
			title: 'Hear your afternoon',
			description:
				'Choose what you hear when an agent finishes, and when it needs you. Then try an afternoon of workstreams to hear how it feels.',
		},
		'heard-about': {
			title: 'Where did you hear about Malini?',
			description: null,
		},
		repository: {
			title: 'Open your first repository',
			description:
				'Every workstream gets its own git worktree and its own Claude Code, so you can run many at once.',
		},
	};

	const onboarding = $derived(onboardingQuery.data);
	const last = $derived(onboarding.index === ONBOARDING_STEPS.length - 1);
	const copy = $derived(STEP_COPY[onboarding.step]);
	const accounts: OnboardingAccountStatuses = $derived({
		'claude-code': claudeCodeStatusQuery.data.kind,
		github: githubSetupStatus(githubAuthQuery.data, githubAuthErrorQuery.data),
	});
	const asksHeardAbout = $derived(onboarding.step === 'heard-about');
	const continueWaits = $derived(
		(onboarding.step === 'accounts' && !onboardingAccountsSettled(accounts)) ||
			(asksHeardAbout && onboarding.heardAbout === null),
	);

	const STEP_MS = 300;
	const STEP_IN_DELAY_MS = 60;
	const STEP_OUT_MS = 150;
	const STEP_EASING = 'cubic-bezier(0.25, 1, 0.5, 1)';
	const STEP_SHIFT_PX = 32;
	const STEP_BLUR_PX = 2;

	let moved = false;
	let stage: HTMLElement | undefined;
	let resize: Animation | undefined;
	let resizing = $state(false);
	let rehearsedFor: string | undefined;
	let stepBlur = 0;
	let windowShown = $state(document.hasFocus());

	const rehearsal: Rehearsal = rehearseStepTransition(() => stage?.firstElementChild ?? null, {
		inbound: slideIn(1, STEP_BLUR_PX),
		outbound: slideOut(1, STEP_BLUR_PX),
	});

	onMount(showOnboardingHook);

	onMount(() => rehearsal.interrupt);

	$effect(() => {
		const key = `${onboarding.step}:${continueWaits ? 'shown' : 'settled'}`;
		if (!windowShown || key === rehearsedFor || prefersReducedMotion.current) return;
		rehearsedFor = key;
		rehearsal.again();
	});

	async function go(step: number): Promise<void> {
		stepBlur = rehearsal.ready() ? STEP_BLUR_PX : 0;
		rehearsal.interrupt();
		moved = true;
		const from = stage?.getBoundingClientRect().height ?? 0;
		resize?.cancel();
		goToOnboardingStepCommand(step);
		await tick();
		const to = stage?.getBoundingClientRect().height ?? from;
		resizing = !prefersReducedMotion.current && from !== to;
		if (!stage || !resizing) return;
		resize = stage.animate(
			{ height: [`${from}px`, `${to}px`] },
			{ duration: STEP_MS, easing: STEP_EASING },
		);
		resize.onfinish = () => (resizing = false);
	}

	function forward(): void {
		if (asksHeardAbout) answerHeardAboutCommand(onboarding.heardAbout);
		void go(onboarding.index + 1);
	}

	function skipHeardAbout(): void {
		answerHeardAboutCommand(null);
		void go(onboarding.index + 1);
	}

	function fadeOnly(duration: number): TransitionConfig {
		return { duration, css: (t) => `opacity: ${t};` };
	}

	function slide(duration: number, shift: number, blur: number): TransitionConfig {
		return {
			duration,
			easing: quartOut,
			css: (t, u) =>
				`opacity: ${t}; translate: ${u * shift}px;${blur > 0 ? ` filter: blur(${u * blur}px);` : ''}`,
		};
	}

	function slideIn(direction: 1 | -1, blur: number): TransitionConfig {
		return { ...slide(STEP_MS, STEP_SHIFT_PX * direction, blur), delay: STEP_IN_DELAY_MS };
	}

	function slideOut(direction: 1 | -1, blur: number): TransitionConfig {
		return slide(STEP_OUT_MS, -STEP_SHIFT_PX * direction, blur);
	}

	function stepIn(_node: Element): TransitionConfig {
		if (prefersReducedMotion.current) return fadeOnly(160);
		return slideIn(onboarding.direction, stepBlur);
	}

	function stepOut(node: HTMLElement): TransitionConfig {
		Object.assign(node.style, { position: 'absolute', inset: '0 0 auto' });
		if (prefersReducedMotion.current) return fadeOnly(120);
		return slideOut(onboarding.direction, stepBlur);
	}

	function focusHeading(node: HTMLElement): void {
		if (moved) node.focus({ preventScroll: true });
	}
</script>

<svelte:window onfocus={() => (windowShown = true)} />

<div class="flex w-full justify-center px-6 pt-[18vh] pb-6" data-testid="onboarding">
	<article
		class="bg-surface-50 border-surface-50-border flex w-[600px] max-w-full flex-col rounded-[28px] border-[0.5px] px-9 pt-8 pb-7 shadow-sm"
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
								'block h-1.5 rounded-full transition-[width] duration-300 ease-[cubic-bezier(0.25,1,0.5,1)] motion-reduce:transition-none',
								index === onboarding.index
									? 'bg-button-primary w-6'
									: 'bg-surface-50-selected w-1.5',
							]}
						></span>
					</li>
				{/each}
			</ol>
		</header>

		<div bind:this={stage} class={['relative', resizing && 'overflow-y-clip']}>
			{#key onboarding.step}
				<div class="flex flex-col" in:stepIn out:stepOut>
					<h1
						id="onboarding-heading"
						class="text-fg-default mt-7 text-2xl font-medium tracking-tight outline-none"
						tabindex="-1"
						{@attach focusHeading}
					>
						{copy.title}
					</h1>
					{#if copy.description}
						<p class="text-fg-tertiary mt-2 max-w-[60ch] text-[15px] leading-6 text-pretty">
							{copy.description}
						</p>
					{/if}

					<div class="mt-7 flex min-h-0 flex-1 flex-col">
						{#if onboarding.step === 'accounts'}
							<OnboardingAccountsStep statuses={accounts} />
						{:else if onboarding.step === 'jobs'}
							<JobsIntro />
						{:else if onboarding.step === 'heard-about'}
							<OnboardingHeardAboutStep />
						{:else if onboarding.step === 'sounds'}
							<div class="flex flex-col gap-3">
								<SoundChoices class="rounded-2xl" />
								<AfternoonTrial />
							</div>
						{:else}
							<OnboardingRepositoryStep />
						{/if}
					</div>
				</div>
			{/key}
		</div>

		<footer class="mt-9 flex shrink-0 items-center justify-between gap-3">
			{#if onboarding.index > 0}
				<div transition:fade={{ duration: 150 }}>
					<Button
						variant="ghost"
						size="lg"
						class="text-fg-tertiary -ml-3"
						onclick={() => go(onboarding.index - 1)}
					>
						Back
					</Button>
				</div>
			{/if}
			<div class="ml-auto grid justify-items-end">
				{#if last}
					<div class="col-start-1 row-start-1" transition:fade={{ duration: 150 }}>
						<Button
							variant="ghost"
							size="lg"
							class="text-fg-secondary -mr-3"
							onclick={finishOnboardingCommand}
						>
							Skip for now
						</Button>
					</div>
				{:else}
					<div
						class="col-start-1 row-start-1 flex items-center gap-1"
						transition:fade={{ duration: 150 }}
					>
						{#if asksHeardAbout}
							<div transition:fade={{ duration: 150 }}>
								<Button
									variant="ghost"
									size="lg"
									class="text-fg-secondary"
									onclick={skipHeardAbout}
								>
									Skip
								</Button>
							</div>
						{/if}
						<Button
							variant="primary"
							size="lg"
							radius="full"
							class="px-6"
							disabled={continueWaits}
							data-testid="onboarding-continue"
							onclick={forward}
						>
							Continue
						</Button>
					</div>
				{/if}
			</div>
		</footer>
	</article>
</div>
