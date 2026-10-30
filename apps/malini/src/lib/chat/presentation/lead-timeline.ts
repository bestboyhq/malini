import {
	BRIDGE_INTERRUPTED_ERROR,
	CONTINUE_AFTER_PAUSE_PROMPT,
	CONTINUE_AFTER_STOP_PROMPT,
	ORPHAN_INTERRUPTED_ERROR,
} from '$contract/agent-state-machine';
import type { WorkstreamReportMedia } from '$contract/deliveries';
import type { LeadDecision } from '$contract/leads';
import { Lexer } from 'marked';
import { REPORTS_PREAMBLE } from '$lib/chat/domain/deliveries';
import type { RenderItem, RunGroup, ToolAggregate } from './render-state';
import { toolActionKind, toolActivityLabel, toolDescriptionLabel } from './tool-display-name';

type Timed = Readonly<{ key: string; at: number | null; current: boolean }>;

export type TimelineReport = Readonly<{
	key: string;
	workstreamId: string | null;
	name: string | null;
	status: 'succeeded' | 'failed';
	outcome: string | null;
	needs: string | null;
	media: readonly WorkstreamReportMedia[];
	backgroundCommands?: readonly string[];
}>;

export type TimelineSent = Timed &
	Readonly<{
		kind: 'sent';
		workstreamId: string | null;
		name: string;
		prompt: string;
		deliveryId: string | null;
		delivered: boolean;
	}>;

export type TimelineEntry =
	| (Timed & Readonly<{ kind: 'prompt'; text: string }>)
	| (Timed & Readonly<{ kind: 'reports'; reports: readonly TimelineReport[] }>)
	| (Timed & Readonly<{ kind: 'notice'; text: string }>)
	| (Timed &
			Readonly<{
				kind: 'work';
				verb: string;
				steps: readonly string[];
				endAt: number | null;
				running: boolean;
			}>)
	| (Timed &
			Readonly<{
				kind: 'started';
				workstreams: readonly Readonly<{ id: string; prompt: string }>[];
			}>)
	| TimelineSent
	| (Timed & Readonly<{ kind: 'archived'; workstreamId: string | null; name: string }>)
	| (Timed & Readonly<{ kind: 'job'; job: string; workstream: string | null }>)
	| (Timed & Readonly<{ kind: 'plan' }>)
	| (Timed & Readonly<{ kind: 'decided'; decision: LeadDecision }>)
	| (Timed & Readonly<{ kind: 'approval'; item: Approval }>)
	| (Timed & Readonly<{ kind: 'reply'; runId: string; text: string; latest: boolean }>)
	| (Timed &
			Readonly<{
				kind: 'stopped';
				terminal: 'paused' | 'closed' | 'failed';
				text: string;
				resumeAt: string | null;
			}>);

type Tool = Extract<RenderItem, { kind: 'tool' }>;
type Approval = Extract<RenderItem, { kind: 'approval' }>;

const MALINI_TOOL = 'mcp__malini__';
const CONTINUATIONS = new Set([CONTINUE_AFTER_PAUSE_PROMPT, CONTINUE_AFTER_STOP_PROMPT]);
const SILENT_TOOLS = new Set(['decisions_ask', 'decisions_answer']);
const CLOSED_ERRORS = new Set([ORPHAN_INTERRUPTED_ERROR, BRIDGE_INTERRUPTED_ERROR]);
const LEGACY_WAKE = 'Malini woke you';
const LEGACY_REPORT = /^“(.+)”, a workstream you started, (finished a turn|failed its turn)\.$/u;

export function leadTimeline(
	runs: readonly RunGroup[],
	decisions: readonly LeadDecision[],
): TimelineEntry[] {
	const shown = runs.filter((run) => !run.superseded && !run.obsoleted);
	const lastRunId = shown.at(-1)?.runId ?? null;
	const entries = shown.flatMap((run) => runEntries(run, run.runId === lastRunId));
	const replies = entries.filter((entry) => entry.kind === 'reply');
	const latestReply = replies.at(-1)?.key ?? null;
	const marked = entries.map((entry) =>
		entry.kind === 'reply'
			? {
					...entry,
					latest: entry.key === latestReply,
					current: entry.current || entry.key === latestReply,
				}
			: entry,
	);
	return withDecisions(marked, decisions);
}

