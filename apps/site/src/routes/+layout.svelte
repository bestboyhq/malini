<script lang="ts">
	import '@fontsource-variable/inter/opsz.css';
	import inter from '@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2?url';
	import '../app.css';
	import { page } from '$app/state';
	import Bar from '$lib/Bar.svelte';
	import Footer from '$lib/Footer.svelte';
	import { docHref } from '$lib/links';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	const inDocs = $derived(page.url.pathname.startsWith(docHref('/docs')));
	const product = $derived(page.route.id !== '/404');
</script>

<svelte:head>
	<link
		rel="preload"
		href={inter}
		as="font"
		type="font/woff2"
		crossorigin="anonymous"
		fetchpriority="high"
	/>
</svelte:head>

<div class="site">
	<a class="skip" href="#main">Skip to content</a>
	<Bar {inDocs} />
	<main id="main">
		{@render children()}
	</main>
	<Footer sitemap={product} />
</div>
