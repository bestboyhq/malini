<script lang="ts">
	import type { ClassValue } from 'svelte/elements';
	import { Button } from '$hyper-ui/components/button';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { drainPromptQueueCommand } from '$lib/chat/application/commands/drain-prompt-queue.command';
	import { withdrawHeldPromptCommand } from '$lib/chat/application/commands/withdraw-held-prompt.command';
	import type { QueuedPrompt } from '$lib/chat/domain/queued-prompt';
	import {
		cancelChatGptSignInCommand,
		cancelClaudeSignInCommand,
		chatGptSignInQuery,
		claudeSignInQuery,
		modelAccessQuery,
		providerKeyUrl,
		saveProviderKeyCommand,
		signInToChatGptCommand,
		signInToClaudeCommand,
	} from '$shared/providers/providers.api';
	import { PROVIDER_SETTINGS_HREF } from '$shared/router/routes-hrefs';
	import { focusIsUnclaimed, overlayIsOpen } from '$shared/shell/unclaimed-focus';

	interface Props {
		workstreamId: string;
		held: QueuedPrompt;
		class?: ClassValue;
	}

	let { workstreamId, held, class: className }: Props = $props();

	let draft = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let strip = $state<HTMLElement | null>(null);
	let keyInput = $state<HTMLInputElement | null>(null);
	let primary = $state<HTMLAnchorElement | HTMLButtonElement | null>(null);

	const access = $derived(modelAccessQuery.data(held));
	const waitingForClaude = $derived(claudeSignInQuery.data !== 'idle');
	const waitingForChatGpt = $derived(chatGptSignInQuery.waiting);
	const waiting = $derived(
		(access.kind === 'claude-signed-out' && (waitingForClaude || busy)) ||
			(access.kind === 'chatgpt-signed-out' && waitingForChatGpt),
	);
	const hasDraft = $derived(draft.trim().length > 0);
	const keyUrl = $derived(access.kind === 'needs-key' ? providerKeyUrl(access.providerId) : null);

	$effect(() => {
		const target = access.kind === 'needs-key' ? keyInput : primary;
		if (target && focusIsFree()) queueMicrotask(() => target.focus());
	});

	function focusIsFree(): boolean {
		const active = document.activeElement;
		if (focusIsUnclaimed()) return true;
		return active?.closest('[data-testid="chat-composer-input"]')?.textContent?.trim() === '';
	}

	async function connect(attempt: () => Promise<boolean>): Promise<void> {
		if (busy) return;
		busy = true;
		error = null;
		try {
			if (await attempt()) drainPromptQueueCommand(workstreamId);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}

	function connectWithKey(providerId: string): void {
		if (!hasDraft) return;
		void connect(async () => {
			await saveProviderKeyCommand(providerId, draft);
			return true;
		});
	}

	function cancel(): void {
		if (waitingForClaude) cancelClaudeSignInCommand();
		if (waitingForChatGpt) cancelChatGptSignInCommand();
		withdrawHeldPromptCommand(workstreamId, held);
	}

	function cancelSignIn(): void {
		if (access.kind === 'claude-signed-out') cancelClaudeSignInCommand();
		else cancelChatGptSignInCommand();
	}

	function onWindowKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape' || event.defaultPrevented || overlayIsOpen()) return;
		const active = document.activeElement;
		if (active && active !== document.body && !strip?.contains(active)) return;
		event.preventDefault();
		cancel();
	}

	function onKeyInputKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.isComposing) return;
		event.preventDefault();
		if (access.kind === 'needs-key') connectWithKey(access.providerId);
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div
	class={['w-full px-5', className]}
	data-testid="provider-connect-strip"
	data-access={access.kind}
>
	<div
		bind:this={strip}
		class="border-surface-50-border flex h-9 items-center gap-2 rounded-b-xl border-x-[0.5px] border-b-[0.5px] pr-1.5 pl-3 text-xs"
	>
		{#if access.kind === 'needs-key'}
			<span class="text-fg-secondary flex shrink-0 items-center">
				<Icon name="key" size={12} />
			</span>
			<TextInput
				type="password"
				bare
				autocomplete="off"
				placeholder={`Paste your ${access.providerName} API key to run this`}
				ariaLabel={`${access.providerName} API key`}
				class="min-w-0 flex-1"
				inputClass="text-fg-default text-xs"
				disabled={busy}
				bind:value={draft}
				bind:element={keyInput}
				onkeydown={onKeyInputKeydown}
				data-testid="provider-connect-key"
			/>
			{#if keyUrl}
				<a
					href={keyUrl}
					target="_blank"
					rel="noreferrer"
					class="text-fg-tertiary hover:text-fg-secondary shrink-0 underline-offset-2 hover:underline"
				>
					Get a key
				</a>
			{/if}
		{:else if waiting}
			<span class="text-fg-secondary flex min-w-0 items-center gap-1.5" role="status">
				<BusyIcon size={12} />
				<span class="truncate">Continue in your browser</span>
			</span>
		{:else}
			<span class="text-fg-secondary flex min-w-0 items-center gap-1.5">
				<Icon name={access.kind === 'claude-code-missing' ? 'warning' : 'lock'} size={12} />
				<span class="truncate">
					{#if access.kind === 'claude-signed-out'}
						Sign in to Claude Code to run this
					{:else if access.kind === 'chatgpt-signed-out'}
						Sign in to ChatGPT to run this
					{:else if access.kind === 'chatgpt-model-missing'}
						Not on your ChatGPT plan
					{:else if access.kind === 'claude-code-missing'}
						Claude Code is not on this Mac
					{/if}
				</span>
			</span>
		{/if}

		<div class="ml-auto flex shrink-0 items-center gap-1">
			{#if waiting}
				<Button variant="ghost" size="sm" onclick={cancelSignIn}>Cancel sign-in</Button>
			{:else}
				<Button variant="ghost" size="sm" onclick={cancel} data-testid="provider-connect-cancel">
					Cancel
				</Button>
				{#if access.kind === 'needs-key'}
					{@const providerId = access.providerId}
					<Button
						variant="primary"
						size="sm"
						disabled={!hasDraft}
						loading={busy}
						onclick={() => connectWithKey(providerId)}
						data-testid="provider-connect-submit"
					>
						Connect
					</Button>
				{:else if access.kind === 'claude-signed-out'}
					<Button
						variant="primary"
						size="sm"
						bind:element={primary}
						onclick={() => void connect(signInToClaudeCommand)}
						data-testid="provider-connect-sign-in"
					>
						Sign in with Claude
					</Button>
				{:else if access.kind === 'chatgpt-signed-out'}
					<Button
						variant="primary"
						size="sm"
						bind:element={primary}
						onclick={() => void connect(signInToChatGptCommand)}
						data-testid="provider-connect-sign-in"
					>
						Continue with ChatGPT
					</Button>
				{:else if access.kind === 'claude-code-missing'}
					<Button
						variant="primary"
						size="sm"
						href={PROVIDER_SETTINGS_HREF}
						bind:element={primary}
						data-testid="provider-connect-setup"
					>
						Set up
					</Button>
				{/if}
			{/if}
		</div>
	</div>

	{#if error}
		<p
			class="text-error-content mt-1.5 px-1 text-xs"
			role="alert"
			data-testid="provider-connect-error"
		>
			{error}
		</p>
	{/if}
</div>
