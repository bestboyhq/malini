import {
	indexFileMentionPaths,
	resolveFileMention,
	type FileMentionIndex,
} from '$lib/chat/domain/file-mention-index';
import type { RepositoryFileTarget } from '$lib/chat/domain/repository-file-target';
import { workstreamFilesAggregate } from '$lib/chat/infrastructure/aggregates/workstream-files.aggregate.svelte';
import {
	createAgentFileMentionOpener,
	showMissingFileMention,
} from '$lib/chat/infrastructure/services/agent-file-mention-target.service';
import { workstreamFiles } from '$lib/chat/infrastructure/services/workstream-files.service';

export { openFileMentionHook };

function openFileMentionHook(
	workstreamId: () => string,
): (
	target: RepositoryFileTarget,
	choose: (targets: readonly RepositoryFileTarget[]) => void,
) => void {
	const open = createAgentFileMentionOpener();
	return (target, choose) => {
		const mentionWorkstreamId = workstreamId();
		void (async () => {
			const index = await fileMentionIndex(mentionWorkstreamId);
			const targets = index ? resolveFileMention(index, target) : [target];
			const [only, ...others] = targets;
			if (only === undefined) showMissingFileMention(mentionWorkstreamId, target);
			else if (others.length === 0) open(mentionWorkstreamId, only);
			else choose(targets);
		})();
	};
}

async function fileMentionIndex(workstreamId: string): Promise<FileMentionIndex | null> {
	const listing = workstreamFilesAggregate.listing;
	if (listing?.workstreamId === workstreamId && listing.status === 'ready') {
		return indexFileMentionPaths(listing.files.map(({ path }) => path));
	}
	try {
		const files = await workstreamFiles.list(workstreamId);
		return indexFileMentionPaths(files.map(({ path }) => path));
	} catch {
		return null;
	}
}
