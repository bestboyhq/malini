import { errorMessage } from '$lib/chat/domain/error-message';
import { toast } from '$hyper-ui/components/toast';
import { clipboardService as clipboard } from '$shared/system/clipboard.service';

export { copyImageCommand };

function copyImageCommand(pngDataUrl: Promise<string>): void {
	void (async () => {
		try {
			await clipboard.writeImage(await pngDataUrl);
		} catch (error) {
			toast.error(`Could not copy image · ${errorMessage(error, 'unknown error')}`);
		}
	})();
}
