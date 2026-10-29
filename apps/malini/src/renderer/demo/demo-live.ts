import type { AgentEventEnvelope } from '$contract/agent';
import { runIdForPromptRequest } from '$contract/chat-identity';
import type { ShipButton, ShipStateRecord } from '$contract/pull-requests';
import type { AgentEvent } from '$lib/chat/domain/events';
import type { DemoEmit } from './demo-bridge';
import { sessionEnvelopes, WORKSTREAMS } from './demo-data';

const DEMO_REPLY = [
	'- Changed: nothing, this chat runs in your browser on demo data',
	'- Next: download Malini and send this prompt to your own repository',
	'',
	'Outcome: This is the real Malini interface, running on demo data',
	'Needs: nothing',
].join('\n');

const transcripts = new Map<string, AgentEventEnvelope[]>();

export function transcript(id: string): AgentEventEnvelope[] {
	let envelopes = transcripts.get(id);
	if (!envelopes) {
		envelopes = sessionEnvelopes(id);
		transcripts.set(id, envelopes);
	}
	return envelopes;
}

let runs = 0;

export function sendPrompt(
	emit: DemoEmit,
	id: string,
	prompt: string,
	clientRequestId: string | undefined,
): string {
	const runId = runIdForPromptRequest(clientRequestId) ?? `run-demo-${++runs}`;
	const envelopes = transcript(id);
	const toolCallId = `${runId}-read`;
	const contentId = `${runId}-reply`;
	const steps: [number, AgentEvent][] = [
		[0, { type: 'run.started', runId, sessionId: id }],
		[
			0,
			{
				type: 'user.message',
				runId,
				text: prompt,
				...(clientRequestId ? { clientRequestId } : {}),
			},
		],
		[
			700,
			{ type: 'tool.started', runId, name: 'Read', input: { file_path: 'AGENTS.md' }, toolCallId },
		],
		[900, { type: 'tool.completed', runId, name: 'Read', output: 'ok', toolCallId }],
		...DEMO_REPLY.split(/(?<=\s)/u).map((text): [number, AgentEvent] => [
			24,
			{ type: 'assistant.delta', runId, contentId, text },
		]),
		[200, { type: 'assistant.message', runId, text: DEMO_REPLY, contentId }],
		[0, { type: 'run.completed', runId, summary: '' }],
	];
	let delay = 0;
	for (const [wait, event] of steps) {
		delay += wait;
		setTimeout(() => {
			if (event.type === 'assistant.delta') {
				emit('chat:agent-event', { sessionId: id, runId, seq: -1, event, ephemeral: true });
				return;
			}
			const envelope = { sessionId: id, runId, seq: envelopes.length + 1, event };
			envelopes.push(envelope);
			emit('chat:agent-event', envelope);
		}, delay);
	}
	return runId;
}

const NOW = new Date().toISOString();

const ships = new Map<string, ShipStateRecord>(
	WORKSTREAMS.flatMap((workstream) =>
		workstream.ship ? [[workstream.id, shipState(workstream.id, workstream.ship)] as const] : [],
	),
);

function shipState(
	workstreamId: string,
	ship: Pick<ShipStateRecord, 'phase' | 'step' | 'pullRequestNumber'>,
): ShipStateRecord {
	return {
		workstreamId,
		...ship,
		keep: false,
		pullRequestUrl: `https://github.com/acme/pull/${ship.pullRequestNumber}`,
		needsYou: null,
		queuedAt: ship.phase === 'queued' ? NOW : null,
		attempts: 0,
		activeJobRunId: null,
		lastError: null,
		githubSaid: null,
		failures: 0,
		failedSince: null,
		nextAttemptAt: null,
		updatedAt: NOW,
	};
}

export function shipStates(): ShipStateRecord[] {
	return [...ships.values()];
}

export function shipOf(workstreamId: string): ShipStateRecord | null {
	return ships.get(workstreamId) ?? null;
}

const PULL_REQUEST_NUMBER = 418;

export function clickShipButton(
	emit: DemoEmit,
	workstreamId: string,
	button: ShipButton,
): ShipStateRecord | null {
	const number = ships.get(workstreamId)?.pullRequestNumber ?? PULL_REQUEST_NUMBER;
	const next =
		button === 'draft'
			? shipState(workstreamId, { phase: 'draft', step: null, pullRequestNumber: number })
			: button === 'merge'
				? shipState(workstreamId, {
						phase: 'queued',
						step: 'waiting-for-checks',
						pullRequestNumber: number,
					})
				: null;
	if (next) ships.set(workstreamId, next);
	else ships.delete(workstreamId);
	emit('pull-requests:ship-changed', { workstreamId, state: next });
	return next;
}
