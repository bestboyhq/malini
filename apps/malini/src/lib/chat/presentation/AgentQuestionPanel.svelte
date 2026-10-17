<script lang="ts">
	import { tick } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';
	import { Button } from '$hyper-ui/components/button';
	import { ComposerShell } from '$hyper-ui/components/composer-shell';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { answerQuestionCommand } from '$lib/chat/application/commands/answer-question.command';
	import { cancelRunCommand } from '$lib/chat/application/commands/cancel-run.command';
	import type { AgentQuestion, AgentQuestionRequest } from '$lib/chat/domain/agent-interaction';
	import { sanitizeFailureDetail } from '$shared/errors/failure-copy';

	interface Props {
		requests: readonly AgentQuestionRequest[];
	}

	type QuestionStep = Readonly<{ key: string; question: AgentQuestion }>;

	let { requests }: Props = $props();

	const RECOMMENDED = /\s*\(recommended\)\s*$/iu;
	const ADVANCE_MS = 160;

	let step = $state(0);
	let direction = $state(1);
	let selected = $state<Record<string, string[]>>({});
	let freeText = $state<Record<string, string>>({});
	let panel: HTMLElement | null = $state(null);
	let choices: HTMLElement | null = $state(null);
	let otherInput: HTMLInputElement | null = $state(null);
	let primary: HTMLAnchorElement | HTMLButtonElement | null = $state(null);
	let advanceTimer: ReturnType<typeof setTimeout> | undefined;

	let sentSteps = $state<QuestionStep[] | null>(null);
	const liveSteps = $derived<QuestionStep[]>(
		requests.flatMap((request) =>
			request.questions.map((question) => ({
				key: `${request.questionId}:${question.id}`,
				question,
			})),
		),
	);
	const failure = $derived(requests.find((request) => request.error !== null)?.error ?? null);
	const steps = $derived(sentSteps && !failure ? sentSteps : liveSteps);
	const currentStep = $derived(steps[Math.min(step, steps.length - 1)]);
	const current = $derived(currentStep?.question);
	const lastStep = $derived(step >= steps.length - 1);
	const submitting = $derived(requests.some((request) => request.submitting));
	const shortcutCount = $derived(
		current ? current.options.length + (current.allowFreeText ? 1 : 0) : 0,
	);
	const canProceed = $derived(
		!submitting &&
			(lastStep ? steps.every(isAnswered) : currentStep ? isAnswered(currentStep) : false),
	);
	const promptId = $derived(`agent-question-${currentStep?.key ?? 'none'}-prompt`);
	const motion = $derived(prefersReducedMotion.current ? 0 : 1);

	function valuesFor({ key, question }: QuestionStep): string[] {
		const chosen = selected[key] ?? [];
		const typed = freeText[key]?.trim() ?? '';
		if (question.multiSelect) return typed ? [...chosen, typed] : chosen;
		return typed ? [typed] : chosen;
	}

	function isAnswered(questionStep: QuestionStep): boolean {
		return valuesFor(questionStep).length > 0;
	}

	function isChosen({ key }: QuestionStep, label: string): boolean {
		return (selected[key] ?? []).includes(label);
	}

	function optionText(label: string): { text: string; recommended: boolean } {
		const text = label.replace(RECOMMENDED, '');
		return { text: text || label, recommended: text !== label && text.length > 0 };
	}

	function choose({ key, question }: QuestionStep, label: string): void {
		if (submitting) return;
		if (question.multiSelect) {
			const chosen = selected[key] ?? [];
			selected[key] = chosen.includes(label)
				? chosen.filter((value) => value !== label)
				: [...chosen, label];
			return;
		}
		selected[key] = [label];
		freeText[key] = '';
		clearTimeout(advanceTimer);
		if (lastStep) {
			void focusPrimary();
			return;
		}
		advanceTimer = setTimeout(() => goTo(step + 1), ADVANCE_MS * motion);
	}

	function typeOther({ key, question }: QuestionStep, value: string): void {
		freeText[key] = value;
		if (!question.multiSelect && value.trim()) selected[key] = [];
	}

	async function goTo(index: number): Promise<void> {
		clearTimeout(advanceTimer);
		if (index < 0 || index >= steps.length || index === step) return;
		direction = index > step ? 1 : -1;
		step = index;
		await tick();
		focusOption(0, true);
	}

	async function focusPrimary(): Promise<void> {
		await tick();
		primary?.focus();
	}

	function optionButtons(): HTMLElement[] {
		return choices ? [...choices.querySelectorAll<HTMLElement>('[data-question-option]')] : [];
	}

	function focusOption(index: number, preferChosen = false): void {
		const options = optionButtons();
		const chosen = preferChosen
			? options.findIndex((option) => option.getAttribute('aria-checked') === 'true')
			: -1;
		options[chosen >= 0 ? chosen : index]?.focus();
	}

	function moveFocus(offset: number): void {
		const options = optionButtons();
		if (otherInput) options.push(otherInput);
		const active = document.activeElement;
		const index = options.findIndex((option) => option === active);
		const next = options[(index + offset + options.length) % options.length];
		next?.focus();
	}

	function proceed(): void {
		if (!canProceed) return;
		if (!lastStep) {
			void goTo(step + 1);
			return;
		}
		sentSteps = liveSteps;
		for (const request of requests) {
			answerQuestionCommand({
				sessionId: request.sessionId,
				runId: request.runId,
				questionId: request.questionId,
				answers: request.questions.map((question) => ({
					questionId: question.id,
					values: valuesFor({ key: `${request.questionId}:${question.id}`, question }),
				})),
			});
		}
	}

	function pick(index: number): void {
		if (!currentStep) return;
		const option = currentStep.question.options[index];
		if (option) {
			choose(currentStep, option.label);
			focusOption(index);
			return;
		}
		otherInput?.focus();
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.defaultPrevented || event.altKey || event.ctrlKey) return;
		const typing = event.target instanceof HTMLInputElement;
		if (event.key === 'Enter' && (event.metaKey || typing)) {
			event.preventDefault();
			proceed();
			return;
		}
		if (typing || event.metaKey || event.shiftKey) return;
		const digit = /^[1-9]$/u.test(event.key) ? Number(event.key) : 0;
		if (digit > 0 && digit <= shortcutCount) {
			event.preventDefault();
			pick(digit - 1);
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			moveFocus(event.key === 'ArrowDown' ? 1 : -1);
		}
	}

	function onWindowKeydown(event: KeyboardEvent): void {
		const active = document.activeElement;
		if (active && active !== document.body && !panel?.contains(active)) return;
		if (document.querySelector('[data-dropdown-portal]:not([inert]), [aria-modal="true"]')) return;
		onKeydown(event);
	}

	function takeFocusOnArrival(): () => void {
		const active = document.activeElement;
		const unclaimed =
			!(active instanceof HTMLElement) || active === document.body || !active.checkVisibility();
		if (unclaimed) focusOption(0);
		return () => clearTimeout(advanceTimer);
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div
	bind:this={panel}
	class="chat-column relative z-20 px-4 pb-1"
	in:fly={{ y: 10 * motion, duration: 240 * motion, easing: cubicOut }}
	data-testid="agent-question-panel"
>
	<ComposerShell testId="agent-question-shell" footerTestId="agent-question-footer">
		<section class="px-2 pt-2.5" aria-labelledby={promptId} aria-busy={submitting}>
			<header class="flex min-h-7 items-center gap-2 px-2">
				<Icon name="question" size={14} class="text-fg-tertiary shrink-0" />
				{#if steps.length > 1}
					<nav aria-label="Questions" class="flex min-w-0 flex-wrap items-center gap-0.5">
						{#each steps as questionStep, index (questionStep.key)}
							<Button
								variant="ghost"
								size="sm"
								radius="full"
								active={index === step}
								ariaCurrent={index === step ? 'step' : 'false'}
								class="max-w-48 gap-1 text-xs"
								onclick={() => goTo(index)}
							>
								{#if index !== step && isAnswered(questionStep)}
									<Icon name="check" size={12} class="text-success-content shrink-0" />
								{/if}
								<span class="truncate">
									{questionStep.question.header ?? `Question ${index + 1}`}
								</span>
							</Button>
						{/each}
					</nav>
				{:else}
					<span class="text-fg-tertiary truncate text-xs">{current?.header ?? 'Question'}</span>
				{/if}
			</header>

			{#if currentStep && current}
				{#key currentStep.key}
					<div
						in:fly={{
							x: 14 * direction * motion,
							duration: 220 * motion,
							easing: cubicOut,
							opacity: 0,
						}}
						style:--scrollable-fade-color="var(--color-surface-composer)"
					>
						<ScrollableDiv class="max-h-[min(24rem,40vh)]" fadeEdges>
							<h3
								id={promptId}
								class="text-fg-default px-2 pt-1.5 text-sm leading-5 font-medium select-text"
							>
								<SensitiveText text={current.prompt} />
							</h3>
							<div
								bind:this={choices}
								{@attach takeFocusOnArrival}
								class="mt-2.5 flex flex-col gap-0.5 pb-1"
								role={current.multiSelect ? 'group' : 'radiogroup'}
								aria-labelledby={promptId}
							>
								{#each current.options as option, index (option.label)}
									{@const chosen = isChosen(currentStep, option.label)}
									{@const label = optionText(option.label)}
									<Button
										bare
										role={current.multiSelect ? 'checkbox' : 'radio'}
										ariaChecked={chosen}
										ariaKeyshortcuts={String(index + 1)}
										disabled={submitting}
										class={[
											'group/option flex w-full cursor-pointer items-start gap-3 rounded-lg px-2 py-2 text-left outline-0',
											chosen
												? 'bg-surface-100-selected'
												: 'hover:bg-surface-100-hover focus-visible:bg-surface-100-hover',
										]}
										data-question-option=""
										onclick={() => choose(currentStep, option.label)}
									>
										<span
											class={[
												'text-2xs grid size-5 shrink-0 place-items-center border font-medium tabular-nums transition-[border-color,color] duration-150',
												current.multiSelect ? 'rounded-md' : 'rounded-full',
												chosen
													? 'bg-button-primary border-button-primary text-button-primary-content'
													: 'border-surface-150-border text-fg-tertiary group-hover/option:text-fg-secondary',
											]}
											aria-hidden="true"
										>
											{#if chosen}
												<Icon name="check" size={12} />
											{:else}
												{index + 1}
											{/if}
										</span>
										<span class="min-w-0 flex-1 pt-px">
											<span class="text-fg-default flex items-center gap-2 text-sm leading-5">
												<span class="min-w-0">{label.text}</span>
												{#if label.recommended}
													<span
														class="text-2xs text-fg-tertiary border-surface-150-border shrink-0 rounded-full border px-1.5 leading-4"
													>
														Recommended
													</span>
												{/if}
											</span>
											{#if option.description}
												<span class="text-fg-tertiary mt-0.5 block text-xs leading-4">
													{option.description}
												</span>
											{/if}
										</span>
									</Button>
								{/each}
								{#if current.allowFreeText}
									{@const typed = (freeText[currentStep.key] ?? '').trim().length > 0}
									<div
										class={[
											'flex w-full items-center gap-3 rounded-lg px-2 py-1.5',
											typed ? 'bg-surface-100-selected' : 'focus-within:bg-surface-100-hover',
										]}
									>
										<span
											class={[
												'text-2xs grid size-5 shrink-0 place-items-center rounded-full border font-medium tabular-nums transition-[border-color,color] duration-150',
												typed
													? 'bg-button-primary border-button-primary text-button-primary-content'
													: 'border-surface-150-border text-fg-tertiary',
											]}
											aria-hidden="true"
										>
											{#if typed}
												<Icon name="pencil" size={11} />
											{:else}
												{current.options.length + 1}
											{/if}
										</span>
										<TextInput
											bare
											bind:element={otherInput}
											ariaLabel="Other answer"
											placeholder="Something else…"
											value={freeText[currentStep.key] ?? ''}
											disabled={submitting}
											size="auto"
											class="min-w-0 flex-1"
											inputClass="h-6 text-sm"
											oninput={(event) => {
												const input = event.currentTarget;
												if (input instanceof HTMLInputElement) typeOther(currentStep, input.value);
											}}
										/>
									</div>
								{/if}
							</div>
						</ScrollableDiv>
					</div>
				{/key}
			{/if}

			{#if failure}
				<p
					class="text-2xs text-error-content flex items-start gap-1.5 px-2 pb-1 leading-4"
					role="alert"
				>
					<Icon name="alert" class="mt-px shrink-0" size={13} />
					<span class="min-w-0">
						<SensitiveText text={sanitizeFailureDetail(failure)} /> Claude is still waiting, so you can
						answer again.
					</span>
				</p>
			{/if}
		</section>

		{#snippet footer()}
			<Tooltip content="Stop the run without answering" placement="top">
				<Button
					variant="ghost"
					size="md"
					class="text-xs"
					disabled={submitting}
					onclick={cancelRunCommand}
				>
					Dismiss
				</Button>
			</Tooltip>
			<div class="flex items-center gap-1.5">
				{#if step > 0}
					<Button variant="ghost" size="md" class="text-xs" onclick={() => goTo(step - 1)}>
						Back
					</Button>
				{/if}
				<Button
					bind:element={primary}
					variant="primary"
					size="md"
					class="text-xs"
					disabled={!canProceed}
					loading={submitting}
					ariaKeyshortcuts="Meta+Enter"
					onclick={proceed}
				>
					{lastStep ? (steps.length > 1 ? 'Send answers' : 'Send answer') : 'Next'}
				</Button>
			</div>
		{/snippet}
	</ComposerShell>

	<p class="text-2xs text-fg-tertiary flex h-6 items-center justify-end gap-3 px-3 select-none">
		{#if shortcutCount > 1}
			<span class="flex items-center gap-1">
				<kbd class="font-sans">1–{Math.min(shortcutCount, 9)}</kbd>
				to choose
			</span>
		{/if}
		<span class="flex items-center gap-1">
			<kbd class="font-sans">⌘↵</kbd>
			{lastStep ? 'to send' : 'for next'}
		</span>
	</p>
</div>
