<script lang="ts">
	import { observeRunStartCommand } from '$lib/chat/application/commands/observe-run-start.command';
	import { runStartedAtQuery } from '$lib/chat/application/queries/run-started-at.query.svelte';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { backgroundWorkSummary, type BackgroundWork } from '$lib/chat/domain/background-work';
	import type { RunGroup } from './render-state';
	import { formatRunSeconds, tenthsPhaseDelayMs } from './run-status';
	import { transcriptContext } from './chat-message-list/transcript-context';

	interface Props {
		run: RunGroup;
		waitingForUser?: boolean;
		background?: BackgroundWork | null;
	}

	let { run, waitingForUser = false, background = null }: Props = $props();
	const { stageEnter, timelineKey } = transcriptContext();

	const SECOND_MS = 1_000;

	const openRun = $derived(run.terminal === null ? run : null);
	const runStartedAtMs = $derived(openRun ? runStartedAtQuery.data(openRun.runId) : null);
	let elapsedMs = $state(0);
	let tenthsDelayMs = $state(0);

	$effect(() => {
		if (openRun) observeRunStartCommand(openRun.runId);
	});

	$effect(() => {
		if (!openRun) return;
		const startedAtMs = runStartedAtMs ?? Date.now();
		let timer: ReturnType<typeof setTimeout> | null = null;
		const tick = (): void => {
			elapsedMs = Math.max(0, Date.now() - startedAtMs);
			timer = setTimeout(tick, SECOND_MS - (elapsedMs % SECOND_MS));
		};
		tick();
		tenthsDelayMs = tenthsPhaseDelayMs(startedAtMs, performance.timeOrigin);
		return () => {
			if (timer !== null) clearTimeout(timer);
		};
	});

	const statusText = $derived(openRun ? formatRunSeconds(elapsedMs) : null);
	const backgroundSummary = $derived(
		openRun && background?.runId === openRun.runId ? backgroundWorkSummary(background.tasks) : null,
	);
	const waitingOnBackground = $derived(backgroundSummary !== null && background?.waiting === true);
</script>

<div
	class={['flex min-h-6 items-center', !openRun && 'sr-only']}
	data-testid="run-status-slot"
	role="status"
	aria-live="polite"
>
	{#if statusText && openRun}
		<div
			class="flex min-w-0 flex-1 items-center gap-2 text-xs"
			use:stageEnter={timelineKey(openRun, 'status')}
			data-testid="run-status-line"
			data-message-kind="assistant-working"
		>
			{#if waitingForUser}
				<span
					class="text-fg-tertiary grid h-3.5 w-3.5 shrink-0 place-items-center"
					aria-hidden="true"
				>
					<Icon name="circle-pause" size={12} />
				</span>
				<span class="text-fg-tertiary min-w-0 truncate" data-testid="run-status-text">
					Waiting for you
				</span>
			{:else if waitingOnBackground}
				<span
					class="text-fg-tertiary grid h-3.5 w-3.5 shrink-0 place-items-center"
					aria-hidden="true"
				>
					<Icon name="clock" size={12} />
				</span>
				<span class="text-fg-tertiary min-w-0 truncate" data-testid="run-status-text">
					Waiting on {backgroundSummary}
				</span>
			{:else}
				<span
					class="text-fg-tertiary grid h-3.5 w-3.5 shrink-0 place-items-center"
					aria-hidden="true"
					data-testid="agent-working-loader"
				>
					<BusyIcon size={12} />
				</span>
				<span class="sr-only">Agent is working</span>
				<span
					class="text-fg-tertiary flex min-w-0 overflow-hidden font-mono whitespace-nowrap tabular-nums"
					aria-hidden="true"
					data-testid="run-status-text"
				>
					<span>{statusText}.</span>
					<span class="run-status-tenths">
						<span style:animation-delay="{tenthsDelayMs}ms">0123456789</span>
					</span>
					<span>s</span>
				</span>
			{/if}
			{#if backgroundSummary && !waitingOnBackground && !waitingForUser}
				<span class="text-fg-tertiary" aria-hidden="true">·</span>
				<span class="text-fg-tertiary min-w-0 flex-1 truncate">{backgroundSummary} running</span>
			{/if}
		</div>
	{/if}
</div>

<style>
	.run-status-tenths {
		display: inline-block;
		height: 1lh;
		overflow: hidden;
		vertical-align: top;
	}

	.run-status-tenths > span {
		display: block;
		width: 1ch;
		word-break: break-all;
		white-space: normal;
		animation: run-status-tenths 1s steps(10, end) infinite;
	}

	@keyframes run-status-tenths {
		to {
			translate: 0 -100%;
		}
	}
</style>
