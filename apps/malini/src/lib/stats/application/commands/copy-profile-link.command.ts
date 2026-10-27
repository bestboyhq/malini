import { toast } from '$hyper-ui/components/toast';
import { clipboardService } from '$shared/system/clipboard.service';

export { copyProfileLinkCommand };

function copyProfileLinkCommand(url: string): void {
	void (async () => {
		try {
			await clipboardService.write(url);
			toast.success('Profile link copied');
		} catch (error) {
			toast.error(
				`Could not copy the link · ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	})();
}
