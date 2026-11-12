import { externalUrlService } from '$shared/system/external-url.service';

export { openBestboyPageCommand };

function openBestboyPageCommand(url: string): void {
	void externalUrlService.open(url).catch(() => undefined);
}
