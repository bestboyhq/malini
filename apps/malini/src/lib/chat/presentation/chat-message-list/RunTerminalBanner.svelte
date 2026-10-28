<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { claudeSignInQuery, signInToClaudeCommand } from '$shared/providers/providers.api';
	import { continueRunCommand } from '$lib/chat/application/commands/continue-run.command';
	import { runContinuationQuery } from '$lib/chat/application/queries/run-continuation.query.svelte';
	import { splitRunErrorText, type RunGroup } from '../render-state';
	import MarkdownText from '../MarkdownText.svelte';
	import { failedRunNextStep, pauseReason, pauseTitle } from './run-stop-copy';
	import { terminalLabel } from './transcript-labels';
	import { transcriptContext } from './transcript-context';

	interface Props {
		run: RunGroup;
		latest?: boolean;
	}

	let { run, latest = false }: Props = $props();

	const transcript = transcriptContext();
	const { stageEnter, timelineKey } = transcript;
	const errorDisplay = $derived(splitRunErrorText(run.terminalText));
	const failureKind = $derived(run.failure?.kind ?? null);
	const nextStep = $derived(failureKind === null ? null : failedRunNextStep(failureKind));
	const continuing = $derived(runContinuationQuery.continuing);
	const signingIn = $derived(claudeSignInQuery.data !== 'idle');
	const canContinue = $derived(latest && !transcript.chatRunInFlight);
	const canTryAgain = $derived(
		canContinue && runContinuationQuery.origin(transcript.sessionId) !== 'job',
	);
	const canSignIn = $derived(latest && failureKind === 'sign-in');

	function continueRun(): void {
		continueRunCommand(transcript.sessionId);
	}
</script>

{#if run.terminal === 'cancelled' || (run.terminal === 'paused' && !latest)}
	<div
		class="border-surface-50-border bg-surface-50 text-2xs text-fg-secondary flex items-center gap-1.5 rounded-md border-[0.5px] px-2.5 py-1 font-medium tabular-nums"
		use:stageEnter={timelineKey(run, 'terminal')}
		data-message-kind="terminal"
		data-terminal="failed"
		data-terminal-state={run.terminal}
	>
		<Icon name={run.terminal === 'paused' ? 'pause' : 'circle-slash'} size={12} class="shrink-0" />
		<span class="tracking-wide uppercase">{terminalLabel(run)}</span>
	</div>
{:else if run.terminal === 'paused' && run.resumeAt !== null}
	<div
		class="border-surface-50-border bg-surface-50 flex w-full items-start gap-2.5 self-start rounded-md border-[0.5px] px-3 py-2.5 text-xs"
		use:stageEnter={timelineKey(run, 'terminal')}
		role="status"
		data-message-kind="terminal"
		data-terminal="paused"
		data-terminal-state={run.terminal}
		data-testid="chat-run-paused"
	>
		<span class="text-fg-tertiary mt-0.5 grid h-5 w-5 shrink-0 place-items-center">
			<Icon name="pause" size={13} />
		</span>
		<div class="min-w-0 flex-1">
			<div class="text-fg-default font-medium">{pauseTitle(run.resumeAt, new Date())}</div>
			<div class="text-fg-secondary mt-0.5 leading-5">
				{pauseReason(failureKind ?? 'unknown')}
			</div>
			{#if errorDisplay.primary}
				<div
					class="text-2xs text-fg-tertiary mt-1 line-clamp-2 break-words select-text"
					data-testid="chat-run-paused-error"
				>
					{errorDisplay.primary}
				</div>
			{/if}
		</div>
		{#if canContinue}
			<Button
				variant="secondary"
				size="sm"
				disabled={continuing}
				ariaBusy={continuing}
				onclick={continueRun}
			>
				Resume now
			</Button>
		{/if}
	</div>
{:else}
	<div
		class="border-error-content/25 bg-error text-error-content flex w-full items-start gap-2.5 self-start rounded-md border-[0.5px] px-3 py-2.5 text-xs"
		use:stageEnter={timelineKey(run, 'terminal')}
		data-message-kind="terminal"
		data-terminal="failed"
		data-terminal-state={run.terminal}
		data-testid="chat-run-error"
	>
		<span class="bg-error-content/15 mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-sm">
			<Icon name="close" size={12} />
		</span>
		<div class="min-w-0 flex-1">
			<div class="text-2xs font-medium tracking-wide uppercase">{terminalLabel(run)}</div>
			{#if run.terminalText}
				<div
					class="text-2xs text-error-content/90 mt-1 font-mono leading-relaxed break-words whitespace-pre-wrap select-text"
					data-testid="chat-run-error-text"
				>
					<MarkdownText
						text={errorDisplay.primary}
						mode="plain"
						onopenfile={transcript.openFileMention}
						canopenfile={transcript.canOpenFileMention}
					/>
				</div>
				{#if errorDisplay.diagnostics}
					<details
						class="group border-error-content/20 bg-error-content/[0.04] mt-2 overflow-hidden rounded border-[0.5px]"
						data-testid="chat-run-error-details"
					>
						<summary
							class="text-2xs text-error-content/75 hover:bg-error-content/[0.06] flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 font-medium"
						>
							<Icon
								name="chevron-right"
								size={12}
								class="shrink-0 transition-transform duration-100 group-open:rotate-90"
							/>
							<span>Diagnostics</span>
						</summary>
						<div
							class="border-error-content/15 text-2xs text-error-content/80 max-h-56 overflow-auto border-t px-2 py-2 font-mono leading-relaxed break-words whitespace-pre-wrap select-text"
							data-testid="chat-run-error-diagnostics"
						>
							<MarkdownText
								text={errorDisplay.diagnostics}
								mode="plain"
								onopenfile={transcript.openFileMention}
								canopenfile={transcript.canOpenFileMention}
							/>
						</div>
					</details>
				{/if}
			{/if}
			{#if nextStep}
				<div class="text-2xs text-error-content/80 mt-1">{nextStep}</div>
			{/if}
			{#if canSignIn || canTryAgain}
				<div class="mt-2 flex items-center gap-1.5">
					{#if canSignIn}
						<Button
							variant="secondary"
							size="sm"
							disabled={signingIn}
							ariaBusy={signingIn}
							onclick={() => signInToClaudeCommand()}
						>
							Sign in
						</Button>
					{/if}
					{#if canTryAgain}
						<Button
							variant="secondary"
							size="sm"
							disabled={continuing}
							ariaBusy={continuing}
							onclick={continueRun}
						>
							Try again
						</Button>
					{/if}
				</div>
			{/if}
		</div>
		{#if run.terminalText}
			<Tooltip
				content={transcript.copiedErrorKey === run.runId
					? 'Copied'
					: errorDisplay.diagnostics
						? 'Copy full diagnostics'
						: 'Copy full error'}
				placement="top"
			>
				<IconButton
					bare
					class="text-error-content/70 hover:bg-error-content/10 hover:text-error-content focus-visible:ring-error-content/30 grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded transition-[color,border-color] focus-visible:ring-2 focus-visible:outline-none"
					ariaLabel="Copy run error"
					onclick={() =>
						transcript.copyErrorText(run.runId, errorDisplay.diagnostics ?? errorDisplay.primary)}
				>
					<Icon name="copy" size={14} />
				</IconButton>
			</Tooltip>
		{/if}
	</div>
{/if}
