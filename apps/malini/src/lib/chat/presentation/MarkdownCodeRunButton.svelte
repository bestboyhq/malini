<script lang="ts">
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Icon } from '$hyper-ui/icons';
</script>

<IconButton
	variant="secondary"
	size="md"
	bordered
	class="border-surface-elevated-border bg-surface-elevated text-fg-tertiary hover:bg-surface-elevated-hover rounded-md"
	ariaLabel="Run command"
	data-testid="markdown-code-run"
>
	<Icon name="play" size={14} />
</IconButton>
