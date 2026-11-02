import { externalUrlService } from '$shared/system/external-url.service';

export { openProfilePageCommand };

function openProfilePageCommand(url: string): void {
	void externalUrlService.open(url).catch(() => undefined);
}
