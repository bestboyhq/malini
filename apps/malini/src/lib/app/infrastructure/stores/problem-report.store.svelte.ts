import type { FiledProblem, ProblemReport } from '$contract/system';
import { EMPTY_PROBLEM_DRAFT, type ProblemDraft } from '$lib/app/domain/problem-report';

class ProblemReportStore {
	open = $state(false);
	report = $state.raw<ProblemReport | null>(null);
	readFailed = $state(false);
	filing = $state(false);
	filed = $state.raw<FiledProblem | null>(null);
	failure = $state<string | null>(null);
	draft = $state.raw<ProblemDraft>(EMPTY_PROBLEM_DRAFT);

	begin(): void {
		this.open = true;
		this.draft = EMPTY_PROBLEM_DRAFT;
		this.report = null;
		this.readFailed = false;
		this.filing = false;
		this.filed = null;
		this.failure = null;
	}

	prefill(draft: ProblemDraft): void {
		this.draft = draft;
	}

	setReport(report: ProblemReport): void {
		this.report = report;
	}

	failRead(): void {
		this.readFailed = true;
	}

	dismiss(): void {
		if (!this.filing) this.open = false;
	}

	beginFiling(): void {
		this.filing = true;
		this.failure = null;
	}

	setFiled(filed: FiledProblem): void {
		this.filing = false;
		this.filed = filed;
	}

	fail(failure: string): void {
		this.filing = false;
		this.failure = failure;
	}
}

export const problemReportStore = new ProblemReportStore();
