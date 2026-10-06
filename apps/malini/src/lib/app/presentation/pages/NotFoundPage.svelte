<script lang="ts">
	import { page } from '$shared/router/state';
</script>

<svelte:head>
	<title>malini · Not found</title>
</svelte:head>

<main
	class="text-fg-secondary flex h-full flex-col items-center justify-center gap-2 px-8 text-sm"
	data-navigation-error="true"
	data-navigation-error-message="Route not found"
>
	<p class="text-fg-default font-medium">Nothing lives at {page.url.pathname}</p>
	<a class="underline" href="/">Back to your repositories</a>
</main>
