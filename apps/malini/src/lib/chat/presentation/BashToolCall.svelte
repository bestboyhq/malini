<script lang="ts">
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Icon } from '$hyper-ui/icons';
	import { Button } from '$hyper-ui/components/button';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import CodeTokens from './CodeTokens.svelte';
	import { toolFailureReason } from './tool-display-name';

	interface Props {
		command: string;
		operationName?: string;
		description?: string | null;
		status: 'running' | 'completed' | 'failed';
		waiting?: boolean;
		output?: unknown;
		error?: string | null;
		exitCode?: number | null;
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
	}: Props = $props();
	let expanded = $state(false);

	const outputText = $derived(formatOutput(output, error));
	const activityLabel = $derived(
		command === operationName ? operationName : `${operationName} · ${command}`,
	);

	const exitLabel = $derived(exitCode !== null && exitCode !== 0 ? `exit ${exitCode}` : null);
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
		class="group/command text-fg-tertiary hover:text-fg-secondary focus-visible:ring-border-default/50 flex min-h-6 w-full cursor-pointer items-center gap-2 bg-transparent text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
		ariaLabel={`${expanded ? 'Collapse' : 'Expand'} output for ${description ?? activityLabel}`}
		ariaExpanded={expanded}
		data-testid="bash-command-toggle"
		onclick={() => (expanded = !expanded)}
	>
		<span class="relative h-3.5 w-3.5 shrink-0" aria-hidden="true">
			<Icon
				name="command"
				class={`absolute inset-0 transition-[opacity,color] ${expanded ? 'opacity-0' : 'opacity-100 group-hover/command:opacity-0'} ${status === 'running' && !waiting ? 'command-mark-live text-fg-secondary' : ''}`}
				size={14}
			/>
			<Icon
				name="chevron-right"
				class={`absolute inset-0 h-3.5 w-3.5 transition-[opacity,transform] duration-150 ${expanded ? 'rotate-90 opacity-100' : 'opacity-0 group-hover/command:opacity-100'}`}
			/>
		</span>
		{#if description}
			<span class="flex min-w-0 flex-1 items-baseline gap-2">
				<span class="text-fg-secondary min-w-0 truncate" data-bash-description>
					<SensitiveText text={description} />
				</span>
				<span class="text-2xs min-w-0 flex-1 truncate font-mono">
					<SensitiveText text={command} />
				</span>
			</span>
		{:else}
			<span class="text-2xs min-w-0 flex-1 truncate font-mono">
				<SensitiveText text={activityLabel} />
			</span>
		{/if}
		{#if waiting}
			<span class="text-3xs text-fg-tertiary/70 shrink-0 font-mono">waiting</span>
		{:else if exitLabel}
			<span class="text-3xs text-fg-tertiary/70 shrink-0 font-mono tabular-nums">{exitLabel}</span>
		{/if}
	</Button>

	{#if status === 'failed'}
		<div
			class="bg-error text-2xs text-error-content mt-1 ml-5 flex items-start gap-2 rounded-md px-2.5 py-1.5 leading-relaxed"
			data-testid="bash-command-failure"
		>
			<Icon name="warning" size={12} class="mt-px shrink-0" />
			<span class="min-w-0 flex-1 break-words select-text">
				<SensitiveText text={failureReason} />
			</span>
		</div>
	{/if}

	{#if expanded}
		<ScrollableDiv
			orientation="xy"
			class="border-surface-50-border mt-1 ml-5 max-h-64 rounded-lg border-[0.5px]"
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
				<pre
					class="text-2xs text-fg-secondary m-0 min-w-max bg-transparent px-2.5 pt-1.5 pb-2 font-mono leading-snug select-text"><SensitiveText
						text={outputText}
					/></pre>
			{/if}
		</ScrollableDiv>
	{/if}
</div>

<style>
	:global(.command-mark-live) {
		animation: command-mark-breathe 1.6s ease-in-out infinite;
	}

	@keyframes command-mark-breathe {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.45;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		:global(.command-mark-live) {
			animation: none;
		}
	}
</style>
