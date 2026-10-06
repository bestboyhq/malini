import { createOpenRunGuard, type OpenRunGuard } from './chat-message-list/open-run-guard.svelte';

export type OpenRunGuardHarness = {
	readonly inFlight: boolean;
	workstreamId: string;
	revalidate(): void;
	stop(): void;
};

export function mountOpenRunGuard(workstreamId: string): OpenRunGuardHarness {
	let scope = $state(workstreamId);
	let revalidations = $state(0);
	let guard: OpenRunGuard | null = null;

	const stop = $effect.root(() => {
		guard = createOpenRunGuard({
			workstreamId: () => scope,
			revalidateOn: () => revalidations,
		});
	});

	return {
		get inFlight(): boolean {
			return guard?.inFlight ?? false;
		},
		get workstreamId(): string {
			return scope;
		},
		set workstreamId(value: string) {
			scope = value;
		},
		revalidate(): void {
			revalidations += 1;
		},
		stop,
	};
}
