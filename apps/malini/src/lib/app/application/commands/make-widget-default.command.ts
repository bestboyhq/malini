import type { WidgetDefinition } from '$contract/widgets';
import { toast } from '$hyper-ui/components/toast';
import { shipPromptCommand } from '$lib/chat/application/commands/ship-prompt.command';
import { shareWidgetCommand } from '$lib/widgets/application/commands/share-widget.command';
import { sanitizeFailureDetail } from '$shared/errors/failure-copy';

export { makeWidgetDefaultCommand };

function makeWidgetDefaultCommand(
	workstreamId: string,
	widget: WidgetDefinition,
	inNewChat: boolean,
): void {
	void (async () => {
		try {
			await shareWidgetCommand(workstreamId, widget.id);
		} catch (error) {
			const detail = sanitizeFailureDetail(error instanceof Error ? error.message : null);
			toast.error(`Widget not shared${detail ? ` · ${detail}` : ''}.`);
			return;
		}
		shipPromptCommand({
			workstreamId,
			prompt: defaultPrompt(widget),
			subject: 'Widget',
			inNewChat,
		});
	})();
}

function defaultPrompt(widget: WidgetDefinition): string {
	return [
		`Make the "${widget.title}" widget a default for this repository, so every teammate can add it to their board.`,
		`Its file is \`.malini/widgets/${widget.id}.json\` in this checkout.`,
		'Check that it holds no secret, token, personal path or private data.',
		'Then open a draft pull request with it.',
	].join('\n');
}
