<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import type { FileMentionTarget } from './file-mention-links';
	import MarkdownText from './MarkdownText.svelte';

	interface Props {
		steps: readonly string[];
		onsend?: ((step: string) => void) | undefined;
		onscratchpad?: ((step: string) => void) | undefined;
		onopenfile?: ((target: FileMentionTarget, mention: HTMLElement) => void) | undefined;
		canopenfile?: ((path: string) => boolean) | undefined;
		quiet?: boolean;
	}

	let { steps, onsend, onscratchpad, onopenfile, canopenfile, quiet = false }: Props = $props();

	let handled = $state<Readonly<Record<number, string>>>({});

	function mark(index: number, outcome: string): void {
		handled = { ...handled, [index]: outcome };
	}
</script>

<section
	class="border-surface-150-border -mx-3 mt-0.5 flex flex-col gap-1 border-t-[0.5px] px-3 pt-2"
	aria-label="Next steps"
>
	{#each steps as step, index (index)}
		<div class="flex min-h-6 items-center gap-2 text-xs leading-5">
			<Tooltip
				content="Next step"
				placement="left"
				class="text-brand-foreground h-5 w-3.5 shrink-0 items-center justify-center"
			>
				<Icon name="chevrons-right" size={14} ariaLabel="Next step" />
			</Tooltip>
			<MarkdownText
				text={step}
				mode="prose"
				class="text-fg-default line-clamp-2 min-w-0 flex-1 select-text"
				{onopenfile}
				{canopenfile}
			/>
			{#if handled[index]}
				<span class="text-2xs text-fg-tertiary flex shrink-0 items-center gap-1">
					<Icon name="check" size={12} />
					{handled[index]}
				</span>
			{:else}
				<span class="flex shrink-0 items-center gap-1.5">
					{#if onscratchpad}
						<Button
							variant="secondary"
							size="xs"
							onclick={() => {
								onscratchpad(step);
								mark(index, 'In the scratchpad');
							}}
						>
							{#snippet leading()}<Icon name="note" size={12} />{/snippet}
							Scratchpad
						</Button>
					{/if}
					{#if onsend}
						<Button
							variant={quiet ? 'secondary' : 'primary'}
							size="xs"
							onclick={() => {
								onsend(step);
								mark(index, 'Sent');
							}}
						>
							{#snippet leading()}<Icon name="send" size={12} />{/snippet}
							Do it now
						</Button>
					{/if}
				</span>
			{/if}
		</div>
	{/each}
</section>
