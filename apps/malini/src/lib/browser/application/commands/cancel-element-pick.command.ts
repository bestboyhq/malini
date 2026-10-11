import { browserService } from '../../infrastructure/services/browser.service';

export { cancelElementPickCommand };

function cancelElementPickCommand(workstreamId: string): void {
	void (async () => {
		try {
			await browserService.cancelPick(workstreamId);
		} catch {
			return;
		}
	})();
}
