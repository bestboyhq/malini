import { toast } from '$hyper-ui/components/toast';
import { clipboardService } from '$shared/system/clipboard.service';

export { copyShareCardCommand };

function copyShareCardCommand(pngDataUrl: Promise<string>): void {
	void (async () => {
		try {
			await clipboardService.writeImage(await pngDataUrl);
			toast.success('Card copied');
		} catch (error) {
			toast.error(
				`Could not copy the card · ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	})();
}
