<script lang="ts">
	import { promptChipShowsFileIcon } from '$lib/chat/domain/prompt-chip';
	import { FileTypeIcon } from '$hyper-ui/components/file-type-icon';
	import type { InlinePromptChipView } from './inline-prompt-chips';

	interface Props {
		chip: InlinePromptChipView;
		pending?: boolean;
	}

	let { chip, pending = false }: Props = $props();
</script>

<span
	class={[
		'border-chip-border bg-chip text-2xs text-fg-secondary mx-0.5 inline-flex h-6 max-w-56 items-center gap-1 rounded-md border px-1.5 align-middle',
		pending && 'opacity-70',
	]}
	data-testid={chip.testId}
	data-chip-kind={chip.kind}
	aria-label={chip.ariaLabel}
	{...chip.attributes}
>
	{#if promptChipShowsFileIcon(chip.kind)}
		<FileTypeIcon path={chip.label} size={12} />
	{:else}
		<span class="text-fg-tertiary shrink-0" aria-hidden="true">{chip.glyph}</span>
	{/if}
	<span class="truncate">{chip.label}</span>
</span>
