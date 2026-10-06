import type { RepositoryFileTarget } from '$lib/chat/domain/repository-file-target';
import { extensionCommands } from '$shared/extensions/commands.store.svelte';
import { toast } from '$hyper-ui/components/toast';
import { aboutWorkstream } from '$shared/errors/toast-subject';

export const OPEN_REPOSITORY_FILE_COMMAND = 'malini.repository.open-file';

export class RepositoryFileTargetUnavailableError extends Error {}

export class AgentFileMentionExtensionTarget {
	async open(workstreamId: string, target: RepositoryFileTarget): Promise<void> {
		if (!extensionCommands.isReadyFor(workstreamId)) {
			throw new RepositoryFileTargetUnavailableError(
				'The repository extension is not active for this workstream',
			);
		}
		await extensionCommands.execute(workstreamId, OPEN_REPOSITORY_FILE_COMMAND, {
			path: target.path,
			line: target.line,
		});
	}
}

function fileMentionFailureMessage(target: RepositoryFileTarget, cause: unknown): string {
	if (cause instanceof RepositoryFileTargetUnavailableError) {
		return `Could not open ${target.path} · the workstream inspector is still starting`;
	}
	return `Could not open ${target.path} · it is not in this workstream`;
}

export function createAgentFileMentionOpener(): (
	workstreamId: string,
	target: RepositoryFileTarget,
) => void {
	const extensionTarget = new AgentFileMentionExtensionTarget();
	return (workstreamId, target) => {
		void extensionTarget.open(workstreamId, target).catch((cause: unknown) => {
			toast.info(fileMentionFailureMessage(target, cause), aboutWorkstream(workstreamId));
		});
	};
}

export function showMissingFileMention(workstreamId: string, target: RepositoryFileTarget): void {
	toast.info(`No file named ${target.path} in this workstream`, aboutWorkstream(workstreamId));
}
