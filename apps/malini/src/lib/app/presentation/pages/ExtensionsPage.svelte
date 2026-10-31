<script lang="ts">
	import { page } from '$shared/router/state';
	import { Extensions } from '$lib/extensions/extensions.api';
	import { extensionsView } from '../extensions-view';

	const TITLES = {
		discover: 'Extensions',
		installed: 'Installed',
		published: 'Published',
		detail: 'Extension',
	} as const;

	const view = $derived(extensionsView(page.route.id));
	const publisher = $derived(page.params.publisher ?? null);
	const name = $derived(page.params.name ?? null);
</script>

<svelte:head>
	<title>Malini · {view === 'detail' && name ? name : TITLES[view]}</title>
</svelte:head>

<main class="flex h-full min-h-0 min-w-0 flex-col" data-testid="extensions-page">
	<div class="native-page-drag-strip" data-native-drag-region></div>
	<Extensions {view} {publisher} {name} />
</main>
