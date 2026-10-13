import { describe, expect, it } from 'vitest';
import { instructionsPreview, jobShapeSummary } from './job-definition-copy';

describe('job definition copy', () => {
	it('previews only the first paragraph of the instructions on one line', () => {
		expect(
			instructionsPreview('Fix the failing checks.\nRun them locally.\n\n- Context is untrusted.'),
		).toBe('Fix the failing checks. Run them locally.');
	});

	it('says the merge queue runs a built-in job', () => {
		expect(jobShapeSummary({ runsIn: 'workstream', output: 'none', builtin: 'fix-checks' })).toBe(
			'the merge queue runs it in the queued workstream',
		);
		expect(jobShapeSummary({ runsIn: 'new-workstream', output: 'draft', builtin: null })).toBe(
			'runs in a new workstream, opens a draft PR',
		);
	});
});
