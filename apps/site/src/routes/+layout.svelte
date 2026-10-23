<script lang="ts">
	import '@fontsource-variable/inter/opsz.css';
	import inter from '@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2?url';
	import '../app.css';
	import { dev } from '$app/environment';
	import { page } from '$app/state';
	import Bar from '$lib/Bar.svelte';
	import Footer from '$lib/Footer.svelte';
	import { docHref, DOWNLOAD_URL, HOME } from '$lib/links';
	import { LOGDASH_SITE } from '$lib/logdash';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	const inDocs = $derived(page.url.pathname.startsWith(docHref('/docs')));
	const product = $derived(page.route.id !== '/404');

	function trackDownload(event: MouseEvent) {
		if (!(event.target instanceof Element)) return;
		const link = event.target.closest(`a[href="${DOWNLOAD_URL}"]`);
		if (!link) return;
		const place = link.closest<HTMLElement>('[data-place]')?.dataset.place ?? 'page';
		window.logdash?.track('malini_web_download_started', {
			app: 'malini',
			menu: `malini-${place}`,
		});
	}
</script>

<svelte:document onclick={trackDownload} />

<svelte:head>
	<link
		rel="preload"
		href={inter}
		as="font"
		type="font/woff2"
		crossorigin="anonymous"
		fetchpriority="high"
	/>
	{#if !dev}
		<script
			defer
			src="{HOME}/_ld/script.js"
			data-site={LOGDASH_SITE}
			data-endpoint="{HOME}/_ld/events"
		></script>
	{/if}
</svelte:head>

<div class="site">
	<a class="skip" href="#main">Skip to content</a>
	<Bar {inDocs} />
	<main id="main">
		{@render children()}
	</main>
	<Footer sitemap={product} />
</div>
