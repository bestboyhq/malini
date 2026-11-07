import type { CheckoutsFolder } from '$contract/repositories';
import { invoke } from '$shared/port/invoke';

class CheckoutsFolderService {
	read(): Promise<CheckoutsFolder> {
		return invoke('repositories.checkouts-folder', undefined);
	}

	choose(): Promise<CheckoutsFolder> {
		return invoke('repositories.choose-checkouts-folder', undefined);
	}

	keep(): Promise<CheckoutsFolder> {
		return invoke('repositories.keep-checkouts-folder', undefined);
	}

	restart(): Promise<void> {
		return invoke('app.relaunch', undefined);
	}
}

export const checkoutsFolderService = new CheckoutsFolderService();
