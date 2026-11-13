import type { FiledProblem, ProblemReport } from '$contract/system';
import { invoke } from '$shared/port/invoke';

class ProblemReportService {
	read(): Promise<ProblemReport> {
		return invoke('app.problem-report', undefined);
	}

	file(text: string, facts: readonly string[]): Promise<FiledProblem> {
		return invoke('app.report-problem', { text, facts });
	}
}

export const problemReportService = new ProblemReportService();
