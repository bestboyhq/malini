import { toast } from '$hyper-ui/components/toast';
import type { ClaudeSetupStep } from '$contract/agent';
import { claudeSetupService } from '$shared/providers/infrastructure/services/claude-setup.service';

export { runClaudeSetupCommand };

function runClaudeSetupCommand(step: ClaudeSetupStep): void {
	void (async () => {
		try {
			await claudeSetupService.run(step);
		} catch (error: unknown) {
			toast.error(error instanceof Error ? error.message : String(error));
		}
	})();
}
