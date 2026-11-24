import type { WidgetDefinition } from '$contract/widgets';
import { toast } from '$hyper-ui/components/toast';
import { sendFirstPromptCommand } from '$lib/chat/application/commands/send-first-prompt.command';
import { shareWidgetCommand } from '$lib/widgets/application/commands/share-widget.command';
import { sanitizeFailureDetail } from '$shared/errors/failure-copy';
import {
	createWorkstreamForRepositoryCommand,
	nextWorkstreamId,
	workstreamByIdQuery,
	type Repository,
} from '$shared/repositories/repositories.api';

export { makeWidgetDefaultCommand };

function makeWidgetDefaultCommand(
	repository: Repository,
	from: string,
	widget: WidgetDefinition,
): void {
	const workstreamId = nextWorkstreamId();
	createWorkstreamForRepositoryCommand(repository, { workstreamId, inBackground: true });
	if (workstreamByIdQuery.data(workstreamId) === null) return;
	void (async () => {
		try {
			await shareWidgetCommand(from, widget.id, workstreamId);
		} catch (error) {
			const detail = sanitizeFailureDetail(error instanceof Error ? error.message : null);
			toast.error(`Widget not shared${detail ? ` · ${detail}` : ''}.`);
			return;
		}
		sendFirstPromptCommand({ workstreamId, prompt: defaultPrompt(widget) });
	})();
}

function defaultPrompt(widget: WidgetDefinition): string {
	return [
		`Make the "${widget.title}" widget a default for this repository, so every teammate can add it to their board.`,
		`Its files are in \`.malini/widgets/\`: \`${widget.id}.json\` and the helper files it runs.`,
		'Check that no file holds a secret, a token, a personal path or private data, and that its command runs from a fresh clone.',
		'Then open a draft pull request that adds them.',
	].join('\n');
}
