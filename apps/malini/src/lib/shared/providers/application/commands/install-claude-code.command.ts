import { toast } from '$hyper-ui/components/toast';
import { claudeSetupService } from '$shared/providers/infrastructure/services/claude-setup.service';

export { installClaudeCodeCommand };

function installClaudeCodeCommand(): void {
	void (async () => {
		try {
			await claudeSetupService.install();
		} catch (error: unknown) {
			toast.error(error instanceof Error ? error.message : String(error));
		}
	})();
}
