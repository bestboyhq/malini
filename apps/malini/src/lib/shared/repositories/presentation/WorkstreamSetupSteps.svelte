<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { quintOut } from 'svelte/easing';
	import { prefersReducedMotion, Tween } from 'svelte/motion';
	import type { TransitionConfig } from 'svelte/transition';
	import { Button } from '$hyper-ui/components/button';
	import { ShimmerText } from '$hyper-ui/components/shimmer-text';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { motionOff } from '$hyper-ui/motion/motion-off';
	import { arrivalMotion, swapFly } from '$shared/motion/arrival-motion';
	import { cancelGithubSignInCommand } from '$shared/repositories/application/commands/cancel-github-sign-in.command';
	import { removeFailedWorkstreamCommand } from '$shared/repositories/application/commands/remove-failed-workstream.command';
	import { retryProvisioningCommand } from '$shared/repositories/application/commands/retry-provisioning.command';
	import { runCheckoutActionCommand } from '$shared/repositories/application/commands/run-checkout-action.command';
	import { seedWorkstreamDependenciesCommand } from '$shared/repositories/application/commands/seed-workstream-dependencies.command';
	import { githubSignInQuery } from '$shared/repositories/application/queries/github-sign-in.query.svelte';
	import { provisioningRecordQuery } from '$shared/repositories/application/queries/provisioning-record.query.svelte';
	import { provisioningRetryingQuery } from '$shared/repositories/application/queries/provisioning-retrying.query.svelte';
	import { workstreamByIdQuery } from '$shared/repositories/application/queries/workstream-by-id.query.svelte';
	import { workstreamSetupStepsQuery } from '$shared/repositories/application/queries/workstream-setup-steps.query.svelte';
	import type { CheckoutActionKind } from '$shared/repositories/domain/checkout-finding-copy';
	import GitHubDeviceCode from './GitHubDeviceCode.svelte';

	interface Props {
		workstreamId: string;
		agentFixing: boolean;
		onaskagent: () => void;
		onreport: () => void;
		children: Snippet;
	}

	type Arrival = Readonly<{ live?: boolean; unfold?: boolean; delay?: number }>;

	const SWAP_IN_MS = 260;
	const SWAP_OUT_MS = 200;
	const ROW_PX = 32;
	const RAIL_INSET_PX = 16;
	const SUGGESTIONS_REACH_PX = 38;

	let { workstreamId, agentFixing, onaskagent, onreport, children }: Props = $props();

	const steps = $derived(workstreamSetupStepsQuery.data(workstreamId, agentFixing));
	const signIn = $derived(githubSignInQuery.data);
	const settled = $derived(provisioningRecordQuery.data(workstreamId) === null);
	const setupBusy = $derived(steps.some((step) => step.state === 'busy'));
	const startedBy = $derived(workstreamByIdQuery.data(workstreamId)?.startedBy ?? null);
	const starterName = $derived(
		startedBy ? (workstreamByIdQuery.data(startedBy)?.name ?? null) : null,
	);
	const suggesting = $derived(settled && !setupBusy && !startedBy);
	const retrying = $derived(provisioningRetryingQuery.data(workstreamId));
	const flip = $derived(prefersReducedMotion.current ? 0 : 10);
	let rowHeights: Record<string, number> = $state({});
	const lastRowKey = $derived(startedBy ? null : (steps.at(-1)?.key ?? null));
	const railInset = $derived(
		(lastRowKey === null ? ROW_PX : (rowHeights[lastRowKey] ?? ROW_PX)) - RAIL_INSET_PX,
	);
	const reach = new Tween(untrack(() => (suggesting ? 1 : 0)));
	const railBottom = $derived(
		railInset - reach.current * (railInset - RAIL_INSET_PX + SUGGESTIONS_REACH_PX),
	);

	$effect(() => {
		const still = motionOff();
		void reach.set(suggesting ? 1 : 0, {
			delay: still ? 0 : SWAP_IN_MS,
			duration: still ? 0 : arrivalMotion().durationMs,
			easing: quintOut,
		});
	});

	function onCheckoutAction(kind: CheckoutActionKind): void {
		runCheckoutActionCommand(workstreamId, kind, { onAskAgent: onaskagent, onReport: onreport });
	}

	function arrive(
		node: Element,
		{ live = true, unfold = false, delay = 0 }: Arrival,
	): TransitionConfig {
		const moving = live && !motionOff();
		const { durationMs, travelPx } = arrivalMotion();
		const height = node.getBoundingClientRect().height;
		const fold = (t: number) => (unfold ? `; height: ${t * height}px; overflow: hidden` : '');
		return {
			delay: moving ? delay : 0,
			duration: moving ? durationMs : 0,
			easing: quintOut,
			css: (t, u) => `opacity: ${t}; transform: translateY(${u * travelPx}px)${fold(t)}`,
		};
	}
</script>

