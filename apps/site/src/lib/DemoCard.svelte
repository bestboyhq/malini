<script lang="ts">
	import { demoHref } from './links';

	let { workstream, title }: { workstream: string; title: string } = $props();

	let ready = $state(false);
</script>

<iframe
	src={demoHref('card', workstream)}
	{title}
	loading="lazy"
	class:ready
	onload={() => (ready = true)}
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
