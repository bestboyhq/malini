<script lang="ts">
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { onMount } from 'svelte';
	import { CLAUDE_SETUP_COMMANDS } from '$contract/agent';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { LoadingCircle } from '$hyper-ui/components/loading-circle';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { ClaudeIcon, Icon } from '$hyper-ui/icons';
	import { setupStepFor, type ClaudeCodeStatus } from '$shared/providers/domain/claude-code-status';
	import { copyClaudeSetupCommandCommand } from '$shared/providers/application/commands/copy-claude-setup-command.command';
	import { loadProviderCapabilitiesCommand } from '$shared/providers/application/commands/load-provider-capabilities.command';
	import { runClaudeSetupCommand } from '$shared/providers/application/commands/run-claude-setup.command';
	import { watchClaudeCodeSetupHook } from '$shared/providers/application/hooks/watch-claude-code-setup.hook';
	import { claudeCodeStatusQuery } from '$shared/providers/application/queries/claude-code-status.query.svelte';

	interface Props {
		step?: number;
	}

	let { step }: Props = $props();
	let copied = $state(false);
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;

	const status = $derived(claudeCodeStatusQuery.data);
	const setupStep = $derived(setupStepFor(status));
	const command = $derived(setupStep ? CLAUDE_SETUP_COMMANDS[setupStep] : null);
	const detail = $derived(statusDetail(status));

	function statusDetail(current: ClaudeCodeStatus): string {
		switch (current.kind) {
			case 'checking':
				return 'Looking for Claude Code on this Mac…';
			case 'missing':
				return 'malini runs the Claude Code installed on this Mac, signed in with your own Claude plan. Install it to start.';
			case 'signed-out':
				return `Claude Code${current.version ? ` ${current.version}` : ''} is installed. Sign in with your Claude account to start.`;
			case 'ready':
				return [
					current.account?.email ? `Signed in as ${current.account.email}` : 'Signed in',
					current.account?.plan,
					current.version ? `v${current.version}` : null,
				]
					.filter(Boolean)
					.join(' · ');
			case 'unknown':
				return `Could not check Claude Code. ${current.message}`;
		}
	}

	function onCopy(): void {
		if (!setupStep) return;
		copyClaudeSetupCommandCommand(setupStep);
		copied = true;
		clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copied = false), 1_500);
	}

	onMount(() => {
		const stopWatching = watchClaudeCodeSetupHook();
		return () => {
			stopWatching();
			clearTimeout(copiedTimer);
		};
	});
</script>

<div
	class="border-surface-50-border bg-surface-50 rounded-2xl border-[0.5px] px-4 py-3.5"
	data-testid="claude-code-setup"
	data-claude-code-status={status.kind}
>
	<div class="flex items-center gap-3">
		<div
			class="bg-surface-150 text-fg-default grid h-9 w-9 shrink-0 place-items-center rounded-xl"
			aria-hidden="true"
		>
			{#if step !== undefined && status.kind !== 'ready'}
				<span class="text-fg-secondary text-sm font-medium tabular-nums">{step}</span>
			{:else}
				<ClaudeIcon size={16} />
			{/if}
		</div>
		<div class="min-w-0 flex-1" role="status">
			<h3 class="text-fg-default text-sm font-medium">Claude Code</h3>
			<p class="text-fg-tertiary text-xs leading-5" data-testid="claude-code-detail">
				<SensitiveText text={detail} />
			</p>
		</div>
		{#if status.kind === 'checking'}
			<LoadingCircle size={16} />
		{:else if status.kind === 'ready'}
			<span class="text-success-content flex shrink-0 items-center gap-1 text-xs font-medium">
				<Icon name="check" size={14} />
				Ready
			</span>
		{:else if setupStep}
			<Button
				variant="primary"
				size="sm"
				class="shrink-0"
				ariaLabel={setupStep === 'install'
					? 'Install Claude Code in Terminal'
					: 'Sign in to Claude Code in Terminal'}
				data-testid="claude-code-setup-action"
				onclick={() => runClaudeSetupCommand(setupStep)}
			>
				{setupStep === 'install' ? 'Install' : 'Sign in'}
			</Button>
		{:else}
			<Button
				variant="secondary"
				size="sm"
				class="shrink-0"
				ariaLabel="Check Claude Code again"
				onclick={() => loadProviderCapabilitiesCommand('force')}
			>
				{#snippet leading()}
					<Icon name="refresh" size={14} />
				{/snippet}
				Check again
			</Button>
		{/if}
	</div>

	{#if command}
		<div
			class="border-surface-150-border bg-surface-150 mt-3 flex items-center gap-2 rounded-lg border-[0.5px] py-1 pr-1 pl-3"
		>
			<code class="text-fg-secondary min-w-0 flex-1 truncate font-mono text-xs">
				<span class="text-fg-tertiary select-none">$</span>
				{command}
			</code>
			<Tooltip content={copied ? 'Copied' : 'Copy command'} placement="top">
				<IconButton
					variant="ghost"
					size="sm"
					ariaLabel="Copy command"
					class="text-fg-tertiary"
					onclick={onCopy}
				>
					{#if copied}
						<Icon name="check" size={14} />
					{:else}
						<Icon name="copy" size={14} />
					{/if}
				</IconButton>
			</Tooltip>
		</div>
		<p class="text-fg-tertiary mt-2 text-xs leading-5">
			{setupStep === 'install' ? 'Install' : 'Sign in'} opens Terminal and runs this command. malini notices
			when it finishes.
		</p>
	{/if}
</div>
