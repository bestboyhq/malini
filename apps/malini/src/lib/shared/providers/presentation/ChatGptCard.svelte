<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { BusyIcon, Icon } from '$hyper-ui/icons';
	import { cancelChatGptSignInCommand } from '$shared/providers/application/commands/cancel-chatgpt-sign-in.command';
	import { signInToChatGptCommand } from '$shared/providers/application/commands/sign-in-to-chatgpt.command';
	import { signOutOfChatGptCommand } from '$shared/providers/application/commands/sign-out-of-chatgpt.command';
	import { chatGptSignInQuery } from '$shared/providers/application/queries/chatgpt-sign-in.query.svelte';
	import { CHATGPT_USAGE_URL, type ProviderGroup } from '$shared/providers/domain/provider';
	import ProviderIcon from './ProviderIcon.svelte';

	interface Props {
		provider: ProviderGroup;
	}

	let { provider }: Props = $props();

	let busy = $state(false);
	let error = $state<string | null>(null);

	const account = $derived(provider.account);
	const waiting = $derived(chatGptSignInQuery.waiting);

	async function run(action: () => Promise<unknown>): Promise<void> {
		if (busy) return;
		busy = true;
		error = null;
		try {
			await action();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}
</script>

<div
	class="border-surface-50-border bg-surface-50 rounded-xl border-[0.5px] px-4 py-3.5"
	data-testid={`provider-${provider.id}`}
	data-signed-in={account !== null}
>
	<div class="flex items-center gap-3">
		<div
			class="bg-surface-150 text-fg-default grid h-9 w-9 shrink-0 place-items-center rounded-xl"
			aria-hidden="true"
		>
			<ProviderIcon providerId={provider.id} size={16} />
		</div>
		<div class="min-w-0 flex-1">
			<h3 class="text-fg-default text-sm font-medium">{provider.name}</h3>
			<p class="text-fg-tertiary truncate text-xs leading-5">
				{#if account}
					Using ChatGPT plan{#if account.email}{' · '}<SensitiveText text={account.email} />{/if}
				{:else}
					Sign in to run GPT models on your ChatGPT plan.
				{/if}
			</p>
		</div>
		{#if account}
			<span class="text-success-content flex shrink-0 items-center gap-1 text-xs font-medium">
				<Icon name="check" size={14} />
				Ready
			</span>
		{/if}
	</div>

	<div class="mt-3 grid gap-2">
		{#if account}
			{#if account.usageLimitReachedAt}
				<p class="text-warning-content text-xs leading-5" role="status">
					You hit your ChatGPT usage limit.
				</p>
			{/if}
			<div class="flex items-center gap-2">
				<Button href={CHATGPT_USAGE_URL} variant="secondary" size="sm" class="shrink-0">
					Manage usage
				</Button>
				<Button
					variant="ghost"
					size="sm"
					class="shrink-0"
					ariaLabel="Sign out of ChatGPT"
					disabled={busy}
					onclick={() => void run(signOutOfChatGptCommand)}
				>
					Sign out
				</Button>
			</div>
		{:else if waiting}
			<div class="flex min-h-8 items-center gap-2 text-xs">
				<BusyIcon size={14} />
				<p class="text-fg-tertiary min-w-0 flex-1 leading-5" role="status">
					Continue in your browser.
				</p>
				<Button
					variant="secondary"
					size="sm"
					class="shrink-0"
					ariaLabel="Cancel signing in to ChatGPT"
					onclick={cancelChatGptSignInCommand}
				>
					Cancel
				</Button>
			</div>
		{:else}
			<div>
				<Button
					variant="primary"
					size="sm"
					disabled={busy}
					onclick={() => void run(signInToChatGptCommand)}
				>
					Continue with ChatGPT
				</Button>
			</div>
		{/if}
		<div>
			<p class="text-fg-tertiary text-xs leading-5">
				{provider.models.length}
				{provider.models.length === 1 ? 'model' : 'models'}
			</p>
			<ul
				class="text-fg-secondary flex flex-wrap gap-x-2.5 gap-y-0.5 text-xs leading-5"
				aria-label={`${provider.name} models`}
			>
				{#each provider.models as model (model.id)}
					<li>{model.label}</li>
				{/each}
			</ul>
		</div>
		{#if error}
			<p class="text-error-content text-xs leading-5" role="alert">{error}</p>
		{/if}
	</div>
</div>
