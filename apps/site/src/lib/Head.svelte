<script lang="ts">
	import { SITE_URL } from '$lib/links';

	type Props = { title: string; description: string; path: string; noindex?: boolean };

	let { title, description, path, noindex = false }: Props = $props();

	const canonical = $derived(`${SITE_URL}${path}`);
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	{#if noindex}
		<meta name="robots" content="noindex" />
	{:else}
		<link rel="canonical" href={canonical} />
	{/if}
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Malini" />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={canonical} />
	<meta property="og:image" content="{SITE_URL}/og.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta
		property="og:image:alt"
		content="The Malini window with demo workstreams running side by side."
	/>
	<meta name="twitter:card" content="summary_large_image" />
	<link rel="alternate" type="text/plain" title="llms.txt" href="{SITE_URL}/llms.txt" />
</svelte:head>
