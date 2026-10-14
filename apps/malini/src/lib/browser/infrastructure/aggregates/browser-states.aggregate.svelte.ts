import type { BrowserState } from '$contract/browser';

class BrowserStatesAggregate {
	byWorkstream: Readonly<Record<string, BrowserState>> = $state.raw({});
	readonly #leaving = new Map<string, string>();

	accept(state: BrowserState): void {
		const current = this.byWorkstream[state.workstreamId];
		const stillLeaving =
			current !== undefined && state.loading && this.#leaving.get(state.workstreamId) === state.url;
		if (!stillLeaving) this.#leaving.delete(state.workstreamId);
		this.#write(stillLeaving ? { ...state, url: current.url } : state);
	}

	expect(workstreamId: string, url: string): void {
		const current = this.byWorkstream[workstreamId];
		this.#leaving.set(workstreamId, current?.url ?? '');
		this.#write({
			workstreamId,
			url,
			title: current?.title ?? '',
			loading: true,
			canGoBack: current?.canGoBack ?? false,
			canGoForward: current?.canGoForward ?? false,
		});
	}

	forget(workstreamId: string): void {
		this.#leaving.delete(workstreamId);
		const { [workstreamId]: _forgotten, ...rest } = this.byWorkstream;
		this.byWorkstream = rest;
	}

	#write(state: BrowserState): void {
		this.byWorkstream = { ...this.byWorkstream, [state.workstreamId]: state };
	}
}

export const browserStatesAggregate = new BrowserStatesAggregate();
