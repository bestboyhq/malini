<script lang="ts">
	import { onMount } from 'svelte';
	import type { WindowControl } from '$contract/commands';
	import { Icon, type IconName } from '$hyper-ui/icons';
	import { pressWindowControlCommand } from '$lib/app/application/commands/press-window-control.command';
	import { watchWindowControlsHook } from '$lib/app/application/hooks/watch-window-controls.hook';
	import { windowControlsQuery } from '$lib/app/application/queries/window-controls.query.svelte';

	type Light = Readonly<{
		control: WindowControl;
		color: 'close' | 'minimize' | 'maximize';
		label: string;
		glyph: IconName;
	}>;

	const CLOSE: Light = { control: 'close', color: 'close', label: 'Close', glyph: 'close' };
	const MINIMIZE: Light = {
		control: 'minimize',
		color: 'minimize',
		label: 'Minimize',
		glyph: 'minus',
	};
	const MAXIMIZE: Light = {
		control: 'maximize',
		color: 'maximize',
		label: 'Maximize',
		glyph: 'window-maximize',
	};
	const RESTORE: Light = {
		control: 'restore',
		color: 'maximize',
		label: 'Restore',
		glyph: 'window-restore',
	};

	const lights = $derived([CLOSE, MINIMIZE, windowControlsQuery.maximized ? RESTORE : MAXIMIZE]);

	onMount(watchWindowControlsHook);

	function keepFocusWhereItIs(event: MouseEvent): void {
		event.preventDefault();
	}
</script>

<div
	class="window-controls"
	data-inactive={windowControlsQuery.focused ? undefined : ''}
	data-testid="window-controls"
>
	{#each lights as light (light.color)}
		<!-- eslint-disable-next-line @malini/desktop/no-raw-button -- a window control is a bare light drawn by this component's scoped style block, with no hover fill, focus ring or tab stop, as the OS draws its own -->
		<button
			type="button"
			class="window-control"
			data-light={light.color}
			aria-label={light.label}
			tabindex="-1"
			onmousedown={keepFocusWhereItIs}
			onclick={() => pressWindowControlCommand(light.control)}
		>
			<Icon name={light.glyph} class="window-control__glyph" />
		</button>
	{/each}
</div>

<style>
	.window-controls {
		--light-size: calc(var(--native-traffic-light-size) / var(--native-zoom, 1));
		position: fixed;
		top: calc(var(--native-traffic-light-inset-y) / var(--native-zoom, 1));
		left: calc(var(--native-traffic-light-inset-x) / var(--native-zoom, 1));
		z-index: 2147483647;
		display: none;
		gap: calc(9px / var(--native-zoom, 1));
		-webkit-app-region: no-drag;
	}

	:global(html[data-native-shell='true']) .window-controls {
		display: flex;
	}

	:global(html[data-native-full-screen]) .window-controls {
		display: none;
	}

	.window-control {
		display: grid;
		width: var(--light-size);
		height: var(--light-size);
		place-items: center;
		border: 0;
		border-radius: 50%;
		background: var(--light);
		box-shadow: inset 0 0 0 calc(0.5px / var(--native-zoom, 1)) var(--color-window-control-edge);
		padding: 0;
		color: var(--glyph);
		cursor: default;
	}

	.window-control[data-light='close'] {
		--light: var(--color-window-close);
		--glyph: var(--color-window-close-glyph);
	}

	.window-control[data-light='minimize'] {
		--light: var(--color-window-minimize);
		--glyph: var(--color-window-minimize-glyph);
	}

	.window-control[data-light='maximize'] {
		--light: var(--color-window-maximize);
		--glyph: var(--color-window-maximize-glyph);
	}

	.window-controls[data-inactive]:not(:hover) .window-control {
		background: var(--color-window-control-inactive);
	}

	.window-control:active {
		filter: brightness(0.82);
	}

	.window-control :global(.window-control__glyph) {
		width: calc(12px / var(--native-zoom, 1));
		height: calc(12px / var(--native-zoom, 1));
		opacity: 0;
	}

	.window-controls:hover :global(.window-control__glyph) {
		opacity: 1;
	}
</style>
