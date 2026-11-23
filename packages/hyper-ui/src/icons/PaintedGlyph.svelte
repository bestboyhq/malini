<script lang="ts">
	import { glyphFrame, glyphs, type IconName } from './glyphs.generated';

	interface Props {
		name: IconName;
		size?: number;
	}

	let { name, size = 16 }: Props = $props();

	const mask = $derived.by(() => {
		const { outline, solid } = glyphs[name];
		const paths = `${outline ? `<path d='${outline}'/>` : ''}${solid ? `<path d='${solid}' fill='black'/>` : ''}`;
		const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${glyphFrame.viewBox}' fill='none' stroke='black' stroke-width='${glyphFrame['stroke-width']}' stroke-linecap='round' stroke-linejoin='round'>${paths}</svg>`;
		return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 0 50% / ${size}px ${size}px no-repeat`;
	});
</script>

<span class="painted-glyph" style:mask aria-hidden="true"></span>

<style>
	.painted-glyph {
		position: absolute;
		inset: 0;
		background: inherit;
		background-clip: border-box;
	}
</style>
