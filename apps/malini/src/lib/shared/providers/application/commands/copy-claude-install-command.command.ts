import { toast } from '$hyper-ui/components/toast';
import { clipboardService } from '$shared/system/clipboard.service';

export { copyClaudeInstallCommandCommand };

function copyClaudeInstallCommandCommand(command: string): void {
	void (async () => {
		try {
			await clipboardService.write(command);
		} catch (error: unknown) {
			toast.error(`Could not copy · ${error instanceof Error ? error.message : String(error)}`);
		}
	})();
}
