<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { BusyIcon } from '$hyper-ui/icons';
	import {
		cancelChatGptSignInCommand,
		cancelClaudeSignInCommand,
		chatGptSignInQuery,
		claudeSignInQuery,
		providerKeyUrl,
		saveProviderKeyCommand,
		signInToChatGptCommand,
		signInToClaudeCommand,
		type ModelAccess,
	} from '$shared/providers/providers.api';
	import { PROVIDER_SETTINGS_HREF } from '$shared/router/routes-hrefs';

	interface Props {
		access: ModelAccess;
		modelLabel: string;
		prompt: string;
		onconnected: () => void;
		oncancel: () => void;
	}

	let { access, modelLabel, prompt, onconnected, oncancel }: Props = $props();

	let draft = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let keyInput = $state<HTMLInputElement | null>(null);

	const signIn = $derived(claudeSignInQuery.data);
	const waitingForSignIn = $derived(signIn !== 'idle' || busy);
	const waitingForChatGpt = $derived(chatGptSignInQuery.waiting);
	const hasDraft = $derived(draft.trim().length > 0);
	const keyUrl = $derived(access.kind === 'needs-key' ? providerKeyUrl(access.providerId) : null);

	$effect(() => {
		if (access.kind !== 'needs-key') return;
		queueMicrotask(() => keyInput?.focus());
	});

	async function connectWithKey(providerId: string): Promise<void> {
		if (!hasDraft || busy) return;
		busy = true;
		error = null;
		try {
			await saveProviderKeyCommand(providerId, draft);
			onconnected();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}

	async function connectWith(signInCommand: () => Promise<boolean>): Promise<void> {
		if (busy) return;
		busy = true;
		error = null;
		try {
			if (await signInCommand()) onconnected();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}

	function cancel(): void {
		if (signIn !== 'idle') cancelClaudeSignInCommand();
		if (waitingForChatGpt) cancelChatGptSignInCommand();
		oncancel();
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
		event.preventDefault();
		if (access.kind === 'needs-key') void connectWithKey(access.providerId);
	}
</script>

<div
	class="border-surface-elevated-border bg-surface-elevated mb-2.5 rounded-xl border-[0.5px] p-3.5 shadow-lg"
	data-testid="provider-connect-card"
	data-access={access.kind}
>
	<p
		class="bg-surface-50 text-fg-secondary mb-3 truncate rounded-lg px-2.5 py-2 text-xs leading-4"
		data-testid="provider-connect-prompt"
	>
		{prompt}
	</p>

	{#if access.kind === 'needs-key'}
		<h3 class="text-fg-default text-[13px] leading-5 font-medium">Send with {modelLabel}</h3>
		<p class="text-fg-tertiary mt-0.5 mb-3 text-xs leading-5">
			Paste your {access.providerName} API key to run this message. It stays in your keychain.
		</p>
		<TextInput
			type="password"
			size="sm"
			autocomplete="off"
			placeholder={`Paste your ${access.providerName} API key`}
			ariaLabel={`${access.providerName} API key`}
			bind:value={draft}
			bind:element={keyInput}
			onkeydown={onKeydown}
			data-testid="provider-connect-key"
		/>
		{#if keyUrl}
			<a
				href={keyUrl}
				target="_blank"
				rel="noreferrer"
				class="text-fg-tertiary hover:text-fg-secondary mt-1 inline-block text-xs underline-offset-2 hover:underline"
			>
				Get a key
			</a>
		{/if}
		<p class="text-fg-tertiary text-2xs mt-1 leading-4">
			Requests go directly to {access.providerName}.
		</p>
	{:else if access.kind === 'claude-signed-out'}
		<h3 class="text-fg-default text-[13px] leading-5 font-medium">Send with {modelLabel}</h3>
		<p class="text-fg-tertiary mt-0.5 mb-3 text-xs leading-5">
			Sign in to Claude Code to run this message. It opens your browser.
		</p>
		{#if waitingForSignIn}
			<div
				class="text-fg-tertiary flex items-center gap-2 text-xs leading-5"
				role="status"
				data-testid="provider-connect-waiting"
			>
				<BusyIcon size={14} />
				Continue in your browser.
			</div>
		{/if}
	{:else if access.kind === 'chatgpt-signed-out'}
		<h3 class="text-fg-default text-[13px] leading-5 font-medium">Send with {modelLabel}</h3>
		<p class="text-fg-tertiary mt-0.5 mb-3 text-xs leading-5">
			Sign in to ChatGPT to run this message on your plan. It opens your browser.
		</p>
		{#if waitingForChatGpt}
			<div
				class="text-fg-tertiary flex items-center gap-2 text-xs leading-5"
				role="status"
				data-testid="provider-connect-waiting"
			>
				<BusyIcon size={14} />
				Continue in your browser.
			</div>
		{/if}
	{:else if access.kind === 'chatgpt-model-missing'}
		<h3 class="text-fg-default text-[13px] leading-5 font-medium">Send with {modelLabel}</h3>
		<p class="text-fg-tertiary mt-0.5 mb-3 text-xs leading-5">
			Your ChatGPT plan does not include this model.
		</p>
	{:else if access.kind === 'claude-code-missing'}
		<h3 class="text-fg-default text-[13px] leading-5 font-medium">Send with {modelLabel}</h3>
		<p class="text-fg-tertiary mt-0.5 mb-3 text-xs leading-5">
			Claude Code is not installed on this Mac.
		</p>
	{/if}

	{#if error}
		<p
			class="text-error-content mt-2 text-xs leading-5"
			role="alert"
			data-testid="provider-connect-error"
		>
			{error}
		</p>
	{/if}

	<div class="mt-3 flex items-center justify-end gap-2">
		<Button
			variant="ghost"
			size="sm"
			onclick={cancel}
			ariaLabel="Cancel connecting"
			data-testid="provider-connect-cancel"
		>
			Cancel
		</Button>
		{#if access.kind === 'needs-key'}
			<Button
				variant="primary"
				size="sm"
				disabled={!hasDraft || busy}
				ariaBusy={busy}
				onclick={() => void connectWithKey(access.providerId)}
				data-testid="provider-connect-submit"
			>
				Connect and send
			</Button>
		{:else if access.kind === 'claude-signed-out'}
			{#if waitingForSignIn}
				<Button
					variant="secondary"
					size="sm"
					ariaLabel="Cancel signing in to Claude Code"
					onclick={cancelClaudeSignInCommand}
				>
					Cancel sign-in
				</Button>
			{:else}
				<Button
					variant="primary"
					size="sm"
					ariaBusy={busy}
					onclick={() => void connectWith(signInToClaudeCommand)}
					data-testid="provider-connect-sign-in"
				>
					Sign in with Claude
				</Button>
			{/if}
		{:else if access.kind === 'chatgpt-signed-out'}
			{#if waitingForChatGpt}
				<Button
					variant="secondary"
					size="sm"
					ariaLabel="Cancel signing in to ChatGPT"
					onclick={cancelChatGptSignInCommand}
				>
					Cancel sign-in
				</Button>
			{:else}
				<Button
					variant="primary"
					size="sm"
					ariaBusy={busy}
					onclick={() => void connectWith(signInToChatGptCommand)}
					data-testid="provider-connect-sign-in"
				>
					Continue with ChatGPT
				</Button>
			{/if}
		{:else if access.kind === 'claude-code-missing'}
			<Button
				href={PROVIDER_SETTINGS_HREF}
				variant="primary"
				size="sm"
				onclick={oncancel}
				data-testid="provider-connect-setup"
			>
				Set up
			</Button>
		{/if}
	</div>
</div>
