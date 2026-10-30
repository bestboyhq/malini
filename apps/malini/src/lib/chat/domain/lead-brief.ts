import {
	CONTINUE_AFTER_PAUSE_PROMPT,
	CONTINUE_AFTER_STOP_PROMPT,
	isCancellationError,
} from '$contract/agent-state-machine';
import type { LeadDecision } from '$contract/leads';
import { parseWorkstreamReport, reportedTurnEnd } from './deliveries';

export type BriefEvent = Readonly<{
	seq: number;
	runId: string;
	kind: string;
	payload: unknown;
	at: string;
}>;

type Line = Readonly<{ at: string; text: string }>;

const MALINI_TOOL = 'mcp__malini__';
const QUOTE_CHARS = 400;
const BRIEF_CHARS = 120_000;
const CONTINUATIONS = new Set([CONTINUE_AFTER_PAUSE_PROMPT, CONTINUE_AFTER_STOP_PROMPT]);

export function leadBrief(
	events: readonly BriefEvent[],
	decisions: readonly LeadDecision[],
	workstreamName: (workstreamId: string) => string,
): string | null {
	const lines = [...eventLines(events, workstreamName), ...decisionLines(decisions)]
		.map((line, index) => ({ line, index }))
		.sort((a, b) => a.line.at.localeCompare(b.line.at) || a.index - b.index)
		.map(({ line }) => line);
	const open = decisions.filter((decision) => decision.answer === null);
	if (lines.length === 0 && open.length === 0) return null;
	return [
		'<malini_timeline>',
		"This chat so far, as the user sees it. Malini starts each of your turns fresh from it; tool calls are folded away, and workstreams_list, your plan and your workstreams' checkouts hold the details.",
		...withinBudget(stamped(lines)),
		...(open.length > 0
			? ['', 'Decisions waiting for the user:', ...open.map(openDecisionLine)]
			: []),
		'</malini_timeline>',
	].join('\n');
}

function eventLines(
	events: readonly BriefEvent[],
	workstreamName: (workstreamId: string) => string,
): Line[] {
	const lines: Line[] = [];
	const calls = new Map<string, Readonly<{ name: string; input: unknown; at: string }>>();
	const replies = new Map<string, Line>();
	const flushReply = (runId: string): void => {
		const reply = replies.get(runId);
		if (reply) lines.push(reply);
		replies.delete(runId);
	};
	for (const event of events) {
		const payload = record(event.payload);
		switch (event.kind) {
			case 'user.message': {
				const line = promptLine(payload, event.at, workstreamName);
				if (line) lines.push(line);
				break;
			}
			case 'assistant.message': {
				const text = text_(payload['text']);
				if (text) replies.set(event.runId, { at: event.at, text: `You replied: ${text}` });
				break;
			}
			case 'tool.started': {
				replies.delete(event.runId);
				const name = text_(payload['name']);
				const id = text_(payload['toolCallId']);
				if (name?.startsWith(MALINI_TOOL) && id) {
					calls.set(id, {
						name: name.slice(MALINI_TOOL.length),
						input: payload['input'],
						at: event.at,
					});
				}
				break;
			}
			case 'tool.completed': {
				const id = text_(payload['toolCallId']);
				const call = id === null ? undefined : calls.get(id);
				if (!call) break;
				const line = toolLine(
					call.name,
					record(call.input),
					record(parsedOutput(payload['output'])),
				);
				if (line) lines.push({ at: event.at, text: line });
				break;
			}
			case 'run.completed':
				flushReply(event.runId);
				break;
			case 'run.failed': {
				flushReply(event.runId);
				const line = stopLine(payload);
				if (line) lines.push({ at: event.at, text: line });
				break;
			}
			default:
				break;
		}
	}
	for (const runId of [...replies.keys()]) flushReply(runId);
	return lines;
}

function promptLine(
	payload: Readonly<Record<string, unknown>>,
	at: string,
	workstreamName: (workstreamId: string) => string,
): Line | null {
	const text = text_(payload['text']) ?? '';
	const reports = Array.isArray(payload['reports']) ? payload['reports'].map(record) : [];
	if (reports.length > 0) {
		return {
			at,
			text: reports
				.map((report) => {
					const name = workstreamName(text_(report['workstreamId']) ?? '');
					const ended = reportedTurnEnd(parseWorkstreamReport(report) ?? { status: 'succeeded' });
					return `“${name}” ${ended}. Outcome: ${text_(report['outcome']) ?? 'none'}. Needs: ${text_(report['needs']) ?? 'nothing'}.`;
				})
				.join('\n'),
		};
	}
	if (Array.isArray(payload['decisions']) || CONTINUATIONS.has(text) || text.length === 0) {
		return null;
	}
	return { at, text: `The user: ${text}` };
}

