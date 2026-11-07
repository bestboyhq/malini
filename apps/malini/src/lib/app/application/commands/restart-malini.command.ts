import { checkoutsFolderService } from '$lib/app/infrastructure/services/checkouts-folder.service';

export function restartMaliniCommand(): void {
	checkoutsFolderService.restart().catch((error: unknown) => {
		console.error('[malini app] could not restart Malini', error);
	});
}
