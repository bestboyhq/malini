const STORAGE_KEY = 'malini.jobs.center-variant';
const VARIANTS = ['pill', 'docked', 'stack'] as const;

// ponytail: three Job center looks behind a localStorage key until the user picks one; then delete this store and the two losing variants.
class JobCenterVariantStore {
	variant = $state<(typeof VARIANTS)[number]>('pill');

	hydrate(): void {
		let stored: string | null = null;
		try {
			stored = globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
		} catch {}
		this.variant = VARIANTS.find((variant) => variant === stored) ?? 'pill';
	}
}

export const jobCenterVariantStore = new JobCenterVariantStore();
