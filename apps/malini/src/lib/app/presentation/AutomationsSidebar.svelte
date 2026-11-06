<script lang="ts">
	import { page } from '$shared/router/state';
	import { AutomationsNav } from '$lib/automations/automations.api';
	import { automationsView } from './automations-view';
	import SidebarFooter from './SidebarFooter.svelte';
	import SidebarFrame from './SidebarFrame.svelte';

	interface Props {
		backHref: string;
		backLabel: string;
	}

	let { backHref, backLabel }: Props = $props();

	const view = $derived(automationsView(page.route.id));
	const selectedAutomationId = $derived(page.params.automationId ?? null);
</script>

<SidebarFrame testId="automations-sidebar">
	<AutomationsNav {backHref} {backLabel} {view} {selectedAutomationId} />
	<SidebarFooter />
</SidebarFrame>
