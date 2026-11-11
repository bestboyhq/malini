<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { SensitiveText } from '$hyper-ui/components/sensitive';
	import { Icon } from '$hyper-ui/icons';
	import { revealFade } from './arrival-motion';
	import { failureSpans } from './tool-display-name';

	interface Props extends HTMLAttributes<HTMLDivElement> {
		text: string;
		label?: string | null;
		whole?: boolean;
		action?: Snippet;
	}

	let { text, label = null, whole = false, action, class: className, ...rest }: Props = $props();
	const spans = $derived(failureSpans(text));
</script>

<div
	class={[
		'border-surface-50-border bg-surface-50 text-fg-secondary flex items-start gap-2 rounded-lg border-[0.5px] py-1.5 pl-2.5 text-xs leading-5',
		action ? 'pr-1' : 'pr-2.5',
		className,
	]}
	{...rest}
	in:revealFade
>
	<Icon name="warning" size={12} class="text-error-content mt-1 shrink-0" />
	<p
		class={[
			'min-w-0 flex-1 break-words select-text',
			whole ? 'whitespace-pre-wrap' : 'line-clamp-3',
		]}
	>
		{#if label}<span class="text-fg-tertiary text-2xs mr-1.5 font-mono">
				<SensitiveText text={label} /> ·
			</span>{/if}{#each spans as span, index (index)}{#if span.code}<code
					class="bg-surface-100 text-fg-default rounded box-decoration-clone px-1 py-px font-mono text-[0.9em]"
				>
					<SensitiveText text={span.text} />
				</code>{:else}<SensitiveText text={span.text} />{/if}{/each}
	</p>
	{@render action?.()}
</div>
