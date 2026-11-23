<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { BusyIcon } from '$hyper-ui/icons';
	import { removeWindowsSandboxCommand } from '$shared/providers/application/commands/remove-windows-sandbox.command';
	import { setUpWindowsSandboxCommand } from '$shared/providers/application/commands/set-up-windows-sandbox.command';
	import { sandboxProblemQuery } from '$shared/providers/application/queries/sandbox-problem.query.svelte';
	import { windowsSandboxQuery } from '$shared/providers/application/queries/windows-sandbox.query.svelte';
	import {
		WINDOWS_SANDBOX_CHANGES,
		windowsSandboxDetail,
	} from '$shared/providers/domain/windows-sandbox';

	const setup = $derived(windowsSandboxQuery.data);
	const problem = $derived(sandboxProblemQuery.data);
	const checked = $derived(sandboxProblemQuery.checked);
	const working = $derived(setup.kind === 'working' || !checked);
	const progress = $derived(setup.kind === 'working' ? setup.progress : null);
	const conflict = $derived(setup.kind === 'stopped' && setup.outcome === 'conflict');
	const listsChanges = $derived(checked && setup.kind === 'idle' && problem === 'not-set-up');
	const detail = $derived(
		checked ? windowsSandboxDetail(setup, problem) : 'Checking the sandbox on this PC…',
	);

	$effect(() => void sandboxProblemQuery.load());
</script>

<div
	class="border-surface-50-border bg-surface-50 flex flex-col gap-2 rounded-xl border-[0.5px] px-4 py-3"
	data-testid="windows-sandbox"
>
	<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
		<div class="min-w-0">
			<h3 class="text-fg-default text-sm font-medium">Sandbox</h3>
			<p class="text-fg-tertiary text-xs" role="status">{detail}</p>
		</div>
		{#if working}
			<BusyIcon size={16} />
		{:else if conflict}
			<Button variant="primary" size="sm" onclick={() => setUpWindowsSandboxCommand(true)}>
				Replace
			</Button>
		{:else if problem === null}
			<Button variant="secondary" size="sm" onclick={removeWindowsSandboxCommand}>Remove</Button>
		{:else if problem === 'not-set-up'}
			<Button variant="primary" size="sm" onclick={() => setUpWindowsSandboxCommand(false)}>
				Set up
			</Button>
		{:else if problem === 'outdated'}
			<Button variant="primary" size="sm" onclick={() => setUpWindowsSandboxCommand(false)}>
				Update
			</Button>
		{/if}
	</div>
	{#if progress?.total}
		<div class="flex items-center gap-3">
			<progress
				class="[&::-webkit-progress-bar]:bg-surface-150 [&::-webkit-progress-value]:bg-primary h-1 min-w-0 flex-1 appearance-none overflow-hidden rounded-full [&::-webkit-progress-value]:rounded-full"
				max={progress.total}
				value={progress.received}
				aria-label="Sandbox setup"
			></progress>
			<span class="text-fg-tertiary shrink-0 text-xs tabular-nums">
				{progress.received} of {progress.total}
			</span>
		</div>
	{/if}
	{#if listsChanges}
		<ul class="text-fg-tertiary list-disc pl-4 text-xs">
			{#each WINDOWS_SANDBOX_CHANGES as change (change)}
				<li>{change}</li>
			{/each}
		</ul>
		<p class="text-fg-tertiary text-xs">Remove takes it all off again.</p>
	{/if}
</div>
