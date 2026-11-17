import type { FiledProblem, ProblemReport } from '$contract/system';
import type { MainContext } from '$main/context';
import { readDiagnostics } from '$main/diagnostics/diagnostics-files';
import { GhError } from '$main/errors';
import { runGhChecked, type GhResult } from '$main/process/gh';
import { listRunFacts } from '$lib/chat/chat.platform';
import { listRepositoryCatalog } from '$shared/repositories/repositories.platform';
import {
	ISSUES_REPOSITORY,
	PROBLEM_FACT_LIMIT,
	PROBLEM_FACTS_MAX,
	PROBLEM_TEXT_LIMIT,
	failureLine,
	issueNumber,
	journeyLine,
	problemBody,
	problemTitle,
} from '../domain/problem-report';
import { currentSystemLabel } from './system-label';
import { isPromptRun, userWorkstreams } from './usage-report';

export type IssueRunner = (args: readonly string[]) => Promise<GhResult>;

const FAILURE_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export async function readProblemReport(context: MainContext, now: Date): Promise<ProblemReport> {
	const lastFailure = readDiagnostics(context.appDataRoot, {
		minimumLevel: 'warn',
		since: new Date(now.getTime() - FAILURE_LOOKBACK_MS),
	})
		.filter((entry) => entry.process === 'main' && entry.command !== null)
		.at(-1);
	return {
		repository: ISSUES_REPOSITORY,
		system: `Malini ${context.appVersion} · ${currentSystemLabel()}`,
		journey: journeyLine({
			repositories: (await listRepositoryCatalog(context.db)).length,
			prompts: listRunFacts(context.db, now.toISOString()).filter(isPromptRun).length,
			merges: userWorkstreams(context.db).filter(({ merged }) => merged).length,
		}),
		lastError:
			lastFailure?.command == null
				? null
				: failureLine(lastFailure.command, lastFailure.errorName, lastFailure.code),
	};
}

export async function reportProblem(
	args: unknown,
	run: IssueRunner = runGhChecked,
): Promise<FiledProblem> {
	const { text, facts } = problemArgs(args);
	const created = await run([
		'issue',
		'create',
		'--repo',
		ISSUES_REPOSITORY,
		'--title',
		problemTitle(text),
		'--body',
		problemBody(text, facts),
	]);
	const url = created.stdout.trim().split('\n').at(-1)?.trim() ?? '';
	const number = issueNumber(url);
	if (number === null) throw new GhError('failed', `gh printed no issue link: ${url}`);
	return { number, url };
}

function problemArgs(args: unknown): { text: string; facts: readonly string[] } {
	const text: unknown =
		typeof args === 'object' && args !== null ? Reflect.get(args, 'text') : null;
	const facts: unknown =
		typeof args === 'object' && args !== null ? Reflect.get(args, 'facts') : null;
	if (typeof text !== 'string' || problemTitle(text) === '') {
		throw new Error('text must say what happened');
	}
	if (text.length > PROBLEM_TEXT_LIMIT) {
		throw new Error(`text must be at most ${PROBLEM_TEXT_LIMIT} characters`);
	}
	if (
		!Array.isArray(facts) ||
		facts.length > PROBLEM_FACTS_MAX ||
		!facts.every(
			(fact): fact is string => typeof fact === 'string' && fact.length <= PROBLEM_FACT_LIMIT,
		)
	) {
		throw new Error(`facts must be at most ${PROBLEM_FACTS_MAX} short lines`);
	}
	return { text, facts };
}
