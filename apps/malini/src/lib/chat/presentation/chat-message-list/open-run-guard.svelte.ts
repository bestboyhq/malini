import { checkOpenRunCommand } from '$lib/chat/application/commands/check-open-run.command';
import { workstreamHasOpenRunQuery } from '$lib/chat/application/queries/workstream-has-open-run.query.svelte';

export type OpenRunGuard = {
	readonly inFlight: boolean;
};

export function createOpenRunGuard(input: {
	workstreamId(): string;
	revalidateOn(): unknown;
}): OpenRunGuard {
	const hasOpenRun = $derived(workstreamHasOpenRunQuery.data);

	$effect(() => {
		const scope = input.workstreamId();
		input.revalidateOn();
		checkOpenRunCommand(scope);
	});

	return {
		get inFlight(): boolean {
			return hasOpenRun(input.workstreamId());
		},
	};
}
