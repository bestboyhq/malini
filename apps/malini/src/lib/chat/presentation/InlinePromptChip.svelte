<script lang="ts">
	import { promptChipShowsFileIcon } from '$lib/chat/domain/prompt-chip';
	import { Button } from '$hyper-ui/components/button';
	import { FileTypeIcon } from '$hyper-ui/components/file-type-icon';
	import {
		CHIP_CLASS,
		OPENABLE_CHIP_CLASS,
		type InlinePromptChipView,
	} from './inline-prompt-chips';
	import { galleryImageLabel } from './workstream-images';

	interface Props {
		chip: InlinePromptChipView;
		pending?: boolean;
		onopen?: (() => void) | undefined;
	}

	let { chip, pending = false, onopen }: Props = $props();

	const chipClass = $derived([CHIP_CLASS, 'mx-0.5 align-middle', pending && 'opacity-70']);

	function onOpenClick(event: MouseEvent): void {
		event.stopPropagation();
		onopen?.();
	}

	function onOpenKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
	}
</script>

{#snippet content()}
	{#if promptChipShowsFileIcon(chip.kind)}
		<FileTypeIcon path={chip.label} size={12} />
	{:else}
		<span class="text-fg-tertiary shrink-0" aria-hidden="true">{chip.glyph}</span>
	{/if}
	<span class="truncate">{chip.label}</span>
{/snippet}

{#if onopen}
	<Button
		bare
		class={[chipClass, OPENABLE_CHIP_CLASS]}
		ariaLabel={galleryImageLabel(chip.label)}
		data-testid={chip.testId}
		data-chip-kind={chip.kind}
		data-attachment-id={chip.attributes['data-attachment-id']}
		onclick={onOpenClick}
		onkeydown={onOpenKeydown}
	>
		{@render content()}
	</Button>
{:else}
	<span
		class={chipClass}
		data-testid={chip.testId}
		data-chip-kind={chip.kind}
		aria-label={chip.ariaLabel}
		{...chip.attributes}
	>
		{@render content()}
	</span>
{/if}
