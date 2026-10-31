<script lang="ts">
	import { iconLabel, type IconProps } from './icon-props';

	let { class: className, size = 16, ariaLabel }: IconProps = $props();
</script>

<svg
	class={className}
	width={size}
	height={size}
	viewBox="0 0 16 16"
	xmlns="http://www.w3.org/2000/svg"
	{...iconLabel(ariaLabel)}
>
	<circle cx="8" cy="8" r="7.25" fill="#ffc83d" />
	<circle cx="5.6" cy="6.9" r=".95" fill="#3d2a14" />
	<circle cx="10.4" cy="6.9" r=".95" fill="#3d2a14" />
	<ellipse cx="4.2" cy="9.5" rx="1.25" ry=".8" fill="#ff8fab" opacity=".85" />
	<ellipse cx="11.8" cy="9.5" rx="1.25" ry=".8" fill="#ff8fab" opacity=".85" />
	<path
		d="M6 9.6c1.1 1.25 2.9 1.25 4 0"
		fill="none"
		stroke="#3d2a14"
		stroke-width="1.1"
		stroke-linecap="round"
	/>
</svg>