function runEntries(run: RunGroup, current: boolean): TimelineEntry[] {
	const entries: TimelineEntry[] = [];
	let work: Tool[] = [];
	let reply: Extract<RenderItem, { kind: 'assistant' }> | null = null;
	let started: Tool[] = [];
	const flushWork = (): void => {
		if (work.length > 0) entries.push(workEntry(work, current));
		work = [];
	};
	const flushStarted = (): void => {
		if (started.length > 0) entries.push(startedEntry(started, current));
		started = [];
	};
	for (const item of run.items) {
		if (item.kind === 'user') {
			flushWork();
			flushStarted();
			const entry = promptEntry(item, current);
			if (entry) entries.push(entry);
			continue;
		}
		if (item.kind === 'assistant') {
			if (item.text.trim().length > 0) reply = item;
			continue;
		}
		if (item.kind === 'approval') {
			flushWork();
			flushStarted();
			entries.push({ kind: 'approval', key: item.key, at: item.at ?? null, current, item });
			continue;
		}
		if (item.kind !== 'tool') continue;
		reply = null;
		const malini = item.tool.name.startsWith(MALINI_TOOL)
			? item.tool.name.slice(MALINI_TOOL.length)
			: null;
		if (malini === 'workstreams_create' && startedId(item.tool) !== null) {
			flushWork();
			started.push(item);
			continue;
		}
		const action = malini === null ? null : actionEntry(malini, item, current);
		if (action) {
			flushWork();
			flushStarted();
			entries.push(action);
			continue;
		}
		if (malini !== null && SILENT_TOOLS.has(malini)) continue;
		flushStarted();
		work.push(item);
	}
	flushWork();
	flushStarted();
	if (reply && run.turnEnded) {
		entries.push({
			kind: 'reply',
			key: reply.key,
			at: reply.at ?? null,
			current,
			runId: run.runId,
			text: reply.text,
			latest: false,
		});
	}
	const stop = stoppedEntry(run, current, entries.at(-1)?.at ?? null);
	if (stop) entries.push(stop);
	return entries;
}

function promptEntry(item: Extract<RenderItem, { kind: 'user' }>, current: boolean) {
	const at = item.at ?? null;
	if (item.reports && item.reports.length > 0) {
		const reports = item.reports.map((report, index) => ({
			...report,
			key: `${item.key}-${index}`,
			name: null,
		}));
		return { kind: 'reports' as const, key: item.key, at, current, reports };
	}
	if (item.decisions && item.decisions.length > 0) return null;
	const text = item.text.trim();
	if (text.length === 0 || CONTINUATIONS.has(text)) return null;
	if (text.startsWith(REPORTS_PREAMBLE) || text.startsWith(LEGACY_WAKE)) {
		const reports = legacyReports(item.key, text, item.from ?? null);
		if (reports.length > 0)
			return { kind: 'reports' as const, key: item.key, at, current, reports };
		const body = text.split('\n\n').slice(1).join('\n\n').trim() || text;
		return { kind: 'notice' as const, key: item.key, at, current, text: body };
	}
	return { kind: 'prompt' as const, key: item.key, at, current, text };
}

function actionEntry(tool: string, item: Tool, current: boolean): TimelineEntry | null {
	const base = { key: item.key, at: item.tool.startedAt, current };
	const input = record(item.tool.input);
	const output = record(parsed(item.tool.output));
	const name = text(output['name']) ?? text(input['workstream']) ?? 'a workstream';
	if (item.tool.status === 'failed') return null;
	switch (tool) {
		case 'workstreams_send': {
			const delivery = record(output['delivery']);
			return {
				...base,
				kind: 'sent',
				workstreamId: text(output['id']),
				name,
				prompt: text(input['prompt']) ?? '',
				deliveryId: text(delivery['id']),
				delivered:
					item.tool.status === 'completed' &&
					(delivery['status'] === undefined || delivery['status'] === 'delivered'),
			};
		}
		case 'workstreams_archive':
			if (item.tool.status !== 'completed') return null;
			return { ...base, kind: 'archived', workstreamId: text(output['id']), name };
		case 'jobs_run':
			if (item.tool.status !== 'completed') return null;
			return {
				...base,
				kind: 'job',
				job: text(output['job']) ?? text(input['job']) ?? 'a job',
				workstream: text(input['workstream']),
			};
		case 'plan_write':
			return { ...base, kind: 'plan' };
		default:
			return null;
	}
}

