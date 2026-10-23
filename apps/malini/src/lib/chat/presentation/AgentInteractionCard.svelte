<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import { fade, type TransitionConfig } from 'svelte/transition';
	import { CodeTokens } from '$hyper-ui/components/code-tokens';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { decideApprovalCommand } from '$lib/chat/application/commands/decide-approval.command';
	import { agentInteractionStateQuery } from '$lib/chat/application/queries/agent-interaction-state.query.svelte';
	import { canPersistAgentApproval } from '$lib/chat/domain/agent-interaction-state';
	import {
		approvalHeadline,
		approvalReason,
		approvalShortTarget,
		approvalTargets,
		maliniToolApproval,
	} from '$lib/chat/domain/approval-request';
	import type { AgentApprovalScope } from '$lib/chat/domain/agent-interaction';
	import { Button } from '$hyper-ui/components/button';
	import { Dropdown, DropdownItem } from '$hyper-ui/components/dropdown';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon, type IconName } from '$hyper-ui/icons';
	import AgentEditReview from './AgentEditReview.svelte';
	import type { RenderItem } from './render-state';
	import { jobName } from '$lib/jobs/jobs.api';
	import { workstreamNameQuery } from '$shared/repositories/repositories.api';
	import { sanitizeFailureDetail } from '$shared/errors/failure-copy';

	interface Props {
		item: Extract<RenderItem, { kind: 'approval' }>;
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
	let alwaysAllowOpen = $state(false);

	const ALWAYS_ALLOW = [
		{
			scope: 'session',
			label: 'Allow for this chat',
			description: 'Asks again in a new chat',
			icon: 'chat',
		},
		{
			scope: 'workstream',
			label: 'Allow for this workstream',
			description: 'Every chat in this workstream',
			icon: 'branch',
		},
		{
			scope: 'everywhere',
			label: 'Allow everywhere',
			description: 'Every workstream, until you revoke it',
			icon: 'globe',
		},
	] as const satisfies readonly {
		scope: AgentApprovalScope;
		label: string;
		description: string;
		icon: IconName;
	}[];

	const reference = $derived({
		kind: item.kind,
		sessionId: item.sessionId,
		runId: item.runId,
		requestId: item.approvalId,
	});
	const interactionState = $derived(agentInteractionStateQuery.data(reference));
	const settled = $derived(
		interactionState.status === 'resolved' || interactionState.status === 'stale',
	);
	const submitting = $derived(interactionState.status === 'submitting');
	const headingId = $derived(`agent-interaction-${item.kind}-${item.seq}`);
	const canOfferPersistentScope = $derived(canPersistAgentApproval(item.permission));
	const maliniTool = $derived(
		maliniToolApproval(
			item.toolName,
			item.input,
			{ job: jobName, workstream: (id) => workstreamNameQuery.data(id) ?? id },
			item.review,
		),
	);
	const headline = $derived(
		maliniTool?.headline ?? approvalHeadline(item.toolName, item.permission),
	);
	const targets = $derived(maliniTool ? [] : approvalTargets(item.permission));
	const reason = $derived(maliniTool ? null : approvalReason(item.reason));
	const alwaysAllowed = $derived(
		interactionState.status === 'resolved' && interactionState.alwaysAllowed === true,
	);
	const settledSubject = $derived(
		alwaysAllowed && item.autoModeRule
			? item.autoModeRule
			: (maliniTool?.headline ?? approvalShortTarget(item.toolName, item.permission)),
	);
	const settledTone = $derived(
		interactionState.status === 'stale'
			? 'stale'
			: interactionState.status === 'resolved' && interactionState.decision === 'deny'
				? 'denied'
				: 'allowed',
	);

	function decideApproval(
		approval: Props['item'],
		decision: 'allow' | 'deny',
		scope: AgentApprovalScope,
		alwaysAllow = false,
	): void {
		alwaysAllowOpen = false;
		decideApprovalCommand({
			sessionId: approval.sessionId,
			runId: approval.runId,
			approvalId: approval.approvalId,
			decision,
			scope,
			...(alwaysAllow ? { alwaysAllow } : {}),
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
		{#if item.review}
			<AgentEditReview {item} review={item.review} {headingId} {submitting} />
		{:else}
			<div class="flex items-start gap-2.5">
				<span class="grid h-5 w-4 shrink-0 place-items-center" aria-hidden="true">
					<Icon name="shield-alert" class="text-warning-content" size={15} />
				</span>
				<div class="min-w-0 flex-1">
					<h3 id={headingId} class="text-fg-default text-sm leading-5 font-medium">{headline}</h3>
					{#each targets as target, index (`${target.value}-${index}`)}
						<code
							class="text-fg-secondary mt-1 block font-mono text-xs leading-5 break-words select-text"
							data-testid="approval-normalized-resource"
						>
							{#if target.kind === 'command'}
								<CodeTokens code={target.value} language="shell" />
							{:else}
								<SensitiveText text={target.value} />
							{/if}
						</code>
					{/each}
					{#if maliniTool && maliniTool.details.length > 0}
						<dl
							class="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs leading-5"
						>
							{#each maliniTool.details as detail (detail.label)}
								<dt class="text-fg-tertiary">{detail.label}</dt>
								<dd
									class="text-fg-secondary max-h-40 overflow-y-auto break-words whitespace-pre-wrap select-text"
								>
									<SensitiveText text={detail.value} />
								</dd>
							{/each}
						</dl>
					{/if}
					{#if reason}
						<p class="text-fg-tertiary mt-1 text-xs leading-4 select-text">
							<SensitiveText text={reason} />
						</p>
					{/if}
				</div>
			</div>

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
					{item.autoModeRule ? 'Keep blocked' : 'Deny'}
				</Button>
				{#if item.autoModeRule}
					{@const rule = item.autoModeRule}
					{#snippet ruleHint()}
						Adds <code class="font-mono"><SensitiveText text={rule} /></code>
						to your Claude Code settings
					{/snippet}
					<Tooltip content={ruleHint}>
						<Button
							variant="secondary"
							size="md"
							bordered
							class="text-xs"
							disabled={submitting}
							onclick={() => decideApproval(item, 'allow', 'once', true)}
						>
							Always allow
						</Button>
					</Tooltip>
				{:else if canOfferPersistentScope}
					<Dropdown
						bind:open={alwaysAllowOpen}
						side="bottom"
						align="end"
						role={null}
						panelClass="w-72"
						contentClass="overflow-hidden"
					>
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
							<div class="p-1.5" role="menu" aria-label="Always allow">
								{#each ALWAYS_ALLOW as choice (choice.scope)}
									<DropdownItem
										role="menuitem"
										class="gap-2.5 py-2"
										onSelect={() => decideApproval(item, 'allow', choice.scope)}
									>
										<Icon name={choice.icon} size={14} class="text-fg-tertiary shrink-0" />
										<span class="flex min-w-0 flex-1 flex-col">
											<span class="truncate text-[13px] leading-5">{choice.label}</span>
											<span class="text-fg-tertiary text-2xs truncate leading-4">
												{choice.description}
											</span>
										</span>
									</DropdownItem>
								{/each}
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
