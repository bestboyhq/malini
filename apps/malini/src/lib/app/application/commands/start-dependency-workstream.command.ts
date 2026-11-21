import type { Initiative, InitiativeDependency } from '$contract/initiatives';
import { sendFirstPromptCommand } from '$lib/chat/application/commands/send-first-prompt.command';
import { linkInitiativeWorkstreamCommand } from '$lib/initiatives/application/commands/link-initiative-workstream.command';
import {
	createWorkstreamForRepositoryCommand,
	nextWorkstreamId,
	workstreamByIdQuery,
	type Repository,
} from '$shared/repositories/repositories.api';

export { startDependencyWorkstreamCommand };

function startDependencyWorkstreamCommand(
	initiative: Initiative,
	dependency: InitiativeDependency,
	repository: Repository,
): void {
	const workstreamId = nextWorkstreamId();
	createWorkstreamForRepositoryCommand(repository, { workstreamId, inBackground: true });
	if (workstreamByIdQuery.data(workstreamId) === null) return;
	linkInitiativeWorkstreamCommand(dependency.id, workstreamId);
	const due = initiative.dueOn ? `, due ${dayLabel(initiative.dueOn)}` : '';
	sendFirstPromptCommand({
		workstreamId,
		prompt: `${dependency.title}\n\nIt is one dependency of the initiative "${initiative.title}"${due}.`,
	});
}

function dayLabel(day: string): string {
	const [year = 0, month = 1, dayOfMonth = 1] = day.split('-').map(Number);
	const date = new Date(year, month - 1, dayOfMonth);
	const weekday = date.toLocaleString('en-US', { weekday: 'short' });
	return `${weekday} ${dayOfMonth} ${date.toLocaleString('en-US', { month: 'short' })}`;
}
