<script lang="ts">
	import { onMount } from 'svelte';
	import { observeRunStartCommand } from '$lib/chat/application/commands/observe-run-start.command';
	import { runStartedAtQuery } from '$lib/chat/application/queries/run-started-at.query.svelte';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import type { RenderState } from './render-state';
	import { deriveRunStatus } from './run-status';
	import { transcriptContext } from './chat-message-list/transcript-context';

	interface Props {
		renderState: RenderState;
		waitingForUser?: boolean;
	}

	let { renderState, waitingForUser = false }: Props = $props();
	const { stageEnter, timelineKey } = transcriptContext();

	const runs = $derived(renderState.runs);
	const openRun = $derived.by(() => {
		const last = runs[runs.length - 1];
		return last && last.terminal === null ? last : null;
	});

	let nowMs = $state(Date.now());
	const runStartedAtMs = $derived(openRun ? runStartedAtQuery.data(openRun.runId) : null);

	$effect(() => {
		if (openRun) observeRunStartCommand(openRun.runId);
	});

	const TICK_MS = 100;

	onMount(() => {
		const interval = setInterval(() => {
			nowMs = Date.now();
		}, TICK_MS);
		return () => clearInterval(interval);
	});

	const status = $derived(deriveRunStatus({ isRunOpen: openRun !== null, runStartedAtMs, nowMs }));
	const statusText = $derived(status.text);
</script>

<div
	class={['flex min-h-6 items-center', !openRun && 'sr-only']}
	data-testid="run-status-slot"
	role="status"
	aria-live="polite"
>
	{#if statusText && openRun}
		<div
			class="flex min-w-0 flex-1 items-center gap-1.5 text-xs"
			use:stageEnter={timelineKey(openRun, 'status')}
			data-testid="run-status-line"
			data-message-kind="assistant-working"
		>
			{#if waitingForUser}
				<span class="text-fg-tertiary grid h-5 w-5 shrink-0 place-items-center" aria-hidden="true">
					<Icon name="pause" size={12} />
				</span>
				<span class="text-fg-tertiary min-w-0 flex-1 truncate" data-testid="run-status-text">
					Waiting for you
				</span>
			{:else}
				<span
					class="text-fg-tertiary grid h-5 w-5 shrink-0 place-items-center"
					aria-hidden="true"
					data-testid="agent-working-loader"
				>
					<BusyIcon size={12} />
				</span>
				<span class="sr-only">Agent is working</span>
				<span
					class="text-fg-tertiary min-w-0 flex-1 truncate font-mono tabular-nums"
					aria-hidden="true"
					data-testid="run-status-text"
				>
					{statusText}
				</span>
			{/if}
		</div>
	{/if}
</div>
