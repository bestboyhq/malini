import { externalUrlService } from '$shared/system/external-url.service';

export { openKeyPageCommand };

function openKeyPageCommand(url: string): void {
	void externalUrlService.open(url).catch(() => undefined);
}
