import { toast } from '$hyper-ui/components/toast';
import { CLAUDE_INSTALL_COMMAND } from '$contract/agent';
import { clipboardService } from '$shared/system/clipboard.service';

export { copyClaudeInstallCommandCommand };

function copyClaudeInstallCommandCommand(): void {
	void (async () => {
		try {
			await clipboardService.write(CLAUDE_INSTALL_COMMAND);
		} catch (error: unknown) {
			toast.error(`Could not copy · ${error instanceof Error ? error.message : String(error)}`);
		}
	})();
}
