<script lang="ts">
	import { workstreamImageSourceHook } from '$lib/chat/application/hooks/workstream-image-source.hook.svelte';
	import ReportMedia from './ReportMedia.svelte';

	interface Props {
		workstreamId: string;
		src: string;
		label: string;
		size: 'hero' | 'tile' | 'mini';
		playing?: boolean;
	}

	let { workstreamId, src, label, size, playing = true }: Props = $props();

	const imageSource = workstreamImageSourceHook(() => workstreamId);
	const imagesrc = $derived(imageSource());
</script>

<ReportMedia {src} {label} {workstreamId} {size} {playing} {imagesrc} />
