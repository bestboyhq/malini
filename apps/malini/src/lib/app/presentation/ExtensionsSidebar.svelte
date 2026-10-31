<script lang="ts">
	import { page } from '$shared/router/state';
	import { ExtensionsNav } from '$lib/extensions/extensions.api';
	import { extensionsView } from './extensions-view';
	import SidebarFooter from './SidebarFooter.svelte';
	import SidebarFrame from './SidebarFrame.svelte';

	interface Props {
		backHref: string;
		backLabel: string;
	}

	let { backHref, backLabel }: Props = $props();

	const view = $derived(extensionsView(page.route.id));
</script>

<SidebarFrame testId="extensions-sidebar">
	<ExtensionsNav {backHref} {backLabel} {view} />
	<SidebarFooter />
</SidebarFrame>
