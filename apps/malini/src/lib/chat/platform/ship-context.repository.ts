import {
	commitLine,
	pullRequestTitleLine,
	takeLastUnique,
	validationLabel,
} from '$lib/chat/domain/run-evidence';
import { variantDecisions } from '$lib/chat/domain/variant-pick';
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

const WORKSTREAM_RUNS = `agent_runs r JOIN agent_sessions s ON s.id = r.session_id
	WHERE s.workstream_id = ? AND r.obsoleted_at IS NULL`;
const REPLIED = 'r.error IS NULL AND r.summary IS NOT NULL';

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
	const replied = all<{ id: string; summary: string }>(
		db,
		`SELECT r.id, r.summary FROM ${WORKSTREAM_RUNS} AND s.origin = 'user' AND ${REPLIED}
		 ORDER BY r.rowid ASC`,
		workstreamId,
	);
	const described = replied
		.map(({ id, summary }) => ({ id, summary: commitLine(summary) }))
		.filter(({ summary }) => summary);
	const runSummaries = takeLastUnique(
		described.map(({ summary }) => summary),
		RUN_SUMMARY_LIMIT,
	);
	const latestRunId = described.at(-1)?.id;
	const pullRequestTitle = all<{ summary: string }>(
		db,
		`SELECT r.summary FROM ${WORKSTREAM_RUNS} AND ${REPLIED} ORDER BY r.rowid ASC`,
		workstreamId,
	)
		.map(({ summary }) => pullRequestTitleLine(summary))
		.filter(Boolean)
		.at(-1);
	const decisions = variantDecisions(
		all<{ prompt: string; summary: string | null }>(
			db,
			`SELECT r.prompt, CASE WHEN ${REPLIED} THEN r.summary END AS summary
			 FROM ${WORKSTREAM_RUNS} AND s.origin = 'user' ORDER BY r.rowid ASC`,
			workstreamId,
		).map(({ prompt, summary }) => ({ prompt: promptPlainText(prompt), summary })),
	);
	const events = validationEvents(
		db,
		replied.slice(-RUN_SUMMARY_LIMIT).map(({ id }) => id),
	);
	return {
		...(sessionTitle ? { sessionTitle } : {}),
		...(runSummaries.length > 0 ? { runSummaries } : {}),
		...(latestRunId ? { latestRunId } : {}),
		...(pullRequestTitle ? { pullRequestTitle } : {}),
		...(events.length > 0 ? { events } : {}),
		...(decisions.length > 0 ? { decisions } : {}),
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
