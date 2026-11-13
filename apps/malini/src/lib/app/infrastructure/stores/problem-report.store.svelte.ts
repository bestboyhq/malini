import type { FiledProblem, ProblemReport } from '$contract/system';

class ProblemReportStore {
	open = $state(false);
	report = $state.raw<ProblemReport | null>(null);
	readFailed = $state(false);
	filing = $state(false);
	filed = $state.raw<FiledProblem | null>(null);
	failure = $state<string | null>(null);

	begin(): void {
		this.open = true;
		this.report = null;
		this.readFailed = false;
		this.filing = false;
		this.filed = null;
		this.failure = null;
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
