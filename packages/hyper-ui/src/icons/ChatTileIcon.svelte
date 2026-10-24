<script lang="ts">
	import { glyphFrame, glyphs } from './glyphs.generated';
	import { iconLabel, type IconProps } from './icon-props';

	let { class: className, size = 16, ariaLabel }: IconProps = $props();
	const glyphSize = $derived(Math.round(size * 0.68));
	const radius = $derived(Math.max(4, Math.round(size * 0.3)));
</script>

<span
	class={['chat-tile', className]}
	style:width="{size}px"
	style:height="{size}px"
	style:border-radius="{radius}px"
	{...iconLabel(ariaLabel)}
>
	<svg width={glyphSize} height={glyphSize} {...glyphFrame} aria-hidden="true">
		<path d={glyphs.chat.outline} fill="currentColor" />
	</svg>
</span>

<style>
	.chat-tile {
		display: inline-grid;
		flex: none;
		place-items: center;
		color: var(--color-fg-default);
		background: linear-gradient(
			180deg,
			color-mix(in oklab, var(--color-fg-default) 20%, var(--color-surface-150)),
			var(--color-surface-150)
		);
		box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--color-fg-default) 18%, transparent);
	}
</style>
