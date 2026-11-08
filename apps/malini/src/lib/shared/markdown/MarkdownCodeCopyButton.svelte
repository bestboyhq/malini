<script lang="ts">
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Icon } from '$hyper-ui/icons';

	interface Props {
		copied: boolean;
	}

	let { copied }: Props = $props();
</script>

<IconButton
	variant="secondary"
	size="md"
	bordered
	class="border-surface-elevated-border bg-surface-elevated text-fg-tertiary hover:bg-surface-elevated-hover rounded-md"
	ariaLabel={copied ? 'Code copied' : 'Copy code'}
	data-testid="markdown-code-copy"
>
	{#if copied}
		<Icon name="check" size={14} class="text-fg-default" />
	{:else}
		<Icon name="copy" size={14} />
	{/if}
</IconButton>
