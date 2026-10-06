<script module lang="ts">
	let nextGradientId = 0;
</script>

<script lang="ts">
	import { glyphFrame, glyphs } from './glyphs.generated';
	import { iconLabel, type IconProps } from './icon-props';

	interface Props extends IconProps {
		gradient?: boolean;
	}

	let { class: className, size = 16, ariaLabel, gradient = false }: Props = $props();
	const gradientId = `hyper-send-gradient-${++nextGradientId}`;
	const arrow = glyphs['arrow-up'].outline;
</script>

<svg class={className} width={size} height={size} {...glyphFrame} {...iconLabel(ariaLabel)}>
	<defs>
		<linearGradient id={gradientId} x1="4" y1="13" x2="12" y2="3" gradientUnits="userSpaceOnUse">
			<stop stop-color="var(--color-accent-2-secondary)" />
			<stop offset="1" stop-color="var(--color-accent-2-primary)" />
		</linearGradient>
	</defs>
	<path d={arrow} class={['transition-opacity ease-out', gradient ? 'opacity-0' : 'opacity-100']} />
	<path
		d={arrow}
		stroke={`url(#${gradientId})`}
		class={['transition-opacity ease-out', gradient ? 'opacity-100' : 'opacity-0']}
	/>
</svg>
