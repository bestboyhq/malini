<script lang="ts">
	import ExtensionPanelIcon from './ExtensionPanelIcon.svelte';
	import { extensionDirectoryIconName } from './extension-directory-icon';

	interface Props {
		extensionId: string;
		size?: number;
	}

	let { extensionId, size = 24 }: Props = $props();
	const icon = $derived(extensionDirectoryIconName(extensionId));
</script>

<span class="grid place-items-center leading-none" aria-hidden="true" data-extension-icon={icon}>
	<ExtensionPanelIcon {icon} {size} />
</span>
