<script lang="ts">
	import type { Snippet } from 'svelte';
	import { FileTypeIcon } from '$hyper-ui/components/file-type-icon';
	import { SensitiveText } from '$hyper-ui/components/sensitive';

	interface Props {
		path: string;
		children?: Snippet;
	}

	let { path, children }: Props = $props();

	const folder = $derived(path.slice(0, path.lastIndexOf('/') + 1));
	const fileName = $derived(path.slice(folder.length));
</script>

<header class="border-surface-50-border flex h-8 items-center gap-2 border-b-[0.5px] px-2.5">
	<FileTypeIcon {path} size={12} />
	<span class="text-2xs flex min-w-0 flex-1 font-mono">
		<span class="text-fg-tertiary min-w-0 truncate"><SensitiveText text={folder} /></span>
		<span class="text-fg-secondary shrink-0"><SensitiveText text={fileName} /></span>
	</span>
	{@render children?.()}
</header>
