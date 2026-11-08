<script lang="ts">
	import { cubicOut } from 'svelte/easing';
	import type { ClassValue } from 'svelte/elements';
	import { fade, type TransitionConfig } from 'svelte/transition';
	import { motionOff } from '$hyper-ui/motion/motion-off';
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
		leavesTheSandbox,
		maliniToolApproval,
		sandboxGrantRows,
		type SandboxGrantRow,
	} from '$lib/chat/domain/approval-request';
	import type { AgentApprovalScope } from '$lib/chat/domain/agent-interaction';
	import { Button } from '$hyper-ui/components/button';
	import { Strip } from '$hyper-ui/components/strip';
	import { Dropdown, DropdownItem } from '$hyper-ui/components/dropdown';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon, type IconName } from '$hyper-ui/icons';
	import AgentEditReview from './AgentEditReview.svelte';
	import type { RenderItem } from './render-state';
	import { automationName } from '$lib/automations/automations.api';
	import { workstreamNameQuery } from '$shared/repositories/repositories.api';
	import { sanitizeFailureDetail } from '$shared/errors/failure-copy';

	interface Props {
		item: Extract<RenderItem, { kind: 'approval' }>;
		bare?: boolean;
		class?: ClassValue;
	}

	let { item, bare = false, class: className }: Props = $props();

	function collapseAway(node: HTMLElement): TransitionConfig {
		if (motionOff()) return { duration: 0 };
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
	] as const satisfies readonly AlwaysAllowChoice[];

	const ALWAYS_ALLOW_IN_THE_SANDBOX = [
		ALWAYS_ALLOW[0],
		{
			scope: 'repository',
			label: 'Allow for this repository',
			description: 'Every chat in this repository',
			icon: 'book',
		},
		{
			scope: 'everywhere',
			label: 'Allow everywhere',
			description: 'Every repository, until you revoke it',
			icon: 'globe',
		},
	] as const satisfies readonly AlwaysAllowChoice[];

	const GRANT_ICONS: Record<SandboxGrantRow['kind'], IconName> = {
		folder: 'folder-open',
		socket: 'plug',
		docker: 'cube',
	};

	interface AlwaysAllowChoice {
		scope: AgentApprovalScope;
		label: string;
		description: string;
		icon: IconName;
	}

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
	const headingId = $derived(`agent-interaction-${item.kind}-${item.sessionId}-${item.seq}`);
	const canOfferPersistentScope = $derived(canPersistAgentApproval(item.permission));
	const grants = $derived(sandboxGrantRows(item.permission));
	const leavesSandbox = $derived(
		grants.length === 0 && leavesTheSandbox(item.toolName, item.input),
	);
	const alwaysAllowChoices = $derived(
		grants.length > 0 ? ALWAYS_ALLOW_IN_THE_SANDBOX : ALWAYS_ALLOW,
	);
	const maliniTool = $derived(
		maliniToolApproval(
			item.toolName,
			item.input,
			{ automation: automationName, workstream: (id) => workstreamNameQuery.data(id) ?? id },
			item.review,
		),
	);
	const headline = $derived(
		maliniTool?.headline ?? approvalHeadline(item.toolName, item.permission),
	);
	const targets = $derived(maliniTool ? [] : approvalTargets(item.permission, item.input));
	const reason = $derived(maliniTool ? null : approvalReason(item.reason));
	const alwaysAllowed = $derived(
		interactionState.status === 'resolved' && interactionState.alwaysAllowed === true,
	);
	const settledSubject = $derived(
		alwaysAllowed && item.autoModeRule
			? item.autoModeRule
			: (maliniTool?.headline ?? approvalShortTarget(item.toolName, item.permission)),
	);
	const settledIcon = $derived<IconName>(
		interactionState.status === 'stale'
			? 'clock'
			: interactionState.status === 'resolved' && interactionState.decision === 'deny'
				? 'circle-slash'
				: 'check',
	);
	const settledMessage = $derived(
		interactionState.status === 'resolved' || interactionState.status === 'stale'
			? interactionState.message
			: '',
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

{#snippet request()}
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
	{#if grants.length > 0}
		<ul class="mt-2 flex flex-col gap-2" aria-label="Blocked by the sandbox">
			{#each grants as grant (grant.path)}
				<li class="flex items-start gap-2">
					<span class="grid h-5 w-3.5 shrink-0 place-items-center" aria-hidden="true">
						<Icon name={GRANT_ICONS[grant.kind]} size={13} class="text-fg-tertiary" />
					</span>
					<span class="flex min-w-0 flex-col">
						<span class="text-xs leading-5">
							<span class="text-fg-default">{grant.name}</span>
							<code class="text-fg-secondary ml-1 font-mono break-all select-text">
								<SensitiveText text={grant.path} />
							</code>
						</span>
						<span class="text-fg-tertiary text-2xs leading-4">{grant.risk}</span>
					</span>
				</li>
			{/each}
		</ul>
	{/if}
	{#if maliniTool && maliniTool.details.length > 0}
		<dl class="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs leading-5">
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
{/snippet}

{#snippet decisions(size: 'sm' | 'md')}
	{@const text = size === 'md' ? 'text-xs' : ''}
	<Button
		variant="ghost"
		{size}
		class={text}
		disabled={submitting}
		onclick={() => decideApproval(item, 'deny', 'once')}
	>
		{item.autoModeRule || item.autoModeUnavailable ? 'Keep blocked' : 'Deny'}
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
				{size}
				bordered
				class={text}
				disabled={submitting}
				onclick={() => decideApproval(item, 'allow', 'once', true)}
			>
				Always allow
			</Button>
		</Tooltip>
	{:else if leavesSandbox}
		<Button
			variant="secondary"
			{size}
			bordered
			class={text}
			disabled={submitting}
			onclick={() => decideApproval(item, 'allow', 'session')}
		>
			Allow for this chat
		</Button>
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
					{size}
					bordered
					class={['gap-1', text]}
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
					{#each alwaysAllowChoices as choice (choice.scope)}
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
		{size}
		class={text}
		disabled={submitting}
		onclick={() => decideApproval(item, 'allow', 'once')}
	>
		Allow once
	</Button>
{/snippet}

{#snippet failure()}
	{#if interactionState.status === 'error'}
		<p class="text-2xs text-error-content mt-2 flex items-start gap-1.5 leading-4" role="alert">
			<Icon name="alert" class="mt-px shrink-0" size={13} />
			<span class="min-w-0">
				<SensitiveText text={sanitizeFailureDetail(interactionState.message)} /> Claude is still waiting,
				so you can answer again.
			</span>
		</p>
	{/if}
{/snippet}

{#if settled && (bare || item.review)}
	<div
		in:fade={motionOff() ? { duration: 0 } : { duration: 180, delay: 60 }}
		class="text-fg-tertiary flex min-h-6 w-full items-center gap-2 text-sm"
		data-message-kind={item.kind}
		data-testid={`agent-${item.kind}-card`}
		data-interaction-state={interactionState.status}
		role="status"
	>
		<span class="grid h-3.5 w-3.5 shrink-0 place-items-center" aria-hidden="true">
			<Icon name={settledIcon} size={13} />
		</span>
		<span class="text-fg-secondary shrink-0">{settledMessage}</span>
		{#if settledSubject}
			<span class="text-2xs min-w-0 flex-1 truncate font-mono">
				<SensitiveText text={settledSubject} />
			</span>
		{/if}
	</div>
{:else if bare || item.review}
	<section
		out:collapseAway
		class={[
			'py-3',
			bare
				? 'w-full px-3.5'
				: ['bg-surface-50 border-surface-50-border rounded-xl border px-3', className],
		]}
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
					<Icon name="shield-alert" class="text-brand-icon" size={15} />
				</span>
				<div class="min-w-0 flex-1">
					{@render request()}
				</div>
			</div>

			<div
				class="mt-3 flex flex-wrap items-center justify-end gap-1.5"
				role="group"
				aria-label="Permission decision"
			>
				{@render decisions('md')}
			</div>
		{/if}

		{@render failure()}
	</section>
{:else}
	<section
		class={className}
		data-message-kind={item.kind}
		data-testid={`agent-${item.kind}-card`}
		data-interaction-state={interactionState.status}
		aria-labelledby={headingId}
		aria-busy={submitting}
	>
		<div class="bg-surface-50 border-surface-50-border rounded-xl border-[0.5px] px-3 py-3">
			{@render request()}
		</div>
		<Strip>
			{#if settled}
				<span
					in:fade={motionOff() ? { duration: 0 } : { duration: 180, delay: 60 }}
					class="text-fg-secondary flex min-w-0 items-center gap-1.5"
					role="status"
				>
					<Icon name={settledIcon} size={12} />
					<span class="shrink-0">{settledMessage}</span>
					{#if alwaysAllowed && item.autoModeRule}
						<span class="text-fg-tertiary text-2xs min-w-0 truncate font-mono">
							<SensitiveText text={item.autoModeRule} />
						</span>
					{/if}
				</span>
			{:else}
				<span class="text-fg-secondary flex min-w-0 items-center gap-1.5">
					<Icon name="shield-alert" size={12} />
					<span class="truncate">Permission request</span>
				</span>
				<div
					class="ml-auto flex shrink-0 items-center gap-1"
					role="group"
					aria-label="Permission decision"
				>
					{@render decisions('sm')}
				</div>
			{/if}
		</Strip>

		{@render failure()}
	</section>
{/if}
