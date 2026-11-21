import { openProblemReportCommand } from '$lib/app/application/commands/open-problem-report.command';
import { checkoutProblemDraft } from '$lib/app/domain/problem-report';
import { problemReportStore } from '$lib/app/infrastructure/stores/problem-report.store.svelte';
import { checkoutHealthQuery } from '$shared/repositories/repositories.api';

export function reportCheckoutProblemCommand(workstreamId: string, said: string | null): void {
	openProblemReportCommand();
	problemReportStore.prefill(
		checkoutProblemDraft(checkoutHealthQuery.data(workstreamId).finding, said),
	);
}
