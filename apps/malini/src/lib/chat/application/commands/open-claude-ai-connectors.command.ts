import { toast } from '$hyper-ui/components/toast';
import { CLAUDE_AI_CONNECTORS_URL } from '$lib/chat/domain/mcp-server';
import { errorMessage } from '$lib/chat/domain/error-message';
import { externalUrlService } from '$shared/system/external-url.service';

export { openClaudeAiConnectorsCommand };

function openClaudeAiConnectorsCommand(): void {
	void (async () => {
		try {
			await externalUrlService.open(CLAUDE_AI_CONNECTORS_URL);
		} catch (error) {
			toast.error(`Could not open claude.ai · ${errorMessage(error, 'unknown error')}`);
		}
	})();
}
