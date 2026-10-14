import { previewWorkstreamImageCommand } from '$lib/chat/application/commands/preview-workstream-image.command';
import { releaseImagePreviewsCommand } from '$lib/chat/application/commands/release-image-previews.command';
import { imagePreviewQuery } from '$lib/chat/application/queries/image-preview.query.svelte';
import { newChatRequestId } from '$lib/chat/domain/chat-request';

export { workstreamImageSourceHook, type WorkstreamImageSource };

type WorkstreamImageSource = (path: string) => string | null;

function workstreamImageSourceHook(workstreamId: () => string): () => WorkstreamImageSource {
	const instanceId = newChatRequestId();
	const owner = $derived(`${instanceId}:${workstreamId()}`);
	const source = $derived.by((): WorkstreamImageSource => {
		const current = owner;
		const id = workstreamId();
		const previews = imagePreviewQuery.owned(current);
		return (path) => {
			const preview = previews[path];
			if (!preview) previewWorkstreamImageCommand({ owner: current, workstreamId: id, path });
			return preview?.status === 'ready' ? preview.src : null;
		};
	});

	$effect(() => {
		const current = owner;
		return () => releaseImagePreviewsCommand(current);
	});

	return () => source;
}
