import { localDate } from '$lib/stats/domain/activity';

const MOMENTS_KEY = 'malini.stats.moments';

type SavedMoments = Readonly<{ on: boolean; dismissedOn: string | null }>;

class MomentsStore {
	on: boolean = $state(true);
	dismissedOn: string | null = $state(null);

	hydrate(): void {
		const saved = read();
		this.on = saved.on;
		this.dismissedOn = saved.dismissedOn;
		this.#save();
	}

	dismiss(): void {
		this.dismissedOn = localDate(new Date());
		this.#save();
	}

	switch(on: boolean): void {
		this.on = on;
		this.#save();
	}

	#save(): void {
		try {
			globalThis.localStorage?.setItem(
				MOMENTS_KEY,
				JSON.stringify({ on: this.on, dismissedOn: this.dismissedOn }),
			);
		} catch {}
	}
}

function read(): SavedMoments {
	try {
		const saved: unknown = JSON.parse(globalThis.localStorage?.getItem(MOMENTS_KEY) ?? 'null');
		if (typeof saved !== 'object' || saved === null) return { on: true, dismissedOn: null };
		const on: unknown = Reflect.get(saved, 'on');
		const dismissedOn: unknown = Reflect.get(saved, 'dismissedOn');
		const dismissedBefore: unknown = Reflect.get(saved, 'dismissed');
		return {
			on: on !== false,
			dismissedOn:
				typeof dismissedOn === 'string'
					? dismissedOn
					: Array.isArray(dismissedBefore) && dismissedBefore.length > 0
						? localDate(new Date())
						: null,
		};
	} catch {
		return { on: true, dismissedOn: null };
	}
}

export const momentsStore = new MomentsStore();
