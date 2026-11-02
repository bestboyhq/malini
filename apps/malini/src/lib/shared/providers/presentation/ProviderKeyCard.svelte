<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { TextInput } from '$hyper-ui/components/text-input';
	import { Icon } from '$hyper-ui/icons';
	import { deleteProviderKeyCommand } from '$shared/providers/application/commands/delete-provider-key.command';
	import { saveProviderKeyCommand } from '$shared/providers/application/commands/save-provider-key.command';
	import type { AgentModelInfo } from '$shared/providers/domain/model-catalog';

	interface Props {
		providerId: string;
		name: string;
		baseUrl: string;
		models: readonly AgentModelInfo[];
		keySaved: boolean;
	}

	let { providerId, name, baseUrl, models, keySaved }: Props = $props();

	let draft = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	const hasDraft = $derived(draft.trim().length > 0);

	async function save(): Promise<void> {
		if (!hasDraft || busy) return;
		busy = true;
		error = null;
		try {
			await saveProviderKeyCommand(providerId, draft);
			draft = '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}

	async function remove(): Promise<void> {
		if (busy) return;
		busy = true;
		error = null;
		try {
			await deleteProviderKeyCommand(providerId);
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}
</script>

<div
	class="border-surface-50-border bg-surface-50 rounded-xl border-[0.5px] px-4 py-3.5"
	data-testid={`provider-${providerId}`}
	data-key-saved={keySaved}
>
	<div class="flex items-center gap-3">
		<div
			class="bg-surface-150 text-fg-default grid h-9 w-9 shrink-0 place-items-center rounded-xl"
			aria-hidden="true"
		>
			<Icon name="bolt" size={16} />
		</div>
		<div class="min-w-0 flex-1">
			<h3 class="text-fg-default text-sm font-medium">{name}</h3>
			<p class="text-fg-tertiary text-xs leading-5">
				{keySaved ? 'API key saved on this Mac.' : `Add an API key to use ${name} models.`}
			</p>
		</div>
		{#if keySaved}
			<span class="text-success-content flex shrink-0 items-center gap-1 text-xs font-medium">
				<Icon name="check" size={14} />
				Ready
			</span>
		{/if}
	</div>

	<div class="mt-3 grid gap-2">
		<div class="flex items-center gap-2">
			<TextInput
				type="password"
				size="sm"
				autocomplete="off"
				placeholder={keySaved ? 'Paste a new key to replace it' : 'Paste your API key'}
				ariaLabel={`${name} API key`}
				bind:value={draft}
			/>
			<Button
				variant="primary"
				size="sm"
				class="shrink-0"
				ariaLabel={`Save ${name} API key`}
				disabled={!hasDraft || busy}
				onclick={() => void save()}
			>
				Save
			</Button>
			{#if keySaved}
				<Button
					variant="secondary"
					size="sm"
					class="shrink-0"
					ariaLabel={`Remove ${name} API key`}
					disabled={busy}
					onclick={() => void remove()}
				>
					Remove
				</Button>
			{/if}
		</div>
		<p class="text-fg-tertiary text-xs leading-5">
			Base URL <span class="text-fg-secondary font-mono">{baseUrl}</span>
		</p>
		<ul class="text-fg-tertiary grid gap-0.5 text-xs leading-5" aria-label={`${name} models`}>
			{#each models as model (model.id)}
				<li>
					<span class="text-fg-secondary font-medium">{model.label}</span>
					{model.description ? ` · ${model.description}` : ''}
				</li>
			{/each}
		</ul>
		{#if error}
			<p class="text-error-content text-xs leading-5" role="alert">{error}</p>
		{/if}
	</div>
</div>
