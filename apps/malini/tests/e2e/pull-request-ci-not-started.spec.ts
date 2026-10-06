import { expect, test } from '@playwright/test';
import { captureFlow, expectCleanConsole, launchMalini, openWorkstream } from './harness';
import { openPullRequestDetail, seedWorkstreamOnFakeGithub } from './fake-github';

const NOT_STARTED =
	"The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings";

function notStartedCheck(name: string, job: number): Record<string, unknown> {
	return {
		name,
		status: 'COMPLETED',
		conclusion: 'FAILURE',
		startedAt: '2026-10-02T22:11:06Z',
		completedAt: '2026-10-02T22:11:09Z',
		detailsUrl: `https://github.com/e2e/hutch/actions/runs/37071097246/job/${job}`,
		workflowName: 'CI',
		annotations: [
			{
				path: '.github',
				start_line: 1,
				end_line: 1,
				annotation_level: 'failure',
				message: NOT_STARTED,
			},
			{
				path: '.github',
				start_line: 1,
				end_line: 1,
				annotation_level: 'notice',
				message: 'Due to capacity constraints, jobs may experience longer queue times.',
			},
		],
	};
}

test("checks GitHub never started say CI didn't start instead of offering Fix errors", async () => {
	test.setTimeout(120_000);
	const app = await launchMalini();
	try {
		const { page } = await seedWorkstreamOnFakeGithub(app, 'e2e-ci-not-started', {
			mergeable: 'MERGEABLE',
			mergeStateStatus: 'UNSTABLE',
			statusCheckRollup: [
				notStartedCheck('check, lint, test', 111050466288),
				notStartedCheck('app launches on macOS', 111050466505),
			],
		});
		await openWorkstream(page, 'e2e-ci-not-started');

		const status = page.getByRole('button', { name: /^CI didn't start/u });
		await expect(status).toBeVisible({ timeout: 30_000 });
		await expect(page.getByRole('button', { name: 'Fix pull request errors #7' })).toHaveCount(0);
		await status.hover();
		await expect(page.getByRole('tooltip')).toHaveText(
			"GitHub didn't start CI: recent account payments have failed or your spending limit needs to be increased. Open the pull request on GitHub",
		);

		const detail = await openPullRequestDetail(page);
		const checks = detail.getByRole('listitem');
		await expect(checks.filter({ hasText: 'check, lint, test' })).toHaveText(
			/check, lint, test\s*Didn't start$/u,
		);
		await expect(detail).not.toContainText('failing');
		await expect(detail).toContainText("2 didn't start");
		await captureFlow(app, 'pull-request-ci-not-started');
		expectCleanConsole(app);
	} finally {
		await app.close();
	}
});
