<script lang="ts">
	import './app-ui/app-ui.api';
	import BrowserMockScene, { at, followUp } from './BrowserMockScene.svelte';
	import { Loop } from './loop.svelte';

	const loop = new Loop([
		1400, 1100, 1000, 800, 900, 600, 700, 800, 700, 500, 800, 1000, 1200, 900, 600, 700, 500, 1500,
		1200, 3600,
	]);
	const step = $derived(loop.step);
	const run = $derived(step >= at.sent ? 2 : step >= at.prompt && step < at.done ? 1 : 0);

	let typed = $state(0);
	let elapsedMs = $state(0);

	const elapsed = $derived(
		`${Math.floor(elapsedMs / 60_000)}m, ${((elapsedMs % 60_000) / 1_000).toFixed(1)}s`,
	);

	$effect(() => {
		if (step !== at.typing) return;
		typed = 0;
		const timer = setInterval(() => {
			typed = Math.min(typed + 1, followUp.length);
		}, 38);
		return () => clearInterval(timer);
	});

	$effect(() => {
		if (run === 0) return;
		const startedAt = performance.now();
		elapsedMs = 0;
		const timer = setInterval(() => (elapsedMs = performance.now() - startedAt), 100);
		return () => clearInterval(timer);
	});
</script>

<div
	class="app-ui relative min-h-0 flex-1 overflow-hidden"
	role="img"
	aria-label="The Malini inspector beside a chat. The agent opens a checkout page in its own browser tab next to Files, types a declined test card, clicks Pay and takes a screenshot, and each step shows in the chat as a Malini browser tool call. Then you pick the gray decline message in that same tab, ask to make it red, and the prompt lands in the chat with the element attached."
	data-nosnippet
	{@attach loop.play}
>
	<div class="absolute inset-0 isolate" inert aria-hidden="true">
		<BrowserMockScene step={0} typed={0} elapsed="" />
	</div>
	<div class="absolute inset-0 isolate" class:ending={step === loop.last} inert aria-hidden="true">
		<BrowserMockScene {step} {typed} {elapsed} />
	</div>
</div>

<style>
	.ending {
		animation: crossfade 700ms ease-in-out 2800ms forwards;
	}

	@keyframes crossfade {
		to {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ending {
			animation: none;
		}
	}
</style>