function startedEntry(items: readonly Tool[], current: boolean): TimelineEntry {
	const [first] = items;
	return {
		kind: 'started',
		key: `started-${first?.key ?? ''}`,
		at: first?.tool.startedAt ?? null,
		current,
		workstreams: items.flatMap((item) => {
			const id = startedId(item.tool);
			return id === null ? [] : [{ id, prompt: text(record(item.tool.input)['prompt']) ?? '' }];
		}),
	};
}

function workEntry(items: readonly Tool[], current: boolean): TimelineEntry {
	const [first] = items;
	const kinds = new Set(items.map((item) => toolActionKind(item.tool.name, item.tool.input)));
	const running = items.some((item) => item.tool.status === 'running');
	const ends = items.flatMap((item) =>
		item.tool.completedAt === null ? [] : [item.tool.completedAt],
	);
	return {
		kind: 'work',
		key: `work-${first?.key ?? ''}`,
		at: first?.tool.startedAt ?? null,
		current,
		verb: workVerb(kinds, running),
		steps: items.map(
			(item) =>
				toolDescriptionLabel(item.tool.name, item.tool.input) ??
				toolActivityLabel(item.tool.name, item.tool.input),
		),
		endAt: running || ends.length === 0 ? null : Math.max(...ends),
		running,
	};
}

function workVerb(kinds: ReadonlySet<string>, running: boolean): string {
	const explores = [...kinds].every((kind) => kind === 'read' || kind === 'search');
	if (explores) return running ? 'is reading' : 'read';
	if (kinds.size === 1 && kinds.has('command'))
		return running ? 'is running commands' : 'ran commands';
	return running ? 'is working' : 'worked';
}

function stoppedEntry(run: RunGroup, current: boolean, at: number | null): TimelineEntry | null {
	if (run.terminal !== 'paused' && run.terminal !== 'failed') return null;
	const closed = run.terminal === 'failed' && CLOSED_ERRORS.has(run.terminalText.trim());
	return {
		kind: 'stopped',
		key: `stopped-${run.runId}`,
		at,
		current,
		terminal: closed ? 'closed' : run.terminal,
		text: run.terminalText,
		resumeAt: run.resumeAt,
	};
}

function legacyReports(entryKey: string, text: string, from: string | null): TimelineReport[] {
	return text
		.split('\n\n')
		.slice(1)
		.flatMap((block, index) => {
			const [head = '', ...rest] = block.split('\n');
			const match = LEGACY_REPORT.exec(head.trim());
			if (!match) return [];
			const line = (label: string): string | null => {
				const value = rest
					.find((candidate) => candidate.startsWith(`${label}:`))
					?.slice(label.length + 1)
					.trim();
				return value && value !== 'none' && value !== 'nothing' ? value : null;
			};
			return [
				{
					key: `${entryKey}-${index}`,
					workstreamId: index === 0 ? from : null,
					name: match[1] ?? null,
					status: match[2] === 'failed its turn' ? ('failed' as const) : ('succeeded' as const),
					outcome: line('Outcome'),
					needs: line('Needs'),
					media: [],
				},
			];
		});
}

