import type { FiledProblem, ProblemReport } from '$contract/system';
import type { ProblemDraft } from '$lib/app/domain/problem-report';
import { problemReportStore } from '$lib/app/infrastructure/stores/problem-report.store.svelte';

type ProblemReportState = Readonly<{
	open: boolean;
	report: ProblemReport | null;
	readFailed: boolean;
	filing: boolean;
	filed: FiledProblem | null;
	failure: string | null;
	draft: ProblemDraft;
}>;

class ProblemReportQuery {
	public readonly data: ProblemReportState = $derived({
		open: problemReportStore.open,
		report: problemReportStore.report,
		readFailed: problemReportStore.readFailed,
		filing: problemReportStore.filing,
		filed: problemReportStore.filed,
		failure: problemReportStore.failure,
		draft: problemReportStore.draft,
	});
}

export const problemReportQuery = new ProblemReportQuery();
