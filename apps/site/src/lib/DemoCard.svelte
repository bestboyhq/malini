<script lang="ts">
	import { loadWhenIdle } from './idle';
	import { demoHref, type DemoPlay } from './urls';

	let { workstream, title, play }: { workstream: string; title: string; play?: DemoPlay } =
		$props();

	let ready = $state(false);
</script>

<iframe
	data-src={demoHref('card', workstream, play)}
	{title}
	class:ready
	{@attach loadWhenIdle(() => (ready = true))}
></iframe>

<style>
	iframe {
		flex: 1;
		width: 100%;
		border: 0;
		opacity: 0;
		transition: opacity 500ms var(--enter-ease);
	}

	.ready {
		opacity: 1;
	}
</style>
