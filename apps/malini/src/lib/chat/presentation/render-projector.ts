import { isCancellationError } from '$contract/agent-state-machine';
import { replyOverCommands, resumesTurn } from '$lib/chat/domain/background-work';
import { sanitizeAgentElementReferences } from '$lib/chat/domain/element-reference';
import type { EventEnvelope } from '$lib/chat/domain/events';
import {
	answerOutput,
	firstPromptKey,
	isContextHandoffContentId,
	renderInteractionItem,
	stableToolKey,
	toolFailure,
	truncation,
	type RenderItem,
	type RenderState,
	type RunGroup,
	type ToolAggregate,
} from './render-state';
import {
	runChangedPaths,
	undoTargetsByRun,
	type RunChangedPaths,
	type RunUndoTarget,
} from './chat-message-list/destructive-confirm.svelte';
import {
	EMPTY_ENVELOPE_SOURCE,
	envelopeSource,
	envelopeSourceChange,
	type EnvelopeSource,
} from './envelope-source';
import { EMPTY_TRANSCRIPT_FACTS, TranscriptFactsProjector } from './transcript-facts';
import { earlierTurnsByRun, runTurn, variantPicksByRun, type EarlierTurn } from './turn-result';

type RunningTool = {
	ownerRunId: string;
	item: Extract<RenderItem, { kind: 'tool' }>;
};

export type RenderProjectorStats = {
	processedEnvelopeCount: number;
	rebuildCount: number;
};

export type RunProjectionChange =
	| { version: number; kind: 'append'; item: RenderItem }
	| { version: number; kind: 'replace'; previous: RenderItem; item: RenderItem }
	| { version: number; kind: 'remove'; item: RenderItem };

type RunProjectionChangeInput =
	| { kind: 'append'; item: RenderItem }
	| { kind: 'replace'; previous: RenderItem; item: RenderItem }
	| { kind: 'remove'; item: RenderItem };

type RunProjectionJournal = {
	version: number;
	changes: RunProjectionChange[];
};

const RUN_CHANGE_JOURNAL_LIMIT = 256;
const runProjectionJournals = new WeakMap<RunGroup, RunProjectionJournal>();

export function runProjectionChangesSince(
	run: RunGroup,
	afterVersion: number,
): { version: number; changes: RunProjectionChange[] } | null {
	const journal = runProjectionJournals.get(run);
	if (!journal) return null;
	if (afterVersion === journal.version) return { version: journal.version, changes: [] };
	const firstAvailable = journal.changes[0]?.version ?? journal.version + 1;
	if (afterVersion < firstAvailable - 1) return null;
	return {
		version: journal.version,
		changes: journal.changes.filter((change) => change.version > afterVersion),
	};
}

export function runProjectionVersion(run: RunGroup): number | null {
	return runProjectionJournals.get(run)?.version ?? null;
}

function recordRunChange(run: RunGroup, change: RunProjectionChangeInput): void {
	const journal = runProjectionJournals.get(run) ?? { version: 0, changes: [] };
	journal.version += 1;
	switch (change.kind) {
		case 'append':
			journal.changes.push({ version: journal.version, kind: 'append', item: change.item });
			break;
		case 'replace':
			journal.changes.push({
				version: journal.version,
				kind: 'replace',
				previous: change.previous,
				item: change.item,
			});
			break;
		case 'remove':
			journal.changes.push({ version: journal.version, kind: 'remove', item: change.item });
			break;
	}
	if (journal.changes.length > RUN_CHANGE_JOURNAL_LIMIT) {
		journal.changes.splice(0, journal.changes.length - RUN_CHANGE_JOURNAL_LIMIT);
	}
	runProjectionJournals.set(run, journal);
}

function envelopeKey(envelope: EventEnvelope): string {
	return `${envelope.sessionId}-${envelope.runId}-${envelope.seq}`;
}

function toolLookupKey(runId: string, name: string, toolCallId?: string): string {
	return `${runId}:${toolCallId ? `id:${toolCallId}` : `name:${name}`}`;
}

function stableCommandKey(runId: string, seq: number): string {
	return `command-${runId}-${seq}`;
}

type ControlEvent = Extract<
	EventEnvelope['event'],
	{ type: 'turn.superseded' | 'turn.restored' | 'run.obsoleted' | 'run.restored' }
>;

type RunDerivation = {
	run: RunGroup;
	version: number;
	paths: RunChangedPaths;
	turn: EarlierTurn | null;
};

const EMPTY_TURNS: readonly EarlierTurn[] = [];

