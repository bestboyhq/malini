<script lang="ts">
	interface Props {
		label: string;
		kind: 'handoff' | 'continuation' | 'secrets';
	}

	let { label, kind }: Props = $props();
</script>

<div
	class="text-2xs text-fg-tertiary flex w-full items-center gap-3"
	data-message-kind={kind}
	data-testid="chat-transcript-divider"
>
	<span class="bg-surface-50 h-px flex-1" aria-hidden="true"></span>
	<span class="shrink-0">{label}</span>
	<span class="bg-surface-50 h-px flex-1" aria-hidden="true"></span>
</div>