function toolLine(
	tool: string,
	input: Readonly<Record<string, unknown>>,
	output: Readonly<Record<string, unknown>>,
): string | null {
	const name = text_(output['name']) ?? text_(input['workstream']) ?? 'a workstream';
	switch (tool) {
		case 'workstreams_create':
			return `You started “${name}” in ${text_(output['repository']) ?? 'a repository'} (\`${text_(output['id']) ?? '?'}\`): ${quote(input['prompt'])}`;
		case 'workstreams_send':
			return `You sent “${name}”: ${quote(input['prompt'])}`;
		case 'workstreams_archive':
			return `You archived “${name}”.`;
		case 'jobs_run':
			return `You ran ${text_(output['job']) ?? text_(input['job']) ?? 'a job'}${text_(input['workstream']) ? ` in “${text_(input['workstream'])}”` : ''}.`;
		case 'plan_write':
			return 'You rewrote your plan.';
		default:
			return null;
	}
}

function stopLine(payload: Readonly<Record<string, unknown>>): string | null {
	const error = text_(payload['error']) ?? '';
	if (typeof payload['resumeAt'] === 'string') return `Your turn paused: ${error}`;
	if (isCancellationError(error)) return null;
	return `Your turn failed: ${error}`;
}

function decisionLines(decisions: readonly LeadDecision[]): Line[] {
	return decisions.flatMap((decision) => {
		const asked: Line = {
			at: decision.askedAt,
			text:
				decision.answer?.by === 'lead' && decision.answer.at === decision.askedAt
					? `You decided “${decision.topic}” yourself: ${optionLabel(decision, decision.answer.option)}.`
					: `You asked the user “${decision.topic}” (\`${decision.id}\`): ${decision.question}`,
		};
		const { answer } = decision;
		if (!answer || (answer.by === 'lead' && answer.at === decision.askedAt)) return [asked];
		const who = answer.by === 'you' ? 'The user' : 'You, from the user’s message,';
		const why = answer.reason ? ` Why: ${answer.reason}` : '';
		return [
			asked,
			{
				at: answer.at,
				text: `${who} decided “${decision.topic}”: ${optionLabel(decision, answer.option)}.${why}`,
			},
		];
	});
}

function openDecisionLine(decision: LeadDecision): string {
	const options = decision.options
		.map(
			(option, index) =>
				`${index + 1}. ${option.label}${index === decision.recommended ? ' (you recommend it)' : ''}`,
		)
		.join(', ');
	return `- “${decision.topic}” (\`${decision.id}\`): ${decision.question} ${options}.`;
}

function optionLabel(decision: LeadDecision, option: number): string {
	return decision.options[option]?.label ?? `option ${option + 1}`;
}

function stamped(lines: readonly Line[]): string[] {
	let day = '';
	return lines.map(({ at, text }) => {
		const date = new Date(at);
		const today = date.toDateString();
		const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
		const stamp =
			today === day
				? time
				: `${date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
		day = today;
		return `[${stamp}] ${text}`;
	});
}

function withinBudget(lines: readonly string[]): string[] {
	const [first, ...rest] = lines;
	if (first === undefined) return [];
	let used = first.length;
	const kept: string[] = [];
	for (let index = rest.length - 1; index >= 0; index -= 1) {
		const line = rest[index] ?? '';
		if (used + line.length > BRIEF_CHARS) break;
		used += line.length;
		kept.unshift(line);
	}
	const left = rest.length - kept.length;
	return left > 0 ? [first, `[${left} earlier entries left out]`, ...kept] : [first, ...kept];
}

function quote(value: unknown): string {
	const text = (text_(value) ?? '').replaceAll(/\s+/gu, ' ').trim();
	return text.length > QUOTE_CHARS ? `${text.slice(0, QUOTE_CHARS)}…` : text;
}

function parsedOutput(output: unknown): unknown {
	if (typeof output !== 'string') return output;
	try {
		return JSON.parse(output);
	} catch {
		return null;
	}
}

function record(value: unknown): Readonly<Record<string, unknown>> {
	return isFields(value) ? value : {};
}

function isFields(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text_(value: unknown): string | null {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
