<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Icon } from '$hyper-ui/icons';
	import { Strip } from '$hyper-ui/components/strip';
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
		canContinue && runContinuationQuery.origin(transcript.sessionId) !== 'automation',
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
	<section
		class="-mx-3"
		use:stageEnter={timelineKey(run, 'terminal')}
		role="status"
		data-message-kind="terminal"
		data-terminal="paused"
		data-terminal-state={run.terminal}
		data-testid="chat-run-paused"
	>
		<div class="border-surface-50-border bg-surface-50 rounded-xl border-[0.5px] px-3 py-3">
			<p class="text-fg-default text-sm leading-6">{pauseReason(failureKind ?? 'unknown')}</p>
			{#if errorDisplay.primary}
				<p
					class="text-2xs text-fg-tertiary mt-0.5 line-clamp-2 break-words select-text"
					data-testid="chat-run-paused-error"
				>
					{errorDisplay.primary}
				</p>
			{/if}
		</div>
		<Strip>
			<span class="text-fg-secondary flex min-w-0 items-center gap-1.5">
				<Icon name="pause" size={12} class="shrink-0" />
				<span class="truncate">{pauseTitle(run.resumeAt, new Date())}</span>
			</span>
			{#if canContinue}
				<Button
					variant="secondary"
					size="sm"
					bordered
					class="ml-auto"
					disabled={continuing}
					ariaBusy={continuing}
					onclick={continueRun}
				>
					Resume now
				</Button>
			{/if}
		</Strip>
	</section>
{:else}
	<section
		class="-mx-3"
		use:stageEnter={timelineKey(run, 'terminal')}
		aria-label={terminalLabel(run)}
		data-message-kind="terminal"
		data-terminal="failed"
		data-terminal-state={run.terminal}
		data-testid="chat-run-error"
	>
		<div class="border-surface-50-border bg-surface-50 rounded-xl border-[0.5px] px-3 py-3">
			<div
				class="text-2xs text-fg-secondary font-mono leading-relaxed break-words whitespace-pre-wrap select-text"
				data-testid="chat-run-error-text"
			>
				<MarkdownText
					text={errorDisplay.primary || 'Agent run failed'}
					mode="plain"
					onopenfile={transcript.openFileMention}
					canopenfile={transcript.canOpenFileMention}
				/>
			</div>
			{#if nextStep}
				<p class="text-2xs text-fg-tertiary mt-1">{nextStep}</p>
			{/if}
			{#if errorDisplay.diagnostics}
				<details class="group mt-1.5" data-testid="chat-run-error-details">
					<summary
						class="text-2xs text-fg-tertiary hover:text-fg-secondary inline-flex cursor-pointer list-none items-center gap-1 font-medium"
					>
						Diagnostics
						<Icon
							name="chevron-down"
							size={10}
							class="transition-transform duration-100 group-open:rotate-180"
						/>
					</summary>
					<div
						class="text-2xs text-fg-tertiary mt-1 max-h-56 overflow-auto font-mono leading-relaxed break-words whitespace-pre-wrap select-text"
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
		</div>
		<Strip>
			<span class="text-error-content flex min-w-0 items-center gap-1.5">
				<Icon name="close" size={12} class="shrink-0" />
				<span class="truncate">{terminalLabel(run)}</span>
			</span>
			<div class="ml-auto flex shrink-0 items-center gap-1">
				{#if run.terminalText}
					<Tooltip
						content={transcript.copiedErrorKey === run.runId
							? 'Copied'
							: errorDisplay.diagnostics
								? 'Copy full diagnostics'
								: 'Copy full error'}
						placement="top"
					>
						<Button
							variant="ghost"
							size="sm"
							class="gap-1"
							onclick={() =>
								transcript.copyErrorText(
									run.runId,
									errorDisplay.diagnostics ?? errorDisplay.primary,
								)}
						>
							<Icon name="copy" size={12} />
							Copy error
						</Button>
					</Tooltip>
				{/if}
				{#if canTryAgain}
					<Button
						variant={canSignIn ? 'secondary' : 'primary'}
						size="sm"
						bordered={canSignIn}
						disabled={continuing}
						ariaBusy={continuing}
						onclick={continueRun}
					>
						Try again
					</Button>
				{/if}
				{#if canSignIn}
					<Button
						variant="primary"
						size="sm"
						disabled={signingIn}
						ariaBusy={signingIn}
						onclick={() => signInToClaudeCommand()}
					>
						Sign in
					</Button>
				{/if}
			</div>
		</Strip>
	</section>
{/if}
