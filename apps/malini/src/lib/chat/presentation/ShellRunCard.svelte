<script lang="ts">
	import { onMount } from 'svelte';
	import type { ShellRun } from '$contract/shell-runs';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { dismissShellRunCommand } from '$lib/chat/application/commands/dismiss-shell-run.command';
	import { sendShellInputCommand } from '$lib/chat/application/commands/send-shell-input.command';
	import { stopShellRunCommand } from '$lib/chat/application/commands/stop-shell-run.command';
	import { backgroundTaskElapsed } from '$lib/chat/domain/background-work';
	import { terminalKeySequence } from '$lib/chat/domain/terminal-text';

	interface Props {
		run: ShellRun;
	}

	let { run }: Props = $props();

	let expanded = $state(true);
	let typing = $state(false);
	let following = $state(true);
	let nowMs = $state(Date.now());
	let input = $state<HTMLTextAreaElement | null>(null);

	const running = $derived(run.state === 'running');
	const title = $derived(run.command.split('\n')[0] ?? run.command);
	const failed = $derived(run.state === 'failed' || (run.state === 'exited' && run.exitCode !== 0));
	const status = $derived.by((): string => {
		if (run.state === 'running') return backgroundTaskElapsed(Date.parse(run.startedAt), nowMs);
		if (run.state === 'stopped') return 'stopped';
		if (run.state === 'failed') return 'could not start';
		return run.exitCode === null ? 'ended' : `exit ${run.exitCode}`;
	});

	onMount(() => {
		const clock = setInterval(() => (nowMs = Date.now()), 1_000);
		return () => clearInterval(clock);
	});

	function followsOutput(node: HTMLElement): void {
		if (following && run.output) node.scrollTop = node.scrollHeight;
	}

	function onScroll(event: Event & { currentTarget: HTMLElement }): void {
		const node = event.currentTarget;
		following = node.scrollTop + node.clientHeight >= node.scrollHeight - 4;
	}

	function typesOnClick(node: HTMLElement): () => void {
		const focusInput = (): void => {
			if (window.getSelection()?.toString()) return;
			input?.focus();
		};
		node.addEventListener('click', focusInput);
		return () => node.removeEventListener('click', focusInput);
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.isComposing) return;
		const sequence = terminalKeySequence(event);
		if (sequence === null) return;
		event.preventDefault();
		sendShellInputCommand(run.id, sequence);
	}

	function onInput(event: Event & { currentTarget: HTMLTextAreaElement }): void {
		if (event instanceof InputEvent && event.isComposing) return;
		const text = event.currentTarget.value;
		event.currentTarget.value = '';
		if (text.length > 0) sendShellInputCommand(run.id, text);
	}
</script>

<section
	class="border-surface-50-border border-t-[0.5px] text-xs"
	aria-label={`Command ${title}`}
	data-testid="shell-run"
	data-state={run.state}
>
	<div class="flex h-8 items-center gap-2 pr-1.5 pl-3">
		<span class="text-fg-tertiary grid size-4 shrink-0 place-items-center" aria-hidden="true">
			<Icon name="terminal" size={13} />
		</span>
		<span class="text-3xs text-fg-tertiary min-w-0 flex-1 truncate">
			{#if !running}
				Output
			{:else if typing}
				Typing into the command · Control-C stops it
			{:else}
				Click the output to type into it
			{/if}
		</span>
		<span
			class={[
				'text-2xs shrink-0 font-mono tabular-nums',
				failed ? 'text-error-content' : 'text-fg-tertiary',
			]}
			data-testid="shell-run-status"
		>
			{status}
		</span>
		{#if running}
			<Tooltip content="Stop · sends Control-C" placement="top">
				<IconButton
					variant="ghost"
					size="xs"
					class="text-fg-tertiary"
					ariaLabel="Stop command"
					onclick={() => stopShellRunCommand(run.id)}
				>
					<Icon name="stop" size={12} />
				</IconButton>
			</Tooltip>
		{:else}
			<Tooltip content="Clear output" placement="top">
				<IconButton
					variant="ghost"
					size="xs"
					class="text-fg-tertiary"
					ariaLabel="Clear output"
					onclick={() => dismissShellRunCommand(run.id)}
				>
					<Icon name="close" size={12} />
				</IconButton>
			</Tooltip>
		{/if}
		<IconButton
			variant="ghost"
			size="xs"
			class="text-fg-tertiary"
			ariaLabel={expanded ? 'Hide output' : 'Show output'}
			ariaExpanded={expanded}
			onclick={() => (expanded = !expanded)}
		>
			<Icon
				name="chevron-down"
				size={12}
				class={['transition-transform', expanded && 'rotate-180']}
			/>
		</IconButton>
	</div>
	{#if expanded}
		<div class="relative px-3 pb-3">
			<div
				{@attach followsOutput}
				{@attach running && typesOnClick}
				class={[
					'bg-surface-root border-border-default text-fg-secondary text-2xs max-h-64 overflow-auto rounded-lg border-[0.5px] px-2.5 py-2 font-mono leading-snug break-words whitespace-pre-wrap select-text',
					running && 'cursor-text',
					typing && 'ring-border-default/50 ring-2',
				]}
				role="log"
				aria-label="Output"
				data-testid="shell-run-output"
				onscroll={onScroll}
			>
				{run.output}{#if running}<span
						class={['shell-run-caret', typing && 'shell-run-caret-typing']}
						aria-hidden="true"
					></span>{:else if run.output.length === 0}<span class="text-fg-tertiary">
						No output
					</span>{/if}
			</div>
			{#if running}
				<!-- eslint-disable-next-line @malini/desktop/no-raw-form-control -- an invisible keystroke sink, like a terminal's: what you type shows in the output above, never in a field. -->
				<textarea
					bind:this={input}
					class="shell-run-input"
					aria-label={`Type into ${title}`}
					autocomplete="off"
					autocapitalize="off"
					spellcheck="false"
					onkeydown={onKeydown}
					oninput={onInput}
					onfocus={() => (typing = true)}
					onblur={() => (typing = false)}></textarea>
			{/if}
		</div>
	{/if}
</section>

<style>
	.shell-run-caret {
		display: inline-block;
		width: 0.55em;
		height: 1.1em;
		vertical-align: text-bottom;
		background: var(--color-fg-tertiary);
		opacity: 0.4;
	}

	.shell-run-caret-typing {
		background: var(--color-fg-default);
		opacity: 1;
	}

	.shell-run-input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
		resize: none;
	}
</style>
