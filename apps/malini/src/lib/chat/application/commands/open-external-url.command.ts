import { externalUrlService } from '$shared/system/external-url.service';

export { openExternalUrlCommand };

function openExternalUrlCommand(url: string): void {
	void externalUrlService.open(url).catch(() => undefined);
}
