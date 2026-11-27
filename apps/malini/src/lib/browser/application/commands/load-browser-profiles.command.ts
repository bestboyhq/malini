import { browserProfilesAggregate } from '../../infrastructure/aggregates/browser-profiles.aggregate.svelte';
import { browserService } from '../../infrastructure/services/browser.service';

export { loadBrowserProfilesCommand };

function loadBrowserProfilesCommand(): void {
	if (browserProfilesAggregate.loaded) return;
	browserProfilesAggregate.loaded = true;
	void (async () => {
		try {
			browserProfilesAggregate.add(await browserService.profiles());
		} catch {
			browserProfilesAggregate.loaded = false;
		}
	})();
}
