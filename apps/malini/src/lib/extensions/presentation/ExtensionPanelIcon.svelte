<script lang="ts">
	import { FileTypeIcon } from '$hyper-ui/components/file-type-icon';
	import { Icon, type IconName } from '$hyper-ui/icons';

	interface Props {
		icon: string;
		size?: number;
	}

	let { icon, size = 14 }: Props = $props();

	const PATH_ICON_PREFIX = 'path:';
	const PANEL_ICONS: Readonly<Record<string, IconName>> = {
		terminal: 'terminal',
		browser: 'globe',
		preview: 'preview',
		file: 'files',
		files: 'files',
		'git-diff': 'diff',
		changes: 'diff',
		checks: 'checklist',
		verification: 'checklist',
		'workstream-setup': 'cube',
		setup: 'cube',
	};

	const iconPath = $derived(
		icon.startsWith(PATH_ICON_PREFIX) ? icon.slice(PATH_ICON_PREFIX.length) : null,
	);
</script>

{#if iconPath !== null}
	<FileTypeIcon path={iconPath} {size} />
{:else}
	<Icon name={PANEL_ICONS[icon] ?? 'puzzle'} {size} />
{/if}
