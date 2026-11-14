<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button } from '$hyper-ui/components/button';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { retryDependencyInstallCommand } from '$shared/repositories/application/commands/retry-dependency-install.command';
	import { provisioningRecordQuery } from '$shared/repositories/application/queries/provisioning-record.query.svelte';
	import { workstreamByIdQuery } from '$shared/repositories/application/queries/workstream-by-id.query.svelte';
	import { workstreamSetupStepsQuery } from '$shared/repositories/application/queries/workstream-setup-steps.query.svelte';

	interface Props {
		workstreamId: string;
		children: Snippet;
	}

	let { workstreamId, children }: Props = $props();

	const steps = $derived(workstreamSetupStepsQuery.data(workstreamId));
	const settled = $derived(provisioningRecordQuery.data(workstreamId) === null);
	const startedBy = $derived(workstreamByIdQuery.data(workstreamId)?.startedBy ?? null);
	const starterName = $derived(
		startedBy ? (workstreamByIdQuery.data(startedBy)?.name ?? null) : null,
	);
	const suggesting = $derived(settled && !startedBy);
</script>

<ol class="relative pl-4.5" aria-label="Workstream setup" data-testid="workstream-setup-steps">
	<span
		class={[
			'border-surface-100-border absolute top-4 left-7 w-px -translate-x-1/2 border-l-[1px]',
			suggesting ? '-bottom-5.5' : 'bottom-4',
		]}
		aria-hidden="true"
	></span>
	{#each steps as step (step.key)}
		<li
			class="text-fg-secondary relative flex h-8 items-center gap-2.5 text-sm"
			data-step={step.key}
			data-state={step.state}
		>
			<span
				class="bg-surface-root grid size-5 shrink-0 place-items-center rounded-full"
				aria-hidden="true"
			>
				{#if step.state === 'busy'}
					<BusyIcon size={12} />
				{:else if step.state === 'failed'}
					<span class="text-error-content"><Icon name="alert" size={12} /></span>
				{:else if step.state === 'skipped'}
					<span class="text-fg-tertiary"><Icon name="minus" size={12} /></span>
				{:else}
					<span class="text-success-content"><Icon name="check" size={12} /></span>
				{/if}
			</span>
			<span class="shrink-0">{step.label}</span>
			<span class="text-fg-tertiary min-w-0 flex-1 truncate">{step.detail ?? ''}</span>
			{#if step.key === 'install' && step.state === 'failed'}
				<Button
					variant="inherit"
					size="auto"
					class="text-2xs text-fg-default shrink-0 px-2 py-1"
					onclick={() => retryDependencyInstallCommand(workstreamId)}
				>
					Retry
				</Button>
			{/if}
		</li>
	{/each}
	{#if startedBy}
		<li class="text-fg-default relative flex h-8 items-center gap-2.5 text-sm" data-step="handoff">
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
	>
		<legend class="text-fg-tertiary ml-2 flex items-center gap-2.5 px-1 text-sm">
			<span class="grid size-5 place-items-center" aria-hidden="true">
				<span class="bg-surface-root size-2.5 rounded-full border-[1px] border-current"></span>
			</span>
			Quick suggestions
		</legend>
		{@render children()}
	</fieldset>
{/if}
