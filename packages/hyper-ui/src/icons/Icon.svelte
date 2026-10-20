<script lang="ts">
	import { glyphFrame, glyphs, type IconName } from './glyphs.generated';
	import { iconLabel, type IconProps } from './icon-props';

	interface Props extends IconProps {
		name: IconName;
	}

	let { name, class: className, size = 16, ariaLabel }: Props = $props();
	const glyph = $derived(glyphs[name]);
</script>

<svg class={className} width={size} height={size} {...glyphFrame} {...iconLabel(ariaLabel)}>
	{#if glyph.outline}<path d={glyph.outline} />{/if}
	{#if glyph.solid}<path d={glyph.solid} fill="currentColor" />{/if}
</svg>
