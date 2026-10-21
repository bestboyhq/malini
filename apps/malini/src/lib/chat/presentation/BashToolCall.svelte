<script lang="ts">
	import { quartOut } from 'svelte/easing';
	import { prefersReducedMotion } from 'svelte/motion';
	import { fade, slide } from 'svelte/transition';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Icon } from '$hyper-ui/icons';
	import { Button } from '$hyper-ui/components/button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { CodeTokens } from '$hyper-ui/components/code-tokens';
	import type { FullToolOutput } from '$lib/chat/domain/full-tool-output';
	import ExpandMark from './ExpandMark.svelte';
	import ToolLabel from './ToolLabel.svelte';
	import ToolOutputText from './ToolOutputText.svelte';
	import {
		shellCommandLabel,
		shellExitCode,
		toolFailureReason,
		withoutShellExit,
	} from './tool-display-name';

	interface Props {
		command: string;
		operationName?: string;
		description?: string | null;
		status: 'running' | 'completed' | 'failed';
		waiting?: boolean;
		output?: unknown;
		error?: string | null;
		exitCode?: number | null;
		outputLength?: number | null;
		fullOutput?: FullToolOutput | null;
		onloadfulloutput?: (() => void) | undefined;
	}

	let {
		command,
		operationName = 'Shell',
		description = null,
		status,
		waiting = false,
		output = undefined,
		error = null,
		exitCode = null,
		outputLength = null,
		fullOutput = null,
		onloadfulloutput,
	}: Props = $props();
	let expanded = $state(false);

	const outputText = $derived(formatOutput(output, withoutShellExit(error)));
	const commandLabel = $derived(shellCommandLabel(command));
	const activityLabel = $derived(
		command === operationName ? operationName : `${operationName} · ${commandLabel}`,
	);

	const shownExitCode = $derived(exitCode ?? shellExitCode(error));
	const exitLabel = $derived(shownExitCode ? `exit ${shownExitCode}` : null);
	const failed = $derived(status === 'failed' && shellExitCode(error) === null);
	const failureReason = $derived(toolFailureReason(error) ?? 'The command could not finish');

	function formatOutput(value: unknown, failure: string | null): string | null {
		const formatted =
			value === undefined || value === null
				? null
				: typeof value === 'string'
					? value
					: stringify(value);
		const trimmed = formatted?.trimEnd() || null;
		if (!failure) return trimmed;
		return trimmed ? `${trimmed}\n\n${failure}` : failure;
	}

	function stringify(value: unknown): string {
		try {
			return JSON.stringify(value, null, 2);
		} catch {
			return String(value);
		}
	}
</script>

<div class="w-full text-sm" data-message-kind="bash" data-bash-status={status}>
	<Button
		bare
		class="group/expand text-fg-tertiary hover:text-fg-secondary focus-visible:ring-border-default/50 flex min-h-6 w-full cursor-pointer items-center gap-2 bg-transparent text-left transition-[color,border-color] focus-visible:ring-2 focus-visible:outline-none"
		ariaLabel={`${expanded ? 'Collapse' : 'Expand'} output for ${description ?? activityLabel}`}
		ariaExpanded={expanded}
		data-testid="bash-command-toggle"
		onclick={() => (expanded = !expanded)}
	>
		<ExpandMark>
			<Icon name="command" size={14} />
		</ExpandMark>
		<ToolLabel
			title={description ?? operationName}
			detail={command === operationName ? null : commandLabel}
			emphasized={description !== null}
			live={status === 'running' && !waiting}
		/>
		{#if waiting}
			<span class="text-3xs text-fg-tertiary/70 shrink-0 font-mono" in:fade={{ duration: 190 }}>
				waiting
			</span>
		{:else if exitLabel}
			<span
				class="text-3xs text-error-content shrink-0 font-mono tabular-nums"
				in:fade={{ duration: 190 }}
			>
				{exitLabel}
			</span>
		{/if}
	</Button>

	{#if failed}
		<div
			class="bg-error text-2xs text-error-content mt-1 ml-5.5 flex items-start gap-2 rounded-md px-2.5 py-1.5 leading-relaxed"
			data-testid="bash-command-failure"
			in:fade={{ duration: 190 }}
		>
			<Icon name="warning" size={12} class="mt-1 shrink-0" />
			<span class="min-w-0 flex-1 break-words select-text">
				<SensitiveText text={failureReason} />
			</span>
		</div>
	{/if}

	{#if expanded}
		<div
			class="pt-1"
			transition:slide={{ duration: prefersReducedMotion.current ? 0 : 240, easing: quartOut }}
		>
			<ScrollableDiv
				orientation="xy"
				class="border-surface-50-border ml-5.5 max-h-64 rounded-lg border-[0.5px]"
				viewportClass="max-h-64 max-w-full"
				ariaLabel="Command output"
				testId="command-output-scroll"
			>
				<pre
					class="text-2xs m-0 min-w-max bg-transparent px-2.5 pt-2 pb-1.5 font-mono leading-snug select-text"><CodeTokens
						code={command}
						language="shell"
					/></pre>
				{#if outputText}
					<ToolOutputText
						text={outputText}
						class="text-2xs text-fg-secondary m-0 min-w-max bg-transparent px-2.5 pt-1.5 font-mono leading-snug select-text"
						endClass="pb-2"
						fullLength={outputLength}
						{fullOutput}
						onloadfull={onloadfulloutput}
					/>
				{/if}
			</ScrollableDiv>
		</div>
	{/if}
</div>