{#snippet stepAction(label: string, ariaLabel: string, onclick: () => void, disabled = false)}
	<Button
		variant="inherit"
		size="auto"
		class="text-2xs text-fg-default -my-0.5 shrink-0 px-2 py-1"
		{ariaLabel}
		{disabled}
		{onclick}
	>
		{label}
	</Button>
{/snippet}

<ol class="relative pl-4.5" aria-label="Workstream setup" data-testid="workstream-setup-steps">
	<span
		class="border-surface-100-border absolute top-4 left-7 w-px -translate-x-1/2 border-l-[1px]"
		style:bottom="{railBottom}px"
		aria-hidden="true"
	></span>
	{#each steps as step (step.key)}
		{@const kind = step.action}
		<li
			class="text-fg-secondary relative text-sm"
			bind:offsetHeight={rowHeights[step.key]}
			data-step={step.key}
			data-state={step.state}
			in:arrive|global={{ live: setupBusy, unfold: true }}
		>
			<div class="flex min-h-8 items-start gap-2.5 py-1.5">
				<span
					class="bg-surface-root grid size-5 shrink-0 place-items-center overflow-hidden rounded-full"
					aria-hidden="true"
				>
					{#key step.state}
						<span
							class={[
								'grid place-items-center [grid-area:1/1]',
								step.state === 'failed' && 'text-error-content',
								step.state === 'skipped' && 'text-fg-tertiary',
								step.state === 'done' && 'text-success-content',
							]}
							in:swapFly={{ y: flip, durationMs: SWAP_IN_MS }}
							out:swapFly={{ y: -flip, durationMs: SWAP_OUT_MS }}
						>
							{#if step.state === 'busy'}
								<BusyIcon size={12} />
							{:else if step.state === 'failed'}
								<Icon name="alert" size={12} />
							{:else if step.state === 'skipped'}
								<Icon name="minus" size={12} />
							{:else}
								<Icon name="check" size={12} />
							{/if}
						</span>
					{/key}
				</span>
				<span class="grid min-w-0 flex-1 overflow-hidden">
					{#key step.state}
						<span
							class={[
								'flex min-w-0 gap-x-2.5 [grid-area:1/1]',
								step.state === 'failed' ? 'flex-wrap' : 'items-center',
							]}
							in:swapFly={{ y: flip, durationMs: SWAP_IN_MS }}
							out:swapFly={{ y: -flip, durationMs: SWAP_OUT_MS }}
						>
							<span class={step.state === 'failed' ? 'min-w-0' : 'shrink-0'}>
								{#if step.state === 'busy'}
									<ShimmerText text={step.label} />
								{:else}
									{step.label}
								{/if}
							</span>
							{#if step.state === 'failed'}
								<span class="text-fg-tertiary min-w-0">{step.detail ?? ''}</span>
							{:else}
								<Tooltip
									content={step.detail ?? ''}
									placement="bottom"
									onlyWhenTruncated
									class="min-w-0 flex-1"
								>
									<span class="text-fg-tertiary block truncate tabular-nums">
										{step.detail ?? ''}
									</span>
								</Tooltip>
							{/if}
						</span>
					{/key}
				</span>
				{#if kind === 'retry-install'}
					{@render stepAction('Retry', 'Retry', () =>
						seedWorkstreamDependenciesCommand(workstreamId),
					)}
				{:else if kind === 'retry-setup'}
					{@render stepAction(
						retrying ? 'Retrying…' : 'Retry',
						'Retry setup',
						() => retryProvisioningCommand(workstreamId),
						retrying,
					)}
					{@render stepAction(
						'Remove',
						'Remove this workstream',
						() => removeFailedWorkstreamCommand(workstreamId),
						retrying,
					)}
				{:else if kind === 'sign-in' && (signIn.kind === 'starting' || signIn.kind === 'waiting')}
					{@render stepAction('Cancel', 'Cancel signing in to GitHub', cancelGithubSignInCommand)}
				{:else if kind !== null && step.actionLabel}
					{@render stepAction(
						step.actionLabel,
						step.actionLabel,
						() => onCheckoutAction(kind),
						kind === 'sign-in' && signIn.kind === 'confirming',
					)}
				{/if}
				{#if step.secondaryAction}
					{@const secondary = step.secondaryAction}
					{@render stepAction(secondary.label, secondary.label, () =>
						onCheckoutAction(secondary.kind),
					)}
				{/if}
			</div>
			{#if kind === 'sign-in' && signIn.kind === 'waiting'}
				<div class="pb-2 pl-7.5">
					<GitHubDeviceCode userCode={signIn.userCode} />
				</div>
			{/if}
		</li>
	{/each}
	{#if startedBy}
		<li
			class="text-fg-default relative flex h-8 items-center gap-2.5 text-sm"
			data-step="handoff"
			in:arrive|global={{ live: setupBusy, unfold: true }}
		>
			<span
				class="bg-surface-root text-fg-secondary grid size-5 shrink-0 place-items-center rounded-full"
				aria-hidden="true"
			>
				<Icon name="chat" size={12} />
			</span>
			<span class="min-w-0 truncate">Prompt from {starterName ?? 'the chat that started it'}</span>
			<span class="text-fg-tertiary shrink-0">Sends once setup is done</span>
		</li>
	{/if}
</ol>
{#if suggesting}
	<fieldset
		class="border-surface-100-border mt-3 min-w-0 rounded-xl border-[1px] border-dashed px-1.5 pt-0.5 pb-1.5"
		data-testid="workstream-suggestions"
		in:arrive={{ delay: SWAP_IN_MS }}
	>
		<legend class="text-fg-tertiary ml-1.75 flex items-center gap-2.5 px-1 text-sm">
			<span
				class="bg-surface-root relative grid size-5 place-items-center rounded-full"
				aria-hidden="true"
			>
				<span class="bg-surface-root size-2.5 rounded-full border-[1px] border-current"></span>
			</span>
			Quick suggestions
		</legend>
		{@render children()}
	</fieldset>
{/if}
