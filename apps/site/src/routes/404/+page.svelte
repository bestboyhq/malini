<script lang="ts">
	import { docHref } from '$lib/links';
	import Head from '$lib/Head.svelte';
</script>

<Head title="Not found - Malini" description="This page does not exist." path="/404" noindex />

<section class="missing">
	<h1>Not found</h1>
	<p>This page does not exist.</p>
	<p>
		<a class="button secondary" href={docHref('/docs')}>Read the docs</a>
	</p>
</section>

<style>
	.missing {
		max-width: var(--width);
		margin: 0 auto;
		padding: 96px 24px 0;
		text-align: center;
	}

	h1 {
		margin: 0 0 8px;
		font-size: 40px;
		letter-spacing: -0.03em;
	}

	p {
		color: var(--fg-secondary);
	}
</style>
