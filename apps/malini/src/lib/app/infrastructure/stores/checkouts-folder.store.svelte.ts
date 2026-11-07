import type { CheckoutsFolder } from '$contract/repositories';

class CheckoutsFolderStore {
	folder = $state<CheckoutsFolder | null>(null);
	choosing = $state(false);
}

export const checkoutsFolderStore = new CheckoutsFolderStore();
