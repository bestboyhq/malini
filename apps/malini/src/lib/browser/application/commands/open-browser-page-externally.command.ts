import { externalUrlService } from '$shared/system/external-url.service';

export { openBrowserPageExternallyCommand };

const WEB_PAGE = /^https?:\/\//i;

function openBrowserPageExternallyCommand(url: string): void {
	if (!WEB_PAGE.test(url)) return;
	void (async () => {
		try {
			await externalUrlService.open(url);
		} catch {
			return;
		}
	})();
}
