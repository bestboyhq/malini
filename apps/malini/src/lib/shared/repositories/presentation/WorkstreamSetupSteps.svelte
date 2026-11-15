<script lang="ts">
	import type { Snippet } from 'svelte';
	import { backOut, quintOut } from 'svelte/easing';
	import { Tween } from 'svelte/motion';
	import { scale, type TransitionConfig } from 'svelte/transition';
	import { Button } from '$hyper-ui/components/button';
	import { ShimmerText } from '$hyper-ui/components/shimmer-text';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { motionOff } from '$hyper-ui/motion/motion-off';
	import { removeFailedWorkstreamCommand } from '$shared/repositories/application/commands/remove-failed-workstream.command';
	import { retryDependencyInstallCommand } from '$shared/repositories/application/commands/retry-dependency-install.command';
	import { retryProvisioningCommand } from '$shared/repositories/application/commands/retry-provisioning.command';
	import { provisioningRecordQuery } from '$shared/repositories/application/queries/provisioning-record.query.svelte';
	import { provisioningRetryingQuery } from '$shared/repositories/application/queries/provisioning-retrying.query.svelte';
	import { workstreamByIdQuery } from '$shared/repositories/application/queries/workstream-by-id.query.svelte';
	import { workstreamSetupStepsQuery } from '$shared/repositories/application/queries/workstream-setup-steps.query.svelte';

	interface Props {
		workstreamId: string;
		children: Snippet<[number]>;
	}

	type Rise = Readonly<{
		delay?: number;
		y?: number;
		blur?: number;
		duration?: number;
		opacity?: number;
		unfold?: boolean;
	}>;

	const ROW_PX = 32;
	const SUGGESTIONS_REACH_PX = 38;
	const STAGGER_MS = 70;

	let { workstreamId, children }: Props = $props();

	const steps = $derived(workstreamSetupStepsQuery.data(workstreamId));
	const settled = $derived(provisioningRecordQuery.data(workstreamId) === null);
	const startedBy = $derived(workstreamByIdQuery.data(workstreamId)?.startedBy ?? null);
	const starterName = $derived(
		startedBy ? (workstreamByIdQuery.data(startedBy)?.name ?? null) : null,
	);
	const suggesting = $derived(settled && !startedBy);
	const retrying = $derived(provisioningRetryingQuery.data(workstreamId));
	const rows = $derived(steps.length + (startedBy ? 1 : 0));
	const suggestionsDelay = $derived(rows * STAGGER_MS);
	const rail = new Tween(0, { easing: quintOut });

	$effect(() => {
		const reach = Math.max(0, rows - 1) * ROW_PX + (suggesting ? SUGGESTIONS_REACH_PX : 0);
		void rail.set(reach, { duration: motionOff() ? 0 : 640 });
	});

	function rise(
		node: Element,
		{ delay = 0, y = 6, blur = 0, duration = 360, opacity = 0, unfold = false }: Rise,
	): TransitionConfig {
		const motion = motionOff() ? 0 : 1;
		const height = node.getBoundingClientRect().height;
		return {
			delay: delay * motion,
			duration: duration * motion,
			easing: quintOut,
			css: (t, u) =>
				[
					`opacity: ${opacity + (1 - opacity) * t}`,
					`transform: translateY(${u * y}px)`,
					blur ? `filter: blur(${u * blur}px)` : '',
					unfold ? `height: ${t * height}px; overflow: hidden` : '',
				].filter(Boolean).join(';'),
		};
	}

	function pop(node: Element): TransitionConfig {
		return scale(node, { start: 0.5, duration: motionOff() ? 0 : 320, easing: backOut });
	}

	function shrink(node: Element): TransitionConfig {
		return scale(node, { start: 0.6, duration: motionOff() ? 0 : 140 });
	}
</script>

{#snippet stepAction(label: string, ariaLabel: string, onclick: () => void, disabled = false)}
	<Button
		variant="inherit"
		size="auto"
		class="text-2xs text-fg-default shrink-0 px-2 py-1"
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
		style:height="{rail.current}px"
		aria-hidden="true"
	></span>
	{#each steps as step, index (step.key)}
		<li
			class="text-fg-secondary relative flex h-8 items-center gap-2.5 text-sm"
			data-step={step.key}
			data-state={step.state}
			in:rise|global={{ delay: index * STAGGER_MS, unfold: true }}
		>
			<span
				class="bg-surface-root grid size-5 shrink-0 place-items-center rounded-full"
				aria-hidden="true"
			>
				{#key step.state}
					<span
						class={[
							'col-start-1 row-start-1 grid place-items-center',
							step.state === 'failed' && 'text-error-content',
							step.state === 'skipped' && 'text-fg-tertiary',
							step.state === 'done' && 'text-success-content',
						]}
						in:pop
						out:shrink
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
			{#key step.state}
				<span class="shrink-0" in:rise={{ y: 3, blur: 2, duration: 280, opacity: 0.3 }}>
					{#if step.state === 'busy'}
						<ShimmerText text={step.label} />
					{:else}
						{step.label}
					{/if}
				</span>
				<Tooltip
					content={step.detail ?? ''}
					placement="bottom"
					onlyWhenTruncated
					class="min-w-0 flex-1"
				>
					<span
						class="text-fg-tertiary block truncate tabular-nums"
						in:rise={{ delay: 120, y: 0, duration: 320 }}
					>
						{step.detail ?? ''}
					</span>
				</Tooltip>
			{/key}
			{#if step.state === 'failed' && step.key === 'install'}
				{@render stepAction('Retry', 'Retry', () => retryDependencyInstallCommand(workstreamId))}
			{:else if step.state === 'failed'}
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
			{/if}
		</li>
	{/each}
	{#if startedBy}
		<li
			class="text-fg-default relative flex h-8 items-center gap-2.5 text-sm"
			data-step="handoff"
			in:rise|global={{ delay: steps.length * STAGGER_MS, unfold: true }}
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
		in:rise|global={{ delay: suggestionsDelay, y: 8 }}
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
		{@render children(suggestionsDelay)}
	</fieldset>
{/if}
