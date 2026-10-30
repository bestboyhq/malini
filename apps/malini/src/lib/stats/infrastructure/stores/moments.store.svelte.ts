const MOMENTS_KEY = 'malini.stats.moments';
const KEPT_DISMISSALS = 50;

type SavedMoments = Readonly<{ on: boolean; dismissed: readonly string[] }>;

class MomentsStore {
	on: boolean = $state(true);
	dismissed: readonly string[] = $state([]);

	hydrate(): void {
		const saved = read();
		this.on = saved.on;
		this.dismissed = saved.dismissed;
	}

	dismiss(id: string): void {
		this.dismissed = [...this.dismissed.filter((kept) => kept !== id), id].slice(-KEPT_DISMISSALS);
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
				JSON.stringify({ on: this.on, dismissed: this.dismissed }),
			);
		} catch {}
	}
}

function read(): SavedMoments {
	try {
		const saved: unknown = JSON.parse(globalThis.localStorage?.getItem(MOMENTS_KEY) ?? 'null');
		if (typeof saved !== 'object' || saved === null) return { on: true, dismissed: [] };
		const on: unknown = Reflect.get(saved, 'on');
		const dismissed: unknown = Reflect.get(saved, 'dismissed');
		return {
			on: on !== false,
			dismissed: Array.isArray(dismissed)
				? dismissed.filter((id): id is string => typeof id === 'string')
				: [],
		};
	} catch {
		return { on: true, dismissed: [] };
	}
}

export const momentsStore = new MomentsStore();
