import {
	router,
	type Navigation,
	type NavigationTarget,
	type NavigationType,
	type Page,
	type RouteParams,
	type PageState,
} from './hash-router.svelte';

export const page: Page = {
	get url(): URL {
		return router.page.url;
	},
	get params(): RouteParams {
		return router.page.params;
	},
	get route(): Readonly<{ id: string | null }> {
		return router.page.route;
	},
	get state(): PageState {
		return router.page.state;
	},
	get status(): number {
		return router.page.status;
	},
	get error(): null {
		return null;
	},
	get data(): Record<string, never> {
		return router.page.data;
	},
	get form(): null {
		return null;
	},
};

export const navigating: Readonly<{
	from: NavigationTarget | null;
	to: NavigationTarget | null;
	type: NavigationType | null;
	willUnload: boolean | null;
	delta: number | null;
	complete: Promise<void> | null;
}> = {
	get from(): NavigationTarget | null {
		return current()?.from ?? null;
	},
	get to(): NavigationTarget | null {
		return current()?.to ?? null;
	},
	get type(): NavigationType | null {
		return current()?.type ?? null;
	},
	get willUnload(): boolean | null {
		return current() ? false : null;
	},
	get delta(): number | null {
		return current()?.delta ?? null;
	},
	get complete(): Promise<void> | null {
		return current()?.complete ?? null;
	},
};

function current(): Navigation | null {
	return router.navigating;
}

export const updated = {
	current: false,
	check: (): Promise<boolean> => Promise.resolve(false),
};
