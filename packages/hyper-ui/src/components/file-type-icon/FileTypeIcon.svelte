<script lang="ts">
	import { fileIconUrl, pathIconIdFor } from '../file-icons/file-icon';

	interface Props {
		path: string;
		kind?: 'file' | 'folder';
		expanded?: boolean;
		root?: boolean;
		size?: number;
		class?: string;
		testId?: string;
	}

	let {
		path,
		kind = 'file',
		expanded = false,
		root = false,
		size = 14,
		class: className,
		testId,
	}: Props = $props();

	const icon = $derived(pathIconIdFor(path, kind, { expanded, root }));
</script>

<img
	src={fileIconUrl(icon)}
	alt=""
	aria-hidden="true"
	draggable="false"
	width={size}
	height={size}
	class={['shrink-0 select-none', className]}
	style={`width: ${size}px; height: ${size}px;`}
	data-testid={testId}
	data-file-icon={icon}
/>
