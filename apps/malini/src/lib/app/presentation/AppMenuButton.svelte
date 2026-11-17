<script lang="ts">
	import { IconButton } from '$hyper-ui/components/icon-button';
	import { Tooltip } from '$hyper-ui/components/tooltip';
	import { Icon } from '$hyper-ui/icons';
	import { popUpAppMenuCommand } from '$lib/app/application/commands/pop-up-app-menu.command';

	const LABEL = 'Menu';
	const GAP_BELOW_BUTTON = 6;

	let button: HTMLAnchorElement | HTMLButtonElement | null = $state(null);
	let altAlone = false;

	function popUp(): void {
		if (!button) return;
		const { left, bottom } = button.getBoundingClientRect();
		popUpAppMenuCommand({ x: left, y: bottom + GAP_BELOW_BUTTON });
	}

	function watchAlt(event: KeyboardEvent): void {
		if (event.key === 'Alt' && event.repeat) return;
		altAlone =
			event.key === 'Alt' &&
			!event.ctrlKey &&
			!event.shiftKey &&
			!event.metaKey &&
			!event.isComposing;
	}

	function popUpOnAltAlone(event: KeyboardEvent): void {
		const released = altAlone && event.key === 'Alt';
		altAlone = false;
		if (released && !event.defaultPrevented) popUp();
	}

	function forgetAlt(): void {
		altAlone = false;
	}
</script>

<svelte:window
	onkeydowncapture={watchAlt}
	onkeyup={popUpOnAltAlone}
	onpointerdowncapture={forgetAlt}
	onwheelcapture={forgetAlt}
	onblur={forgetAlt}
/>

<Tooltip content={LABEL} placement="bottom">
	<IconButton
		bind:element={button}
		ariaLabel={LABEL}
		ariaHasPopup="menu"
		variant="ghost"
		size="auto"
		radius="none"
		class="pointer-events-auto h-[calc(28px/var(--native-zoom,1))] rounded-[calc(7px/var(--native-zoom,1))]"
		onclick={popUp}
	>
		<Icon name="menu" class="size-[calc(16px/var(--native-zoom,1))]" />
	</IconButton>
</Tooltip>
