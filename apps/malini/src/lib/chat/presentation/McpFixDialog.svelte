<script lang="ts">
	import { onMount } from 'svelte';
	import { mcpOriginLabel, type McpFixStep } from '$lib/chat/domain/mcp-server';
	import { closeMcpFixQueueCommand } from '$lib/chat/application/commands/close-mcp-fix-queue.command';
	import { finishMcpFixStepCommand } from '$lib/chat/application/commands/finish-mcp-fix-step.command';
	import { openClaudeAiConnectorsCommand } from '$lib/chat/application/commands/open-claude-ai-connectors.command';
	import { startMcpFixStepCommand } from '$lib/chat/application/commands/start-mcp-fix-step.command';
	import { watchMcpServersHook } from '$lib/chat/application/hooks/watch-mcp-servers.hook';
	import { mcpFixQueueQuery } from '$lib/chat/application/queries/mcp-fix-queue.query.svelte';
	import { Button } from '$hyper-ui/components/button';
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Modal } from '$hyper-ui/components/modal';
	import { ScrollableDiv } from '$hyper-ui/components/scrollable-div';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { sanitizeFailureDetail } from '$shared/errors/failure-copy';

	const queue = $derived(mcpFixQueueQuery.data);
	const steps = $derived(queue?.steps ?? []);
	const index = $derived(queue?.index ?? 0);
	const current = $derived(steps[index] ?? null);
	const finished = $derived(
		steps.filter((step) => step.outcome !== 'to-do' && step.outcome !== 'working'),
	);
	const fixed = $derived(steps.filter((step) => step.outcome === 'fixed').length);
	const skipped = $derived(steps.filter((step) => step.outcome === 'skipped').length);
	const off = $derived(steps.filter((step) => step.outcome === 'off').length);
	const toGo = $derived(steps.length - finished.length);
	const error = $derived(current?.error ? sanitizeFailureDetail(current.error) : null);

	onMount(watchMcpServersHook);

	function explanation(step: McpFixStep): string {
		const name = step.server.displayName;
		if (step.fix === 'sign-in') {
			return step.outcome === 'working'
				? `Your browser opened the ${name} sign-in page. Approve access there and this moves on by itself.`
				: `${name} needs you to sign in. Malini opens its sign-in page in your browser.`;
		}
		if (step.fix === 'reconnect-on-claude-ai') {
			return `claude.ai holds the sign-in for this connector, so reconnect ${name} on claude.ai, then check again here.`;
		}
		return `${name} did not connect. Malini asks Claude Code to connect it again.`;
	}

	function waitingLabel(step: McpFixStep): string {
		return step.fix === 'sign-in'
			? `Waiting for ${step.server.displayName}`
			: `Checking ${step.server.displayName}`;
	}

	function summary(): string {
		return [
			fixed > 0 && `${fixed} fixed`,
			skipped > 0 && `${skipped} skipped`,
			off > 0 && `${off} turned off`,
			toGo > 0 && `${toGo} to go`,
		]
			.filter(Boolean)
			.join(' · ');
	}
</script>

<Modal
	open={queue !== null}
	ariaLabel="Fix MCP servers"
	onclose={closeMcpFixQueueCommand}
	class="rounded-[20px]"
	contentClass="flex h-[min(520px,calc(100vh-6rem))] w-[min(660px,calc(100vw-4rem))] flex-col"
