<script lang="ts">
	import { iconLabel, type IconProps } from './icon-props';

	let { class: className, size = 16, ariaLabel }: IconProps = $props();
</script>

<svg
	class={className}
	width={size}
	height={size}
	viewBox="2 2 20 20"
	xmlns="http://www.w3.org/2000/svg"
	{...iconLabel(ariaLabel)}
>
	<path fill="currentColor" fill-opacity="0.4" d="M15.6 17.4H8.4v-7.2h7.2z" />
	<path fill="currentColor" d="M15.6 6.6H8.4v10.8h7.2zM19.2 21H4.8V3h14.4z" />
</svg>
