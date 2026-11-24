import { sendFirstPromptCommand } from '$lib/chat/application/commands/send-first-prompt.command';
import {
	createWorkstreamForRepositoryCommand,
	nextWorkstreamId,
	workstreamByIdQuery,
	type Repository,
} from '$shared/repositories/repositories.api';

export { startWidgetWorkstreamCommand };

function startWidgetWorkstreamCommand(repository: Repository, prompt: string): void {
	const workstreamId = nextWorkstreamId();
	createWorkstreamForRepositoryCommand(repository, { workstreamId });
	if (workstreamByIdQuery.data(workstreamId) === null) return;
	sendFirstPromptCommand({ workstreamId, prompt });
}
