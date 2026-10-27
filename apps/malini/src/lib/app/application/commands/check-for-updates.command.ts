import { updatesService } from '$lib/app/infrastructure/services/updates.service';

export function checkForUpdatesCommand(): void {
	void (async () => {
		try {
			await updatesService.check();
		} catch (error) {
			console.error('[malini updates] could not check for updates', error);
		}
	})();
}
