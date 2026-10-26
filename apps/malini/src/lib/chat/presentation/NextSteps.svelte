<script lang="ts">
	import { Button } from '$hyper-ui/components/button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import type { FileMentionTarget } from './file-mention-links';
	import MarkdownText from './MarkdownText.svelte';

	interface Props {
		steps: readonly string[];
		onsend?: ((step: string) => void) | undefined;
		onfork?: ((step: string) => void) | undefined;
		onscratchpad?: ((step: string) => void) | undefined;
		onopenfile?: ((target: FileMentionTarget, mention: HTMLElement) => void) | undefined;
		canopenfile?: ((path: string) => boolean) | undefined;
		quiet?: boolean;
	}

	let {
		steps,
		onsend,
		onfork,
		onscratchpad,
		onopenfile,
		canopenfile,
		quiet = false,
	}: Props = $props();

	let handled = $state<Readonly<Record<number, string>>>({});
	let commandHeld = $state(false);
	let shipWidth = $state(0);
	let forkWidth = $state(0);

	const forking = $derived(commandHeld && onfork !== undefined);
	const labelWidth = $derived(forking ? forkWidth : shipWidth);
	const reservedWidth = $derived(onfork && labelWidth > 0 ? forkWidth - labelWidth : 0);

	function mark(index: number, outcome: string): void {
		handled = { ...handled, [index]: outcome };
	}

	function trackCommand(event: KeyboardEvent | PointerEvent): void {
		commandHeld = event.metaKey;
	}

	function ship(index: number, step: string, event: MouseEvent): void {
		if (event.metaKey && onfork) {
			onfork(step);
			mark(index, 'Shipped in a new chat');
			return;
		}
		onsend?.(step);
		mark(index, 'Sent');
	}
</script>

<svelte:window
	onkeydown={trackCommand}
	onkeyup={trackCommand}
	onpointermove={trackCommand}
	onblur={() => (commandHeld = false)}
/>

<section
	class="border-surface-150-border -mx-3 flex flex-col gap-1.5 border-t-[0.5px] px-3 pt-2.5"
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
				<span class="text-2xs text-fg-tertiary flex h-6 shrink-0 items-center gap-1">
					<Icon name="check" size={12} />
					{handled[index]}
				</span>
			{:else}
				<span
					class="actions flex shrink-0 items-center gap-1"
					style:padding-inline-start={`${reservedWidth}px`}
				>
					{#if onscratchpad}
						<Button
							variant="ghost"
							size="sm"
							onclick={() => {
								onscratchpad(step);
								mark(index, 'In the scratchpad');
							}}
						>
							{#snippet leading()}<Icon name="note" size={12} />{/snippet}
							Note it
						</Button>
					{/if}
					{#if onsend}
						<Tooltip
							content="Hold ⌘ to slice, fork and ship it in a new chat"
							placement="top"
							suppressed={!onfork || forking}
						>
							<Button
								variant={quiet ? 'secondary' : 'primary'}
								size="sm"
								ariaLabel={forking ? 'Slice, fork, ship' : 'Ship it'}
								onclick={(event) => ship(index, step, event)}
							>
								{#snippet leading()}
									<span class="swap" aria-hidden="true">
										<span class="face" data-shown={!forking}><Icon name="send" size={12} /></span>
										<span class="face" data-shown={forking}><Icon name="branch" size={12} /></span>
									</span>
								{/snippet}
								<span
									class="swap swap-label"
									style:width={labelWidth > 0 ? `${labelWidth}px` : undefined}
									aria-hidden="true"
								>
									<span class="face" data-shown={!forking} bind:offsetWidth={shipWidth}>
										Ship it
									</span>
									<span class="face" data-shown={forking} bind:offsetWidth={forkWidth}>
										Slice, fork, ship
									</span>
								</span>
							</Button>
						</Tooltip>
					{/if}
				</span>
			{/if}
		</div>
	{/each}
</section>

<style>
	.swap {
		display: inline-grid;
		justify-content: start;
		justify-items: start;
		align-items: center;
	}

	.swap > .face {
		grid-area: 1 / 1;
		white-space: nowrap;
		transition:
			opacity 180ms var(--ease-out),
			filter 180ms var(--ease-out),
			translate 180ms var(--ease-out);
	}

	.swap > .face[data-shown='false'] {
		opacity: 0;
		filter: blur(2px);
		translate: 0 2px;
	}

	.swap-label {
		overflow: hidden;
		transition: width 240ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	.actions {
		transition: padding-inline-start 240ms cubic-bezier(0.16, 1, 0.3, 1);
	}

	@media (prefers-reduced-motion: reduce) {
		.swap > .face,
		.swap-label,
		.actions {
			transition: none;
		}
	}
</style>
