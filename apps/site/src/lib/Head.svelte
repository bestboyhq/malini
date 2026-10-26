<script lang="ts">
	import { BESTBOY_URL, SITE_URL } from '$lib/links';
	import og from '$lib/og.png';

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
	<meta property="og:image" content="{BESTBOY_URL}{og}" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta
		property="og:image:alt"
		content="Malini's page: An agentic development environment for builders moving fast, over the Malini window with workstreams in its sidebar, a chat, and Draft and Merge above 2 changed files."
	/>
	<meta name="twitter:card" content="summary_large_image" />
	<link rel="alternate" type="text/plain" title="llms.txt" href="{SITE_URL}/llms.txt" />
</svelte:head>
