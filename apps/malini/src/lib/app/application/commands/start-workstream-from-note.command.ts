import { sendFirstPromptCommand } from '$lib/chat/application/commands/send-first-prompt.command';
import {
	createWorkstreamForRepositoryCommand,
	nextWorkstreamId,
	workstreamByIdQuery,
	type Repository,
} from '$shared/repositories/repositories.api';

export { startWorkstreamFromNoteCommand };

function startWorkstreamFromNoteCommand(
	repository: Repository,
	note: Readonly<{ prompt: string; onStarted: () => void }>,
): void {
	const workstreamId = nextWorkstreamId();
	createWorkstreamForRepositoryCommand(repository, { workstreamId, inBackground: true });
	if (workstreamByIdQuery.data(workstreamId) === null) return;
	note.onStarted();
	sendFirstPromptCommand({ workstreamId, prompt: note.prompt });
}
