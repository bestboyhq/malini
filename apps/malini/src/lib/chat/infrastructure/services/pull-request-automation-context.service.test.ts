import { describe, expect, it } from 'vitest';
import {
	AUTOMATION_INPUT_STRING_LIMIT,
	automatedPullRequestMetadata,
} from '@malini-extension/repository';
import type { AgentEvent } from '$lib/chat/domain/events';
import type { SessionRecord } from '$lib/chat/domain/session-record';
import { pullRequestAutomationEvidence } from './pull-request-automation-context.service';

describe('pullRequestAutomationEvidence', () => {
	it('uses the requested workstream-owned session and only successful durable evidence', () => {
		const events: AgentEvent[] = [
			{ type: 'user.message', runId: 'run-1', text: 'First request' },
			{ type: 'file.changed', runId: 'run-1', path: 'src/z.ts' },
			{ type: 'command.completed', runId: 'run-1', command: 'pnpm test', exitCode: 0 },
			{ type: 'command.completed', runId: 'run-1', command: 'pnpm lint', exitCode: 1 },
			{ type: 'command.completed', runId: 'run-1', command: 'git status', exitCode: 0 },
			{ type: 'run.completed', runId: 'run-1', summary: 'Implemented the first pass.' },
			{ type: 'user.message', runId: 'run-2', text: 'Keep the workflow inside malini' },
			{ type: 'file.changed', runId: 'run-2', path: 'src/a.ts' },
			{ type: 'file.changed', runId: 'run-2', path: 'src/z.ts' },
			{ type: 'command.completed', runId: 'run-2', command: 'pnpm check', exitCode: 0 },
			{ type: 'run.completed', runId: 'run-2', summary: 'Finished the internal workflow.' },
			{ type: 'assistant.message', runId: 'run-2', text: 'Untrusted assistant prose' },
		];

		expect(
			pullRequestAutomationEvidence({
				workstreamId: 'workstream-a',
				requestedSessionId: 'session-a',
				sessions: [session('session-a', 'workstream-a', 'PR workflow', '2026-01-01')],
				eventsFor: () => events,
			}),
		).toEqual({
			context: {
				sessionTitle: 'PR workflow',
				lastUserIntent: 'Keep the workflow inside malini',
				runSummaries: ['Implemented the first pass.', 'Finished the internal workflow.'],
				latestRunId: 'run-2',
				events: [
					{ kind: 'validation', label: 'pnpm test', status: 'passed' },
					{ kind: 'validation', label: 'pnpm check', status: 'passed' },
				],
			},
			changedPaths: ['src/a.ts', 'src/z.ts'],
		});
	});

	it('never adopts a requested session from another workstream and falls back deterministically', () => {
		const selectedIds: string[] = [];
		const evidence = pullRequestAutomationEvidence({
			workstreamId: 'workstream-a',
			requestedSessionId: 'session-foreign',
			sessions: [
				session('session-foreign', 'workstream-b', 'Foreign', '2026-01-03'),
				session('session-older', 'workstream-a', 'Older', '2026-01-01'),
				session('session-newer', 'workstream-a', 'Newer', '2026-01-02'),
			],
			eventsFor: (sessionId) => {
				selectedIds.push(sessionId);
				return [{ type: 'user.message', runId: 'run-1', text: sessionId }];
			},
		});

		expect(selectedIds).toEqual(['session-newer']);
		expect(evidence.context).toMatchObject({
			sessionTitle: 'Newer',
			lastUserIntent: 'session-newer',
		});
	});

	it('takes the commit line the agent ends its reply with as the run summary', () => {
		const evidence = pullRequestAutomationEvidence({
			workstreamId: 'workstream-a',
			requestedSessionId: null,
			sessions: [session('session-a', 'workstream-a', 'Clone over SSH', '2026-01-01')],
			eventsFor: () => [
				{
					type: 'run.completed',
					runId: 'run-1',
					summary:
						'Commit: lines can be quoted mid-reply.\n\nCheck and lint pass.\n\nCommit: fix(repositories): accept SSH clone URLs\n',
				},
				{
					type: 'run.completed',
					runId: 'run-2',
					summary: 'Kept the placeholder. Commit: `fix(repositories): keep the https hint`',
				},
				{ type: 'run.completed', runId: 'run-3', summary: 'Answered a question.' },
			],
		});

		expect(evidence.context?.runSummaries).toEqual([
			'fix(repositories): accept SSH clone URLs',
			'`fix(repositories): keep the https hint`',
			'Answered a question.',
		]);
		expect(evidence.context?.latestRunId).toBe('run-3');
	});

	it('reads the branch title the latest run that named one ends with, apart from its commit line', () => {
		const evidence = (summary: string) =>
			pullRequestAutomationEvidence({
				workstreamId: 'workstream-a',
				requestedSessionId: null,
				sessions: [session('session-a', 'workstream-a', 'Clone over SSH', '2026-01-01')],
				eventsFor: () => [
					{
						type: 'run.completed',
						runId: 'run-1',
						summary:
							'Done. Commit: fix(clone): first half Pull request: feat(clone): an earlier branch title',
					},
					{ type: 'run.completed', runId: 'run-2', summary },
				],
			}).context;

		expect(
			evidence(
				'Check passes.\n\nCommit: fix(repositories): accept SSH clone URLs\nPull request: feat(repositories): clone over SSH and HTTPS\n',
			),
		).toMatchObject({
			runSummaries: ['fix(clone): first half', 'fix(repositories): accept SSH clone URLs'],
			pullRequestTitle: 'feat(repositories): clone over SSH and HTTPS',
		});
		expect(
			evidence(
				'Check passes. Pull request: feat(repositories): clone over SSH and HTTPS Commit: fix(repositories): accept SSH clone URLs',
			),
		).toMatchObject({
			runSummaries: ['fix(clone): first half', 'fix(repositories): accept SSH clone URLs'],
			pullRequestTitle: 'feat(repositories): clone over SSH and HTTPS',
		});
		const withoutBranchTitle = evidence('Check passes. Commit: fix(repositories): accept SSH');
		expect(withoutBranchTitle?.runSummaries?.at(-1)).toBe('fix(repositories): accept SSH');
		expect(withoutBranchTitle?.pullRequestTitle).toBe('feat(clone): an earlier branch title');
		expect(
			evidence(
				'Renamed it. Commit: fix(review): rename the helper Resolved: PRRT_one Pull request: feat(review): tidy helpers Resolved: PRRT_two',
			),
		).toMatchObject({
			runSummaries: ['fix(clone): first half', 'fix(review): rename the helper'],
			pullRequestTitle: 'feat(review): tidy helpers',
		});
	});

	it('bounds every text it hands the repository extension to the limit the extension accepts', () => {
		const long = 'x '.repeat(AUTOMATION_INPUT_STRING_LIMIT + 2_000);
		const evidence = pullRequestAutomationEvidence({
			workstreamId: 'workstream-a',
			requestedSessionId: 'session-a',
			sessions: [session('session-a', 'workstream-a', 'Fix errors', '2026-01-01')],
			eventsFor: () => [
				{ type: 'user.message', runId: 'run-1', text: long },
				{ type: 'run.completed', runId: 'run-1', summary: long },
			],
		});

		expect(Array.from(evidence.context?.lastUserIntent ?? '')).toHaveLength(
			AUTOMATION_INPUT_STRING_LIMIT,
		);
		expect(evidence.context?.runSummaries?.map((summary) => Array.from(summary).length)).toEqual([
			AUTOMATION_INPUT_STRING_LIMIT,
		]);
	});

	it('never takes a bare acknowledgement as the run summary when no Commit line exists', () => {
		const evidenceFor = (summary: string) =>
			pullRequestAutomationEvidence({
				workstreamId: 'workstream-a',
				requestedSessionId: null,
				sessions: [session('session-a', 'workstream-a', 'Scratch', '2026-01-01')],
				eventsFor: () => [
					{ type: 'user.message', runId: 'run-1', text: 'Create notes/scratch.txt with hello' },
					{ type: 'file.changed', runId: 'run-1', path: 'notes/scratch.txt' },
					{ type: 'run.completed', runId: 'run-1', summary },
				],
			});

		for (const summary of [
			'done',
			'Done.',
			'OK',
			'Finished!',
			'Fixed it.',
			'All done here.',
			'Task completed successfully.',
			'I’ve finished the task. Let me know if you need anything else.',
		]) {
			const evidence = evidenceFor(summary);
			expect(evidence.context, summary).not.toHaveProperty('runSummaries');
			expect(evidence.context, summary).not.toHaveProperty('latestRunId');
			expect(
				automatedPullRequestMetadata({
					branch: 'malini/scratch',
					baseBranch: 'main',
					changedPaths: evidence.changedPaths ?? [],
					...(evidence.context ? { context: evidence.context } : {}),
				}).commitMessage,
				summary,
			).toBe('Create notes/scratch.txt with hello');
		}

		expect(evidenceFor('Wrote hello into notes/scratch.txt.').context?.runSummaries).toEqual([
			'Wrote hello into notes/scratch.txt.',
		]);
		expect(evidenceFor('done\n\nCommit: Fix typo').context?.runSummaries).toEqual(['Fix typo']);
	});

	it('falls back to the changed paths when a bare reply follows no prompt', () => {
		const evidence = pullRequestAutomationEvidence({
			workstreamId: 'workstream-a',
			requestedSessionId: null,
			sessions: [session('session-a', 'workstream-a', 'New chat', '2026-01-01')],
			eventsFor: () => [
				{ type: 'file.changed', runId: 'run-1', path: 'notes/scratch.txt' },
				{ type: 'run.completed', runId: 'run-1', summary: 'Done' },
			],
		});

		expect(
			automatedPullRequestMetadata({
				branch: 'malini/scratch',
				baseBranch: 'main',
				changedPaths: evidence.changedPaths ?? [],
				...(evidence.context ? { context: evidence.context } : {}),
			}).commitMessage,
		).toBe('Update scratch');
	});

	it('returns no synthetic context when the workstream has no session', () => {
		expect(
			pullRequestAutomationEvidence({
				workstreamId: 'workstream-a',
				requestedSessionId: null,
				sessions: [session('session-b', 'workstream-b', 'Foreign', '2026-01-01')],
				eventsFor: () => [],
			}),
		).toEqual({});
	});
});

function session(
	id: string,
	workstreamId: string,
	displayName: string,
	startedAt: string,
): SessionRecord {
	return {
		id,
		workstreamId,
		displayName,
		model: null,
		status: 'completed',
		currentRunId: null,
		lastError: null,
		startedAt,
	};
}
