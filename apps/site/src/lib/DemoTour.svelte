<script lang="ts">
	import { cameraFor, messageType, shotOf, TOUR_MESSAGE, type Shot } from './camera';
	import { demoHref } from './links';

	let { workstream, title }: { workstream: string; title: string } = $props();

	const APP = { width: 1280, height: 860 };

	let stage = $state<HTMLElement>();
	let frame = $state<HTMLIFrameElement>();
	let width = $state(0);
	let height = $state(0);
	let shot = $state<Shot | null>(null);
	let ready = $state(false);

	const camera = $derived(cameraFor(APP, { width, height }, shot));

	$effect(() => {
		if (!stage || !frame) return;
		const view = frame;
		let seen = false;
		let waiting = false;
		const play = (): void => {
			if (!seen || !waiting) return;
			waiting = false;
			view.contentWindow?.postMessage({ type: TOUR_MESSAGE.play }, location.origin);
		};
		const observer = new IntersectionObserver(
			([entry]) => {
				seen = entry?.isIntersecting ?? false;
				play();
			},
			{ threshold: 0.6 },
		);
		observer.observe(stage);
		const hear = (event: MessageEvent): void => {
			if (event.source !== view.contentWindow || event.origin !== location.origin) return;
			const type = messageType(event.data);
			if (type === TOUR_MESSAGE.camera) {
				shot = shotOf(
					typeof event.data === 'object' && event.data !== null && 'shot' in event.data
						? event.data.shot
						: null,
				);
			}
			if (type === TOUR_MESSAGE.ready) {
				waiting = true;
				play();
			}
		};
		addEventListener('message', hear);
		return () => {
			observer.disconnect();
			removeEventListener('message', hear);
		};
	});
</script>

<div class="tour" bind:this={stage} bind:clientWidth={width} bind:clientHeight={height}>
	<iframe
		bind:this={frame}
		src={demoHref('app', `/workstreams/${workstream}`, 'tour')}
		{title}
		width={APP.width}
		height={APP.height}
		loading="lazy"
		class:ready
		style:transform="translate({camera.x}px, {camera.y}px) scale({camera.scale})"
		onload={() => (ready = true)}
	></iframe>
</div>

<style>
	.tour {
		position: relative;
		flex: 1;
		overflow: hidden;
		background: var(--app-root);
	}

	iframe {
		position: absolute;
		top: 0;
		left: 0;
		border: 0;
		opacity: 0;
		transform-origin: 0 0;
		transition:
			opacity 500ms var(--enter-ease),
			transform 1100ms cubic-bezier(0.65, 0, 0.35, 1);
	}

	.ready {
		opacity: 1;
	}

	@media (prefers-reduced-motion: reduce) {
		iframe {
			transition: opacity 500ms var(--enter-ease);
		}
	}
</style>
