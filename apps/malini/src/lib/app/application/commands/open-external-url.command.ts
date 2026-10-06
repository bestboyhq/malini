import { externalUrlService } from '$shared/system/external-url.service';

export function openExternalUrlCommand(url: string): void {
	void externalUrlService.open(url).catch(() => undefined);
}