function withDecisions(
	entries: readonly TimelineEntry[],
	decisions: readonly LeadDecision[],
): TimelineEntry[] {
	const decided = decisions
		.flatMap((decision) => {
			const at = decision.answer ? Date.parse(decision.answer.at) : Number.NaN;
			return Number.isFinite(at)
				? [
						{
							kind: 'decided' as const,
							key: `decided-${decision.id}`,
							at,
							current: false,
							decision,
						},
					]
				: [];
		})
		.sort((left, right) => left.at - right.at);
	const merged: TimelineEntry[] = [];
	let next = 0;
	for (const entry of entries) {
		while (next < decided.length && entry.at !== null && (decided[next]?.at ?? 0) <= entry.at) {
			const decision = decided[next];
			if (decision) merged.push({ ...decision, current: entry.current });
			next += 1;
		}
		merged.push(entry);
	}
	const latestCurrent = entries.at(-1)?.current ?? false;
	for (const decision of decided.slice(next)) merged.push({ ...decision, current: latestCurrent });
	return merged;
}

function startedId(tool: ToolAggregate): string | null {
	if (tool.status !== 'completed') return null;
	return text(record(parsed(tool.output))['id']);
}

function parsed(output: unknown): unknown {
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

function text(value: unknown): string | null {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export type TimelineRow =
	| Readonly<{ kind: 'day'; key: string; label: string }>
	| Readonly<{ kind: 'entry'; key: string; time: string; entry: TimelineEntry }>;

const DAY_MS = 86_400_000;
const SUMMARY_CHARS = 64;
const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const FOOTER_LINE =
	/^\s*(?:[-*]\s+)?(?:\*\*|__)?(?:outcome|needs|commit|pull request)(?:\*\*|__)?\s*:/iu;

export function timelineRows(entries: readonly TimelineEntry[], now: number): TimelineRow[] {
	const rows: TimelineRow[] = [];
	let day = '';
	let shown = '';
	for (const entry of entries) {
		const date = entry.at === null ? null : new Date(entry.at);
		if (date !== null && date.toDateString() !== day) {
			day = date.toDateString();
			shown = '';
			rows.push({ kind: 'day', key: `day-${day}`, label: dayLabel(date, now) });
		}
		const time = date === null ? '' : TIME.format(date);
		rows.push({ kind: 'entry', key: entry.key, time: time === shown ? '' : time, entry });
		if (time !== '') shown = time;
	}
	return rows;
}

export function rowSummary(text: string): string {
	const line =
		text
			.split('\n')
			.find((candidate) => candidate.trim().length > 0)
			?.trim() ?? text;
	let kept = '';
	let shown = 0;
	for (const token of Lexer.lexInline(line)) {
		const visible = 'text' in token && typeof token.text === 'string' ? token.text : token.raw;
		if (shown + visible.length > SUMMARY_CHARS) {
			const cut = token.type === 'text' ? token.raw.slice(0, SUMMARY_CHARS - shown) : '';
			return `${(kept + cut).trimEnd()}…`;
		}
		kept += token.raw;
		shown += visible.length;
	}
	return line;
}

export function replyParts(text: string): Readonly<{ summary: string; body: string }> {
	const lines = text.replace(/\r\n?/gu, '\n').split('\n');
	let end = lines.length;
	const footer: string[] = [];
	while (end > 0) {
		const line = lines[end - 1] ?? '';
		if (line.trim() !== '' && !FOOTER_LINE.test(line)) break;
		if (line.trim() !== '') footer.unshift(line);
		end -= 1;
	}
	const body = lines.slice(0, end).join('\n').trim();
	const outcome = footer
		.find((line) => /outcome/iu.test(line.split(':')[0] ?? ''))
		?.replace(/^[^:]*:\s*/u, '')
		.replace(/^(?:\*\*|__)\s*|\s*(?:\*\*|__)$/gu, '')
		.trim();
	const first =
		body
			.split('\n')
			.find((line) => line.trim().length > 0)
			?.trim() ?? '';
	return { summary: outcome || first || text.trim(), body: body || text.trim() };
}

function dayLabel(date: Date, now: number): string {
	if (date.toDateString() === new Date(now).toDateString()) return 'Today';
	if (date.toDateString() === new Date(now - DAY_MS).toDateString()) return 'Yesterday';
	return DAY.format(date);
}
