<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import { fade, type TransitionConfig } from 'svelte/transition';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { answerQuestionCommand } from '$lib/chat/application/commands/answer-question.command';
	import { decideApprovalCommand } from '$lib/chat/application/commands/decide-approval.command';
	import { agentInteractionStateQuery } from '$lib/chat/application/queries/agent-interaction-state.query.svelte';
	import { canPersistAgentApproval } from '$lib/chat/domain/agent-interaction-state';
	import {
		approvalHeadline,
		approvalReason,
		approvalShortTarget,
		approvalTargets,
	} from '$lib/chat/domain/approval-request';
	import type {
		AgentApprovalScope,
		AgentQuestion,
		AgentQuestionAnswer,
	} from '$lib/chat/domain/agent-interaction';
	import { Button } from '$hyper-ui/components/button';
	import { Dropdown, DropdownItem } from '$hyper-ui/components/dropdown';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Icon } from '$hyper-ui/icons';
	import type { RenderItem } from './render-state';
	import { sanitizeFailureDetail } from '$shared/errors/failure-copy';

	type InteractionItem = Extract<RenderItem, { kind: 'approval' | 'question' }>;

	interface Props {
		item: InteractionItem;
	}

	let { item }: Props = $props();

	const reducedMotion = (): boolean =>
		window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	function collapseAway(node: HTMLElement): TransitionConfig {
		if (reducedMotion()) return { duration: 0 };
		Object.assign(node.style, { position: 'absolute', top: '0', insetInline: '0' });
		return {
			duration: 220,
			easing: cubicOut,
			css: (t, u) => `opacity: ${t}; clip-path: inset(0 0 ${u * 100}% 0 round 0.75rem);`,
		};
	}
	let selectedByQuestion = $state<Record<string, string[]>>({});
	let freeTextByQuestion = $state<Record<string, string>>({});
	let alwaysAllowOpen = $state(false);

	const reference = $derived({
		kind: item.kind,
		sessionId: item.sessionId,
		runId: item.runId,
		requestId: item.kind === 'approval' ? item.approvalId : item.questionId,
	});
	const interactionState = $derived(agentInteractionStateQuery.data(reference));
	const settled = $derived(
		interactionState.status === 'resolved' || interactionState.status === 'stale',
	);
	const submitting = $derived(interactionState.status === 'submitting');
	const headingId = $derived(`agent-interaction-${item.kind}-${item.seq}`);
	const canOfferPersistentScope = $derived(
		item.kind === 'approval' && canPersistAgentApproval(item.permission),
	);
	const headline = $derived(
		item.kind === 'approval'
			? approvalHeadline(item.toolName, item.permission)
			: 'Claude has a question',
	);
	const targets = $derived(item.kind === 'approval' ? approvalTargets(item.permission) : []);
	const reason = $derived(item.kind === 'approval' ? approvalReason(item.reason) : null);
	const settledSubject = $derived(
		item.kind === 'approval'
			? approvalShortTarget(item.toolName, item.permission)
			: (item.questions[0]?.prompt ?? ''),
	);
	const settledTone = $derived(
		interactionState.status === 'stale'
			? 'stale'
			: interactionState.status === 'resolved' && interactionState.decision === 'deny'
				? 'denied'
				: 'allowed',
	);

	function decideApproval(
		approval: Extract<InteractionItem, { kind: 'approval' }>,
		decision: 'allow' | 'deny',
		scope: AgentApprovalScope,
	): void {
		alwaysAllowOpen = false;
		decideApprovalCommand({
			sessionId: approval.sessionId,
			runId: approval.runId,
			approvalId: approval.approvalId,
			decision,
			scope,
		});
	}

	function setOption(question: AgentQuestion, value: string, checked: boolean): void {
		if (question.multiSelect) {
			const current = selectedByQuestion[question.id] ?? [];
			selectedByQuestion = {
				...selectedByQuestion,
				[question.id]: checked
					? [...new Set([...current, value])]
					: current.filter((candidate) => candidate !== value),
			};
			return;
		}
		selectedByQuestion = { ...selectedByQuestion, [question.id]: checked ? [value] : [] };
		if (checked) freeTextByQuestion = { ...freeTextByQuestion, [question.id]: '' };
	}

	function setFreeText(question: AgentQuestion, value: string): void {
		freeTextByQuestion = { ...freeTextByQuestion, [question.id]: value };
		if (!question.multiSelect && value.trim()) {
			selectedByQuestion = { ...selectedByQuestion, [question.id]: [] };
		}
	}

	function answersFor(
		questionItem: Extract<InteractionItem, { kind: 'question' }>,
	): AgentQuestionAnswer[] {
		return questionItem.questions.map((question) => {
			const selected = selectedByQuestion[question.id] ?? [];
			const freeText = freeTextByQuestion[question.id]?.trim() ?? '';
			return {
				questionId: question.id,
				values: question.multiSelect
					? [...selected, ...(freeText ? [freeText] : [])]
					: freeText
						? [freeText]
						: selected,
			};
		});
	}

	function submitAnswers(
		event: SubmitEvent,
		questionItem: Extract<InteractionItem, { kind: 'question' }>,
	): void {
		event.preventDefault();
		answerQuestionCommand({
			sessionId: questionItem.sessionId,
			runId: questionItem.runId,
			questionId: questionItem.questionId,
			answers: answersFor(questionItem),
		});
	}
