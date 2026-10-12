import {
	commitLineOrSummary,
	pullRequestTitleLine,
	takeLastUnique,
	validationLabel,
} from '$lib/chat/domain/run-evidence';
import type { MaliniDatabase } from '$main/db/driver';
import { all, get, isRecord } from '$main/db/rows';
import type {
	PullRequestAutomationContext,
	PullRequestAutomationEvent,
} from '$shared/repositories/repositories.platform';
import { decodeEvent } from './events.repository';
import { promptPlainText } from './sessions.repository';

const RUN_SUMMARY_LIMIT = 6;
const VALIDATION_EVENT_LIMIT = 12;

const USER_RUNS = `agent_runs r JOIN agent_sessions s ON s.id = r.session_id
	WHERE s.workstream_id = ? AND s.origin = 'user' AND r.automated = 0 AND r.obsoleted_at IS NULL`;

export function workstreamShipContext(
	db: MaliniDatabase,
	workstreamId: string,
): PullRequestAutomationContext {
	const sessionTitle = get<{ display_name: string }>(
		db,
		`SELECT s.display_name FROM agent_sessions s
		 WHERE s.workstream_id = ? AND s.origin = 'user' AND EXISTS (
		   SELECT 1 FROM agent_runs r
		   WHERE r.session_id = s.id AND r.automated = 0 AND r.obsoleted_at IS NULL
		 )
		 ORDER BY s.rowid DESC LIMIT 1`,
		workstreamId,
	)?.display_name;
	const lastPrompt = get<{ prompt: string }>(
		db,
		`SELECT r.prompt FROM ${USER_RUNS} ORDER BY r.rowid DESC LIMIT 1`,
		workstreamId,
	)?.prompt;
	const lastUserIntent =
		lastPrompt === undefined ? '' : promptPlainText(lastPrompt).replace(/\s+/gu, ' ').trim();
	const completed = all<{ id: string; summary: string }>(
		db,
		`SELECT r.id, r.summary FROM ${USER_RUNS}
		   AND r.completed_at IS NOT NULL AND r.error IS NULL AND r.summary IS NOT NULL
		 ORDER BY r.rowid ASC`,
		workstreamId,
	);
	const described = completed
		.map(({ id, summary }) => ({ id, summary: commitLineOrSummary(summary) }))
		.filter(({ summary }) => summary);
	const runSummaries = takeLastUnique(
		described.map(({ summary }) => summary),
		RUN_SUMMARY_LIMIT,
	);
	const latestRunId = described.at(-1)?.id;
	const pullRequestTitle = completed
		.map(({ summary }) => pullRequestTitleLine(summary))
		.filter(Boolean)
		.at(-1);
	const events = validationEvents(
		db,
		completed.slice(-RUN_SUMMARY_LIMIT).map(({ id }) => id),
	);
	return {
		...(sessionTitle ? { sessionTitle } : {}),
		...(lastUserIntent ? { lastUserIntent } : {}),
		...(runSummaries.length > 0 ? { runSummaries } : {}),
		...(latestRunId ? { latestRunId } : {}),
		...(pullRequestTitle ? { pullRequestTitle } : {}),
		...(events.length > 0 ? { events } : {}),
	};
}

function validationEvents(
	db: MaliniDatabase,
	runIds: readonly string[],
): readonly PullRequestAutomationEvent[] {
	if (runIds.length === 0) return [];
	const labels = all<{ event: string }>(
		db,
		`SELECT event FROM agent_events
		 WHERE run_id IN (SELECT value FROM json_each(?)) AND event LIKE 'command.completed' || char(10) || '%'
		 ORDER BY seq ASC`,
		JSON.stringify(runIds),
	).map(({ event }) => passedCommandLabel(decodeEvent(event).payloadJson));
	return takeLastUnique(labels, VALIDATION_EVENT_LIMIT).map((label) => ({
		kind: 'validation',
		label,
		status: 'passed',
	}));
}

function passedCommandLabel(payloadJson: string): string {
	let payload: unknown;
	try {
		payload = JSON.parse(payloadJson);
	} catch {
		return '';
	}
	if (!isRecord(payload) || payload['exitCode'] !== 0 || typeof payload['command'] !== 'string') {
		return '';
	}
	return validationLabel(payload['command']);
}
