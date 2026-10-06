<script lang="ts">
	import { onMount } from 'svelte';
	import { Toaster } from 'svelte-sonner';
	import { bottomOffsetClearOfAvoided, type ToastLane } from './toast-clearance';
	import { toastStore } from './toast.store.svelte';

	const EDGE_PX = 16;
	const MAX_WIDTH_PX = 460;

	let bottom = $state(EDGE_PX);

	function lane(): ToastLane {
		const right = window.innerWidth - EDGE_PX;
		return { left: right - Math.min(MAX_WIDTH_PX, window.innerWidth - 3 * EDGE_PX), right };
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
	offset={{ bottom: `${bottom}px`, right: `${EDGE_PX}px` }}
	mobileOffset={{ bottom: '12px', right: '12px' }}
/>

<style>
	:global([data-sonner-toaster]) {
		--width: min(460px, calc(100vw - 48px)) !important;
		clip-path: inset(-100vh -100vw -16px -100vw);
	}

	:global([data-sonner-toast][data-styled='false']) {
		width: var(--width);
		display: flex;
		justify-content: flex-end;
	}
</style>