export class IncrementalRenderProjector {
	#runs: RunGroup[] = [];
	#runById = new Map<string, RunGroup>();
	#openTools = new Map<string, RunningTool>();
	#settledTools = new Set<string>();
	#runsWithPrompt = new Set<string>();
	#controls: ControlEvent[] = [];
	#supersededRanges: { fromSeq: number; toSeq: number }[] = [];
	#obsoletedRunIds = new Set<string>();
	#terminal: 'completed' | 'failed' | null = null;
	#seenInteractions = new Set<string>();
	#questionTools = new Map<
		string,
		{ runId: string; item: Extract<RenderItem, { kind: 'question' }> }
	>();
	#source: EnvelopeSource = EMPTY_ENVELOPE_SOURCE;
	#facts = new TranscriptFactsProjector();
	#derivations = new Map<string, RunDerivation>();
	#processedEnvelopeCount = 0;
	#rebuildCount = 0;
	#snapshot: RenderState = {
		runs: [],
		terminal: null,
		facts: EMPTY_TRANSCRIPT_FACTS,
		undoTargets: new Map(),
		earlierTurns: new Map(),
		variantPicks: new Map(),
	};

	project(envelopes: readonly EventEnvelope[]): RenderState {
		if (envelopes === this.#source.envelopes && envelopes.length === this.#source.length) {
			return this.#snapshot;
		}
		const change = envelopeSourceChange(this.#source, envelopes);
		this.#source = envelopeSource(envelopes);
		if (change.kind === 'unchanged') return this.#snapshot;
		if (change.kind === 'append') {
			for (let index = change.from; index < envelopes.length; index += 1) {
				const envelope = envelopes[index];
				if (envelope) this.#apply(envelope);
			}
		} else if (change.kind === 'rebuild' || !this.#prepend(envelopes.slice(0, change.count))) {
			this.#resetProjection();
			this.#rebuildCount += 1;
			for (const envelope of envelopes) this.#apply(envelope);
		}

		const runs = this.#visibleRuns();
		this.#snapshot = {
			runs,
			terminal: this.#terminal,
			facts: this.#facts.project(envelopes),
			undoTargets: this.#undoTargets(runs),
			earlierTurns: this.#earlierTurns(runs),
			variantPicks: variantPicksByRun(
				runs,
				(run) => this.#derivation(run).turn,
				this.#snapshot.variantPicks,
			),
		};
		return this.#snapshot;
	}

	stats(): RenderProjectorStats {
		return {
			processedEnvelopeCount: this.#processedEnvelopeCount,
			rebuildCount: this.#rebuildCount,
		};
	}

	reset(): void {
		this.#resetProjection();
		this.#source = EMPTY_ENVELOPE_SOURCE;
		this.#facts = new TranscriptFactsProjector();
		this.#snapshot = {
			runs: [],
			terminal: null,
			facts: EMPTY_TRANSCRIPT_FACTS,
			undoTargets: new Map(),
			earlierTurns: new Map(),
			variantPicks: new Map(),
		};
	}

	#prepend(page: readonly EventEnvelope[]): boolean {
		const older = new IncrementalRenderProjector();
		for (const envelope of page) older.#apply(envelope);
		if (older.#runs.some((run) => this.#runById.has(run.runId))) return false;
		this.#runs = [...older.#runs, ...this.#runs];
		for (const run of older.#runs) this.#runById.set(run.runId, run);
		for (const [key, tool] of older.#openTools) this.#openTools.set(key, tool);
		for (const runId of older.#runsWithPrompt) this.#runsWithPrompt.add(runId);
		for (const key of older.#seenInteractions) this.#seenInteractions.add(key);
		for (const [key, question] of older.#questionTools) this.#questionTools.set(key, question);
		this.#terminal ??= older.#terminal;
		this.#processedEnvelopeCount += older.#processedEnvelopeCount;
		if (older.#controls.length > 0) {
			const controls = [...older.#controls, ...this.#controls];
			this.#controls = [];
			this.#supersededRanges = [];
			this.#obsoletedRunIds.clear();
			for (const control of controls) this.#applyControl(control);
		}
		return true;
	}

	#resetProjection(): void {
		this.#runs = [];
		this.#runById.clear();
		this.#openTools.clear();
		this.#settledTools.clear();
		this.#runsWithPrompt.clear();
		this.#controls = [];
		this.#supersededRanges = [];
		this.#obsoletedRunIds.clear();
		this.#terminal = null;
		this.#seenInteractions.clear();
		this.#questionTools.clear();
		this.#derivations.clear();
	}

	#applyControl(event: ControlEvent): void {
		this.#controls.push(event);
		switch (event.type) {
			case 'turn.superseded':
				this.#supersededRanges.push({ fromSeq: event.fromSeq, toSeq: event.toSeq });
				return;
			case 'turn.restored': {
				const index = this.#supersededRanges.findIndex(
					(range) => range.fromSeq === event.fromSeq && range.toSeq === event.toSeq,
				);
				if (index >= 0) this.#supersededRanges.splice(index, 1);
				return;
			}
			case 'run.obsoleted':
				this.#obsoletedRunIds.add(event.runId);
				return;
			case 'run.restored':
				this.#obsoletedRunIds.delete(event.runId);
				return;
		}
	}

	#derivation(run: RunGroup): RunDerivation {
		const version = runProjectionVersion(run) ?? 0;
		const cached = this.#derivations.get(run.runId);
		if (cached && cached.run === run && cached.version === version) return cached;
		const derivation = { run, version, paths: runChangedPaths(run), turn: runTurn(run) };
		this.#derivations.set(run.runId, derivation);
		return derivation;
	}

	#undoTargets(runs: readonly RunGroup[]): ReadonlyMap<string, RunUndoTarget> {
		const previous = this.#snapshot.undoTargets;
		const next = undoTargetsByRun(runs, (run) => this.#derivation(run).paths);
		let unchanged = next.size === previous.size;
		for (const [runId, target] of next) {
			const prior = previous.get(runId);
			if (
				prior &&
				prior.checkpointId === target.checkpointId &&
				prior.changeCount === target.changeCount
			) {
				next.set(runId, prior);
			} else {
				unchanged = false;
			}
		}
		return unchanged ? previous : next;
	}

	#earlierTurns(runs: readonly RunGroup[]): ReadonlyMap<string, readonly EarlierTurn[]> {
		const previous = this.#snapshot.earlierTurns;
		const next = earlierTurnsByRun(runs, (run) => this.#derivation(run).turn);
		let unchanged = next.size === previous.size;
		for (const [runId, turns] of next) {
			const prior = previous.get(runId);
			if (prior && sameTurns(prior, turns)) next.set(runId, prior);
			else {
				next.set(runId, turns.length === 0 ? EMPTY_TURNS : turns);
				unchanged = false;
			}
		}
		return unchanged ? previous : next;
	}

	#promptKey(runId: string, envelopeKey: string): string {
		if (this.#runsWithPrompt.has(runId)) return envelopeKey;
		this.#runsWithPrompt.add(runId);
		return firstPromptKey(runId);
	}

	#runFor(runId: string): RunGroup {
		let group = this.#runById.get(runId);
		if (!group) {
			group = {
				runId,
				items: [],
				terminal: null,
				terminalText: '',
				turnEnded: false,
				superseded: false,
				obsoleted: false,
			};
			this.#runById.set(runId, group);
			this.#runs.push(group);
			runProjectionJournals.set(group, { version: 0, changes: [] });
		}
		return group;
	}

	#withState(
		group: RunGroup,
		state: Partial<Pick<RunGroup, 'terminal' | 'terminalText' | 'turnEnded'>>,
	): void {
		const next = { ...group, items: [...group.items], ...state };
		const index = this.#runs.indexOf(group);
		if (index >= 0) this.#runs[index] = next;
		this.#runById.set(group.runId, next);
		runProjectionJournals.set(
			next,
			runProjectionJournals.get(group) ?? { version: 0, changes: [] },
		);
	}

	#push(runId: string, item: RenderItem): void {
		const run = this.#runFor(runId);
		run.items.push(item);
		recordRunChange(run, { kind: 'append', item });
	}

	#removeItem(runId: string, item: RenderItem): void {
		const group = this.#runById.get(runId);
		if (!group) return;
		const index = group.items.indexOf(item);
		if (index >= 0) {
			group.items.splice(index, 1);
			recordRunChange(group, { kind: 'remove', item });
		}
	}

	#replaceItem<T extends RenderItem>(runId: string, previous: T, next: T): void {
		const group = this.#runById.get(runId);
		if (!group) return;
		const index = group.items.indexOf(previous);
		if (index >= 0) {
			group.items.splice(index, 1, next);
			recordRunChange(group, { kind: 'replace', previous, item: next });
		}
	}

	#adoptQuestionTool(runId: string, item: Extract<RenderItem, { kind: 'question' }>): void {
		if (!item.toolCallId) return;
		const lookupKey = toolLookupKey(runId, '', item.toolCallId);
		const running = this.#openTools.get(lookupKey);
		if (running) {
			this.#removeItem(running.ownerRunId, running.item);
			this.#openTools.delete(lookupKey);
		}
		this.#questionTools.set(lookupKey, { runId, item });
	}

	#settleQuestionTool(lookupKey: string, output: string | undefined): boolean {
		const question = this.#questionTools.get(lookupKey);
		if (!question) return false;
		this.#questionTools.delete(lookupKey);
		if (output !== undefined) {
			this.#replaceItem(question.runId, question.item, { ...question.item, answerOutput: output });
		}
		return true;
	}

	#discardOpenToolsForRun(runId: string): void {
		for (const [key, running] of this.#openTools) {
			if (running.ownerRunId !== runId) continue;
			this.#removeItem(runId, running.item);
			this.#openTools.delete(key);
		}
	}

	#apply(envelope: EventEnvelope): void {
		this.#processedEnvelopeCount += 1;
		const event = envelope.event;
		const key = envelopeKey(envelope);
		const runId = envelope.runId;
		const resumed = resumesTurn(event) ? this.#runById.get(runId) : undefined;
		if (resumed?.turnEnded) this.#withState(resumed, { turnEnded: false });

		switch (event.type) {
			case 'run.started':
				this.#runFor(runId);
				return;
			case 'user.message': {
				this.#push(runId, {
					kind: 'user',
					key: this.#promptKey(runId, key),
					seq: envelope.seq,
					text: event.text,
					...(event.checkpointId ? { checkpointId: event.checkpointId } : {}),
					...(event.contextFiles?.length ? { contextFiles: [...event.contextFiles] } : {}),
					...(event.attachments?.length
						? { attachments: event.attachments.map((attachment) => ({ ...attachment })) }
						: {}),
					...(event.transcriptReferences?.length
						? {
								transcriptReferences: event.transcriptReferences.map(({ sessionId, label }) => ({
									sessionId,
									label,
								})),
							}
						: {}),
					...(event.elementReferences?.length
						? { elementReferences: sanitizeAgentElementReferences(event.elementReferences) }
						: {}),
					...(event.from ? { from: event.from } : {}),
				});
				return;
			}
			case 'plan.updated':
				this.#push(runId, { kind: 'plan', key, seq: envelope.seq, text: event.text });
				return;
			case 'assistant.message':
				if (isContextHandoffContentId(event.contentId)) {
					this.#push(runId, { kind: 'handoff', key, seq: envelope.seq });
					return;
				}
				this.#push(runId, {
					kind: 'assistant',
					key,
					seq: envelope.seq,
					text: event.text,
					...(event.contentId ? { contentId: event.contentId } : {}),
				});
				return;
			case 'tool.started': {
				const lookupKey = toolLookupKey(runId, event.name, event.toolCallId);
				const replaced = this.#openTools.get(lookupKey);
				if (replaced) this.#removeItem(replaced.ownerRunId, replaced.item);
				const tool: ToolAggregate = {
					name: event.name,
					...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
					startedAt: event.ts ?? null,
					completedAt: null,
					input: event.input,
					output: undefined,
					status: 'running',
				};
				const item: Extract<RenderItem, { kind: 'tool' }> = {
					kind: 'tool',
					key: stableToolKey(runId, event.name, event.toolCallId, envelope.seq),
					seq: envelope.seq,
					tool,
				};
				this.#push(runId, item);
				this.#openTools.set(lookupKey, { ownerRunId: runId, item });
				return;
			}
			case 'tool.completed':
			case 'tool.failed': {
				const lookupKey = toolLookupKey(runId, event.name, event.toolCallId);
				if (this.#settledTools.has(lookupKey)) return;
				if (event.toolCallId) this.#settledTools.add(lookupKey);
				const output = event.type === 'tool.completed' ? answerOutput(event.output) : undefined;
				if (this.#settleQuestionTool(lookupKey, output)) return;
				const running = this.#openTools.get(lookupKey);
				if (running) {
					const failed = event.type === 'tool.failed';
					const completed: Extract<RenderItem, { kind: 'tool' }> = {
						...running.item,
						tool: {
							...running.item.tool,
							completedAt: event.ts ?? null,
							status: failed ? 'failed' : 'completed',
							...(event.type === 'tool.failed'
								? toolFailure(event)
								: { output: event.output, ...truncation(event) }),
						},
					};
					this.#replaceItem(runId, running.item, completed);
					this.#openTools.delete(lookupKey);
				} else {
					const failed = event.type === 'tool.failed';
					this.#push(runId, {
						kind: 'tool',
						key: stableToolKey(runId, event.name, event.toolCallId, envelope.seq),
						seq: envelope.seq,
						tool: {
							name: event.name,
							...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
							startedAt: null,
							completedAt: event.ts ?? null,
							input: undefined,
							output: failed ? undefined : event.output,
							status: failed ? 'failed' : 'completed',
							...(event.type === 'tool.failed' ? toolFailure(event) : truncation(event)),
						},
					});
				}
				return;
			}
			case 'thinking.message':
			case 'assistant.delta':
			case 'thinking.delta':
			case 'tool.input.delta':
				return;
			case 'command.completed':
				this.#push(runId, {
					kind: 'command',
					key: stableCommandKey(runId, envelope.seq),
					seq: envelope.seq,
					command: event.command,
					...(event.description ? { description: event.description } : {}),
					exitCode: event.exitCode,
				});
				return;
			case 'file.changed':
				this.#push(runId, {
					kind: 'file',
					key: `${key}-${event.path}`,
					seq: envelope.seq,
					path: event.path,
				});
				return;
			case 'usage.updated':
				this.#push(runId, {
					kind: 'usage',
					key,
					seq: envelope.seq,
					inputTokens: event.inputTokens ?? null,
					outputTokens: event.outputTokens ?? null,
					costUsd: event.costUsd ?? null,
				});
				return;
			case 'approval.requested':
			case 'question.requested': {
				const item = renderInteractionItem(envelope);
				if (item && !this.#seenInteractions.has(item.key)) {
					this.#seenInteractions.add(item.key);
					if (item.kind === 'question') this.#adoptQuestionTool(runId, item);
					this.#push(runId, item);
				}
				return;
			}
			case 'background.updated': {
				const group = this.#runFor(runId);
				if (group.terminal === null && !group.turnEnded && replyOverCommands(event) !== null) {
					this.#withState(group, { turnEnded: true });
				}
				return;
			}
			case 'run.completed':
			case 'run.failed': {
				const group = this.#runFor(runId);
				if (group.terminal !== null) return;
				this.#discardOpenToolsForRun(runId);
				if (event.type === 'run.completed') {
					this.#terminal = 'completed';
					this.#withState(group, {
						terminal: 'completed',
						terminalText: event.summary,
						turnEnded: true,
					});
					this.#push(runId, {
						kind: 'terminal',
						key,
						seq: envelope.seq,
						terminal: 'completed',
						text: event.summary,
					});
				} else {
					this.#terminal = 'failed';
					const cancelled = isCancellationError(event.error);
					this.#withState(group, {
						terminal: cancelled ? 'cancelled' : 'failed',
						terminalText: event.error,
					});
					this.#push(runId, {
						kind: 'terminal',
						key,
						seq: envelope.seq,
						terminal: 'failed',
						text: event.error,
					});
				}
				return;
			}
			case 'checkpoint.restored':
			case 'session.branched':
				return;
			case 'turn.superseded':
			case 'turn.restored':
			case 'run.obsoleted':
			case 'run.restored':
				this.#applyControl(event);
				return;
			case 'unknown': {
				if (import.meta.env.DEV) {
					const fallbackRun = this.#runs.at(-1)?.runId ?? 'unknown';
					this.#push(fallbackRun, { kind: 'unknown', key, seq: envelope.seq, raw: event.raw });
				}
			}
		}
	}

	#visibleRuns(): RunGroup[] {
		const visible: RunGroup[] = [];
		for (let index = 0; index < this.#runs.length; index += 1) {
			const run = this.#runs[index];
			if (!run) continue;
			const isLast = index === this.#runs.length - 1;
			if (run.items.length === 0 && run.terminal === null && !isLast) continue;
			const superseded = runOpensInSupersededRange(run, this.#supersededRanges);
			const obsoleted = this.#obsoletedRunIds.has(run.runId);
			if (superseded === run.superseded && obsoleted === run.obsoleted) {
				visible.push(run);
				continue;
			}

			const next: RunGroup = { ...run, items: run.items, superseded, obsoleted };
			const journal = runProjectionJournals.get(run);
			if (journal) runProjectionJournals.set(next, journal);
			this.#runs[index] = next;
			this.#runById.set(run.runId, next);
			visible.push(next);
		}
		return visible;
	}
}

function runOpensInSupersededRange(
	run: RunGroup,
	ranges: readonly { fromSeq: number; toSeq: number }[],
): boolean {
	if (ranges.length === 0) return false;
	const openingSeq = run.items.find((item) => item.kind === 'user')?.seq;
	if (openingSeq === undefined) return false;
	return ranges.some((range) => openingSeq >= range.fromSeq && openingSeq <= range.toSeq);
}

function sameTurns(left: readonly EarlierTurn[], right: readonly EarlierTurn[]): boolean {
	return left.length === right.length && left.every((turn, index) => turn === right[index]);
}
