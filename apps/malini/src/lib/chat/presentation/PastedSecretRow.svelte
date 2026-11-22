<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { hidePastedSecretCommand } from '$lib/chat/application/commands/hide-pasted-secret.command';
	import { showPastedSecretCommand } from '$lib/chat/application/commands/show-pasted-secret.command';
	import { sentenceLabel, type PastedSecret } from '$lib/chat/domain/pasted-secrets';

	interface Props {
		pasted: PastedSecret;
	}

	let { pasted }: Props = $props();

	const kept = $derived(pasted.state === 'kept');
</script>

{#snippet glyph()}
	<span
		class={[
			'grid size-4 shrink-0 place-items-center',
			kept ? 'text-fg-tertiary' : 'text-warning-content',
		]}
		aria-hidden="true"
	>
		<Icon name={kept ? 'key' : 'alert'} size={13} />
	</span>
{/snippet}

<div
	class="text-fg-secondary flex h-8 items-center gap-2 pr-1.5 pl-3 text-xs"
	data-testid="pasted-secret"
	data-state={pasted.state}
>
	{#if pasted.failure}
		<Tooltip content={pasted.failure} placement="top">
			{@render glyph()}
		</Tooltip>
	{:else}
		{@render glyph()}
	{/if}
	<span class="min-w-0 flex-1 truncate">
		{#if kept}
			{sentenceLabel(pasted.label)} moved to your keychain. Claude gets
			<code class="text-fg-default font-mono text-[11px]">${pasted.name}</code>
		{:else}
			Claude reads this {pasted.label} as typed
		{/if}
		{#if pasted.failure}
			<span class="sr-only">{pasted.failure}</span>
		{/if}
	</span>
	{#if kept}
		<Button variant="ghost" size="xs" onclick={() => showPastedSecretCommand(pasted.id)}>
			{#snippet leading()}
				<Icon name="undo" size={12} />
			{/snippet}
			Undo
		</Button>
	{:else}
		<Button
			variant="ghost"
			size="xs"
			disabled={pasted.state === 'keeping'}
			onclick={() => hidePastedSecretCommand(pasted.id)}
		>
			Hide it
		</Button>
	{/if}
</div>
