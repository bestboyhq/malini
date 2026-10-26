<script lang="ts">
	import Hero from '$lib/Hero.svelte';
</script>

<svelte:head>
	<title>Malini Open Graph image</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<Hero og />

<style>
	:global(:root) {
		color-scheme: dark;
		overflow: hidden;
		scrollbar-gutter: auto;
	}
</style>
