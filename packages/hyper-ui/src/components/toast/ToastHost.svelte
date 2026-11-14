<script lang="ts">
	import { onMount } from 'svelte';
	import { Toaster } from 'svelte-sonner';
	import { bottomOffsetClearOfAvoided, TOAST_GAP_PX, type ToastLane } from './toast-clearance';
	import { toastStore } from './toast.store.svelte';

	const EDGE_PX = 12;
	const WIDTH_PX = 288;

	let bottom = $state(EDGE_PX);

	function lane(): ToastLane {
		const right = window.innerWidth - EDGE_PX;
		return { left: right - Math.min(WIDTH_PX, window.innerWidth - 2 * EDGE_PX), right };
	}

	onMount(() => {
		let frame = 0;
		const follow = (): void => {
			bottom = bottomOffsetClearOfAvoided(lane(), EDGE_PX);
			frame = document.querySelector('[data-sonner-toaster]') ? requestAnimationFrame(follow) : 0;
		};
		const stopObserving = toastStore.observe(() => {
			bottom = bottomOffsetClearOfAvoided(lane(), EDGE_PX);
			if (frame === 0) frame = requestAnimationFrame(follow);
		});
		return () => {
			stopObserving();
			cancelAnimationFrame(frame);
		};
	});
</script>

<Toaster
	position="bottom-right"
	expand
	gap={TOAST_GAP_PX}
	offset={{ bottom: `${bottom}px`, right: `${EDGE_PX}px` }}
	mobileOffset={{ bottom: `${EDGE_PX}px`, right: `${EDGE_PX}px` }}
/>

<style>
	:global([data-sonner-toaster]) {
		--width: min(288px, calc(100vw - 24px)) !important;
		clip-path: inset(-100vh -100vw -12px -100vw);
	}

	:global([data-sonner-toast][data-styled='false']) {
		width: var(--width);
	}
</style>
