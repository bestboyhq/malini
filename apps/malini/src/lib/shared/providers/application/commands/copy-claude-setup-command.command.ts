import { toast } from '$hyper-ui/components/toast';
import { CLAUDE_SETUP_COMMANDS, type ClaudeSetupStep } from '$contract/agent';
import { clipboardService } from '$shared/system/clipboard.service';

export { copyClaudeSetupCommandCommand };

function copyClaudeSetupCommandCommand(step: ClaudeSetupStep): void {
	void (async () => {
		try {
			await clipboardService.write(CLAUDE_SETUP_COMMANDS[step]);
		} catch (error: unknown) {
			toast.error(`Could not copy · ${error instanceof Error ? error.message : String(error)}`);
		}
	})();
}