</script>

{#if settled}
	<div
		in:fade={{ duration: reducedMotion() ? 0 : 180, delay: 60 }}
		class="text-fg-tertiary flex min-h-6 w-full items-center gap-2 text-sm"
		data-message-kind={item.kind}
		data-testid={`agent-${item.kind}-card`}
		data-interaction-state={interactionState.status}
		role="status"
	>
		<span class="grid h-3.5 w-3.5 shrink-0 place-items-center" aria-hidden="true">
			{#if settledTone === 'denied'}
				<Icon name="circle-slash" size={13} />
			{:else if settledTone === 'stale'}
				<Icon name="clock" size={13} />
			{:else}
				<Icon name="check" size={13} />
			{/if}
		</span>
		<span class="text-fg-secondary shrink-0">
			{interactionState.status === 'resolved' || interactionState.status === 'stale'
				? interactionState.message
				: ''}
		</span>
		{#if settledSubject}
			<span class="text-2xs min-w-0 flex-1 truncate font-mono">
				<SensitiveText text={settledSubject} />
			</span>
		{/if}
	</div>
{:else}
	<section
		out:collapseAway
		class="bg-surface-50 border-surface-50-border w-full rounded-xl border px-3.5 py-3"
		data-message-kind={item.kind}
		data-testid={`agent-${item.kind}-card`}
		data-interaction-state={interactionState.status}
		aria-labelledby={headingId}
		aria-busy={submitting}
	>
		<div class="flex items-start gap-2.5">
			<span class="grid h-5 w-4 shrink-0 place-items-center" aria-hidden="true">
				{#if item.kind === 'approval'}
					<Icon name="shield-alert" class="text-warning-content" size={15} />
				{:else}
					<Icon name="question" class="text-fg-secondary" size={15} />
				{/if}
			</span>
			<div class="min-w-0 flex-1">
				<h3 id={headingId} class="text-fg-default text-sm leading-5 font-medium">{headline}</h3>
				{#each targets as target, index (`${target}-${index}`)}
					<code
						class="text-fg-secondary mt-1 block font-mono text-xs leading-5 break-words select-text"
						data-testid="approval-normalized-resource"
					>
						<SensitiveText text={target} />
					</code>
				{/each}
				{#if reason}
					<p class="text-fg-tertiary mt-1 text-xs leading-4 select-text">
						<SensitiveText text={reason} />
					</p>
				{/if}
			</div>
		</div>

		{#if item.kind === 'approval'}
			<div
				class="mt-3 flex flex-wrap items-center justify-end gap-1.5"
				role="group"
				aria-label="Permission decision"
			>
				<Button
					variant="ghost"
					size="md"
					class="text-xs"
					disabled={submitting}
					onclick={() => decideApproval(item, 'deny', 'once')}
				>
					Deny
				</Button>
				{#if canOfferPersistentScope}
					<Dropdown bind:open={alwaysAllowOpen} side="bottom" align="end">
						{#snippet trigger()}
							<Button
								variant="secondary"
								size="md"
								bordered
								class="gap-1 text-xs"
								disabled={submitting}
								ariaHasPopup="menu"
								ariaExpanded={alwaysAllowOpen}
							>
								Always allow
								{#snippet trailing()}
									<Icon name="chevron-down" size={10} />
								{/snippet}
							</Button>
						{/snippet}
						{#snippet content()}
							<div class="w-52 p-1" role="menu" aria-label="Always allow">
								<DropdownItem
									role="menuitem"
									onSelect={() => decideApproval(item, 'allow', 'session')}
								>
									Allow for this chat
								</DropdownItem>
								<DropdownItem
									role="menuitem"
									onSelect={() => decideApproval(item, 'allow', 'workstream')}
								>
									Allow for this workstream
								</DropdownItem>
							</div>
						{/snippet}
					</Dropdown>
				{/if}
				<Button
					variant="primary"
					size="md"
					class="text-xs"
					disabled={submitting}
					onclick={() => decideApproval(item, 'allow', 'once')}
				>
					Allow once
				</Button>
			</div>
		{:else}
			<form class="mt-2.5 space-y-3 pl-6.5" onsubmit={(event) => submitAnswers(event, item)}>
				{#each item.questions as question (question.id)}
					<fieldset disabled={submitting} class="space-y-1">
						<legend class="text-fg-default mb-1 text-sm leading-5">
							{#if question.header}<span class="text-fg-tertiary mr-1 text-xs">
									{question.header}
								</span>{/if}
							{question.prompt}
						</legend>
						{#each question.options as option, optionIndex (`${option.label}-${optionIndex}`)}
							<label
								class="hover:bg-surface-50-hover -mx-1.5 flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1"
							>
								<!-- eslint-disable-next-line @malini/desktop/no-raw-form-control -- one control renders as radio or checkbox from question.multiSelect; hyper-ui has no Radio and Checkbox cannot render one. -->
								<input
									type={question.multiSelect ? 'checkbox' : 'radio'}
									name={`agent-question-${item.questionId}-${question.id}`}
									value={option.label}
									checked={(selectedByQuestion[question.id] ?? []).includes(option.label)}
									onchange={(event) => {
										const input = event.currentTarget;
										if (!(input instanceof HTMLInputElement)) return;
										setOption(question, option.label, input.checked);
									}}
									class="accent-accent mt-0.5"
								/>
								<span class="min-w-0">
									<span class="text-fg-default block text-xs">{option.label}</span>
									{#if option.description}<span class="text-2xs text-fg-tertiary block">
											{option.description}
										</span>{/if}
								</span>
							</label>
						{/each}
						{#if question.allowFreeText}
							<TextInput
								label="Other answer"
								value={freeTextByQuestion[question.id] ?? ''}
								oninput={(event) => {
									const input = event.currentTarget;
									if (!(input instanceof HTMLInputElement)) return;
									setFreeText(question, input.value);
								}}
								class="mt-1"
								inputClass="text-xs"
							/>
						{/if}
					</fieldset>
				{/each}
				<div class="flex justify-end">
					<Button type="submit" variant="primary" size="md" class="text-xs" disabled={submitting}>
						Send answer
					</Button>
				</div>
			</form>
		{/if}

		{#if interactionState.status === 'error'}
			<p class="text-2xs text-error-content mt-2 flex items-start gap-1.5 leading-4" role="alert">
				<Icon name="alert" class="mt-px shrink-0" size={13} />
				<span class="min-w-0">
					<SensitiveText text={sanitizeFailureDetail(interactionState.message)} /> Claude is still waiting,
					so you can answer again.
				</span>
			</p>
		{/if}
	</section>
{/if}
