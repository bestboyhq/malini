<script lang="ts">
	import { promptChipShowsFileIcon } from '$lib/chat/domain/prompt-chip';
	import { Button } from '$hyper-ui/components/button';
	import { FileTypeIcon } from '$hyper-ui/components/file-type-icon';
	import {
		CHIP_CLASS,
		OPENABLE_CHIP_CLASS,
		type ChipOpener,
		type InlinePromptChipView,
	} from './inline-prompt-chips';

	interface Props {
		chip: InlinePromptChipView;
		pending?: boolean;
		opener?: ChipOpener | undefined;
	}

	let { chip, pending = false, opener }: Props = $props();

	const chipClass = $derived([CHIP_CLASS, 'mx-0.5 align-middle', pending && 'opacity-70']);

	function onOpenClick(event: MouseEvent): void {
		event.stopPropagation();
		opener?.open();
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

{#if opener}
	<Button
		bare
		class={[chipClass, OPENABLE_CHIP_CLASS]}
		ariaLabel={opener.label}
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