>
	{#snippet children(dismiss)}
		<header class="flex items-center gap-3 pt-4 pr-4 pb-3 pl-5">
			<h2 class="text-fg-default min-w-0 flex-1 truncate text-[15px] font-semibold">
				Fix MCP servers
			</h2>
			{#if current}
				<span class="text-fg-tertiary text-xs tabular-nums" data-testid="mcp-fix-position">
					{index + 1} of {steps.length}
				</span>
			{/if}
			<IconButton variant="ghost" size="sm" ariaLabel="Close" onclick={dismiss}>
				<Icon name="close" size={14} />
			</IconButton>
		</header>
		<div
			class="bg-surface-elevated-selected mx-5 h-[3px] shrink-0 overflow-hidden rounded-full"
			role="progressbar"
			aria-label="MCP servers done"
			aria-valuemin="0"
			aria-valuemax={steps.length}
			aria-valuenow={finished.length}
		>
			<div
				class="bg-primary h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none"
				style:width={`${steps.length === 0 ? 0 : (finished.length / steps.length) * 100}%`}
			></div>
		</div>

		<div class="flex min-h-0 flex-1 gap-3 px-3 pt-3.5 pb-3">
			<ScrollableDiv class="w-52 shrink-0" ariaLabel="MCP servers to fix">
				<ol class="space-y-px" aria-label="MCP servers to fix">
					{#each steps as step, position (step.server.name)}
						<li
							class={[
								'flex h-7 min-w-0 items-center gap-2 rounded-md px-2 text-xs',
								position === index && current
									? 'bg-surface-elevated-selected text-fg-default'
									: step.outcome === 'to-do'
										? 'text-fg-secondary'
										: 'text-fg-tertiary',
							]}
							aria-current={position === index && current ? 'step' : undefined}
							data-mcp-fix-outcome={step.outcome}
						>
							{#if step.outcome === 'fixed'}
								<Icon name="check" size={14} class="text-success-content shrink-0" />
							{:else if step.outcome === 'working'}
								<BusyIcon size={14} />
							{:else if step.outcome === 'skipped'}
								<Icon name="chevrons-right" size={14} class="shrink-0" />
							{:else if step.outcome === 'off'}
								<Icon name="circle-slash" size={14} class="shrink-0" />
							{:else if step.error}
								<Icon name="alert" size={14} class="text-error-content shrink-0" />
							{:else}
								<Icon name="circle" size={14} class="shrink-0" />
							{/if}
							<span class="min-w-0 flex-1 truncate">
								{step.server.displayName}
								{#if step.outcome === 'skipped' || step.outcome === 'off'}
									<span class="sr-only">, {step.outcome === 'off' ? 'turned off' : 'skipped'}</span>
								{/if}
							</span>
						</li>
					{/each}
				</ol>
			</ScrollableDiv>

			<section
				class="bg-surface-root border-border-default flex min-w-0 flex-1 flex-col justify-between rounded-[14px] border-[0.5px] px-[18px] pt-[18px] pb-3.5"
				aria-label={current ? current.server.displayName : 'Done'}
			>
				{#if current}
					<div class="min-w-0">
						<p class="text-fg-tertiary text-2xs">{mcpOriginLabel(current.server.origin)}</p>
						<h3 class="text-fg-default mt-1.5 truncate text-xl font-semibold tracking-tight">
							{current.server.displayName}
						</h3>
						<p class="text-fg-secondary mt-2 text-[12.5px] leading-[19px]">
							{explanation(current)}
						</p>
						{#if current.outcome === 'working'}
							<div
								class="bg-surface-elevated text-fg-secondary mt-[18px] flex items-center gap-2.5 rounded-[10px] px-3 py-2.5"
								role="status"
							>
								<BusyIcon size={16} />
								<div class="min-w-0">
									<p class="text-fg-default text-xs font-medium">{waitingLabel(current)}</p>
									{#if current.fix === 'sign-in'}
										<p class="text-fg-tertiary text-2xs mt-px">
											Once it connects, every open chat picks it up.
										</p>
									{/if}
								</div>
							</div>
						{:else if error}
							<div
								class="bg-surface-elevated mt-[18px] flex items-start gap-2.5 rounded-[10px] px-3 py-2.5"
								role="alert"
							>
								<Icon name="alert" size={16} class="text-error-content mt-px shrink-0" />
								<p class="text-fg-secondary min-w-0 text-xs leading-[18px] break-words">{error}</p>
							</div>
						{/if}
					</div>
					<div class="flex items-center gap-2">
						<Button
							variant="ghost"
							size="sm"
							ariaLabel={`Turn off ${current.server.displayName}`}
							onclick={() => finishMcpFixStepCommand('off')}
						>
							Turn off
						</Button>
						<span class="flex-1"></span>
						{#if current.fix === 'reconnect-on-claude-ai'}
							<Button variant="secondary" size="sm" onclick={openClaudeAiConnectorsCommand}>
								Open claude.ai
								{#snippet trailing()}
									<Icon name="external-link" size={12} />
								{/snippet}
							</Button>
						{/if}
						<Button
							variant="secondary"
							size="sm"
							disabled={current.outcome === 'working' && current.fix !== 'sign-in'}
							onclick={startMcpFixStepCommand}
						>
							{current.fix === 'sign-in'
								? current.outcome === 'working'
									? 'Open the page again'
									: 'Sign in'
								: current.fix === 'reconnect-on-claude-ai'
									? 'Check again'
									: 'Try again'}
						</Button>
						<Button
							variant="secondary"
							size="sm"
							onclick={() => finishMcpFixStepCommand('skipped')}
						>
							Skip
						</Button>
					</div>
				{:else}
					<div class="min-w-0">
						<h3 class="text-fg-default truncate text-xl font-semibold tracking-tight">
							{fixed === steps.length ? 'All fixed' : 'Done'}
						</h3>
						<p class="text-fg-secondary mt-2 text-[12.5px] leading-[19px]">
							{fixed === steps.length
								? 'Every server you went through connects now, in every open chat.'
								: 'Skipped servers stay in the MCPs list, so you can fix them later.'}
						</p>
					</div>
					<div class="flex justify-end">
						<Button variant="primary" size="sm" onclick={dismiss}>Close</Button>
					</div>
				{/if}
			</section>
		</div>
		<p
			class="text-fg-tertiary text-2xs flex items-center gap-1.5 px-5 pb-3.5"
			data-testid="mcp-fix-summary"
		>
			{summary()}
		</p>
	{/snippet}
</Modal>
