import { untrack } from 'svelte';
import type { FileOpenRequestedPayload } from '$contract/events';

import { requestedFileKey } from '../../domain/requested-file';
import { openedFilesService } from '../../infrastructure/services/opened-files.service';
import { requestedFilesStore } from '../../infrastructure/stores/requested-files.store';
import { openRequestedFileCommand } from '../commands/open-requested-file.command';
import { extensionRuntimeReadyQuery } from '../queries/extension-runtime-ready.query.svelte';
import { extensionWorkstreamQuery } from '../queries/extension-workstream.query.svelte';

export function openRequestedFilesHook(): () => void {
	const opening = new Set<string>();
	const open = async (request: FileOpenRequestedPayload, key: string): Promise<void> => {
		await openRequestedFileCommand(request);
		requestedFilesStore.remove(request);
		opening.delete(key);
	};
	const openReady = (): void => {
		for (const request of requestedFilesStore.readyIn(extensionRuntimeReadyQuery.data)) {
			const key = requestedFileKey(request);
			if (opening.has(key)) continue;
			opening.add(key);
			void open(request, key);
		}
	};
	const stopListening = openedFilesService.onOpenRequested((request) => {
		requestedFilesStore.add(request);
		openReady();
	});
	const stopWatching = $effect.root(() => {
		$effect(() => {
			const active = extensionWorkstreamQuery.data;
			if (active && extensionRuntimeReadyQuery.data(active.id)) untrack(openReady);
		});
	});
	return () => {
		stopListening();
		stopWatching();
	};
}
