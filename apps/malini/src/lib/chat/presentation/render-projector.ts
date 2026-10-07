import { isCancellationError } from '$contract/agent-state-machine';
import { sanitizeAgentElementReferences } from '$lib/chat/domain/element-reference';
import type { EventEnvelope } from '$lib/chat/domain/events';
import { parseAgentPrompt } from '$lib/chat/domain/issue-reference';
import {
	firstPromptKey,
	isContextHandoffContentId,
	renderInteractionItem,
	stableToolKey,
	type RenderItem,
	type RenderState,
	type RunGroup,
	type ToolAggregate,
} from './render-state';

type RunningTool = {
	ownerRunId: string;
	item: Extract<RenderItem, { kind: 'tool' }>;
};

type RunningCommand = {
	ownerRunId: string;
	item: Extract<RenderItem, { kind: 'command' }>;
	owningToolKey: string | null;
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

export class IncrementalRenderProjector {
	#runs: RunGroup[] = [];
	#runById = new Map<string, RunGroup>();
	#openTools = new Map<string, RunningTool>();
	#commandLive: RunningCommand | null = null;
	#activeToolKey: string | null = null;
	#commandsByTool = new Map<
		string,
		{ ownerRunId: string; item: Extract<RenderItem, { kind: 'command' }> }[]
	>();
	#runsWithPrompt = new Set<string>();
	#supersededRanges: { fromSeq: number; toSeq: number }[] = [];
	#obsoletedRunIds = new Set<string>();
	#terminal: 'completed' | 'failed' | null = null;
	#seenInteractions = new Set<string>();
	#sourceLength = 0;
	#lastEnvelopeKey: string | null = null;
	#sourceReference: readonly EventEnvelope[] | null = null;
	#processedEnvelopeCount = 0;
	#rebuildCount = 0;
	#snapshot: RenderState = { runs: [], terminal: null };

	project(envelopes: readonly EventEnvelope[]): RenderState {
		if (this.#sourceUnchanged(envelopes)) return this.#snapshot;
		if (this.#canAppend(envelopes)) {
			for (let index = this.#sourceLength; index < envelopes.length; index += 1) {
				const envelope = envelopes[index];
				if (envelope) this.#apply(envelope);
			}
		} else {
			this.#resetProjection();
			this.#rebuildCount += 1;
			for (const envelope of envelopes) this.#apply(envelope);
		}

		this.#sourceLength = envelopes.length;
		const lastEnvelope = envelopes[envelopes.length - 1];
		this.#lastEnvelopeKey = lastEnvelope ? envelopeKey(lastEnvelope) : null;
		this.#sourceReference = envelopes;
		this.#snapshot = {
			runs: this.#visibleRuns(),
			terminal: this.#terminal,
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
		this.#sourceLength = 0;
		this.#lastEnvelopeKey = null;
		this.#sourceReference = null;
		this.#snapshot = { runs: [], terminal: null };
	}

	#canAppend(envelopes: readonly EventEnvelope[]): boolean {
		if (this.#sourceLength === 0) return true;
		if (envelopes.length < this.#sourceLength) return false;
		const formerLast = envelopes[this.#sourceLength - 1];
		if (formerLast === undefined || envelopeKey(formerLast) !== this.#lastEnvelopeKey) {
			return false;
		}
		if (envelopes === this.#sourceReference) {
			return true;
		}
		if (!this.#sourceReference) return false;
		for (let index = 0; index < this.#sourceLength; index += 1) {
			if (envelopes[index] !== this.#sourceReference[index]) return false;
		}
		return true;
	}

	#sourceUnchanged(envelopes: readonly EventEnvelope[]): boolean {
		return (
			envelopes === this.#sourceReference &&
			envelopes.length === this.#sourceLength &&
			lastKeyMatches(envelopes, this.#lastEnvelopeKey)
		);
	}

	#resetProjection(): void {
		this.#runs = [];
		this.#runById.clear();
		this.#openTools.clear();
		this.#commandLive = null;
		this.#activeToolKey = null;
		this.#commandsByTool.clear();
		this.#runsWithPrompt.clear();
		this.#supersededRanges = [];
		this.#obsoletedRunIds.clear();
		this.#terminal = null;
		this.#seenInteractions.clear();
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
				superseded: false,
				obsoleted: false,
			};
			this.#runById.set(runId, group);
			this.#runs.push(group);
			runProjectionJournals.set(group, { version: 0, changes: [] });
		}
		return group;
	}

	#withTerminal(
		group: RunGroup,
		terminal: Exclude<RunGroup['terminal'], null>,
		terminalText: string,
	): void {
		const next = { ...group, items: [...group.items], terminal, terminalText };
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

	#discardOpenToolsForRun(runId: string): void {
		for (const [key, running] of this.#openTools) {
			if (running.ownerRunId !== runId) continue;
			this.#removeItem(runId, running.item);
			if (this.#activeToolKey === key) this.#activeToolKey = null;
			this.#commandsByTool.delete(key);
			this.#openTools.delete(key);
		}
	}

	#failOwnedCommands(lookupKey: string, error: string): void {
		for (const owned of this.#commandsByTool.get(lookupKey) ?? []) {
			this.#replaceItem(owned.ownerRunId, owned.item, { ...owned.item, error });
		}
	}

	#ownCommand(
		lookupKey: string | null,
		ownerRunId: string,
		item: Extract<RenderItem, { kind: 'command' }>,
	): void {
		if (lookupKey === null) return;
		const owned = this.#commandsByTool.get(lookupKey);
		if (owned) owned.push({ ownerRunId, item });
		else this.#commandsByTool.set(lookupKey, [{ ownerRunId, item }]);
	}

	#apply(envelope: EventEnvelope): void {
		this.#processedEnvelopeCount += 1;
		const event = envelope.event;
		const key = envelopeKey(envelope);
		const runId = envelope.runId;

		switch (event.type) {
			case 'run.started':
				this.#runFor(runId);
				return;
			case 'user.message': {
				const parsedPrompt = parseAgentPrompt(event.text);
				this.#push(runId, {
					kind: 'user',
					key: this.#promptKey(runId, key),
					seq: envelope.seq,
					text: parsedPrompt.prompt,
					...(event.checkpointId ? { checkpointId: event.checkpointId } : {}),
					...(event.contextFiles?.length ? { contextFiles: [...event.contextFiles] } : {}),
					...(event.attachments?.length
						? { attachments: event.attachments.map((attachment) => ({ ...attachment })) }
						: {}),
					...(parsedPrompt.issueReferences.length
						? {
								issueReferences: parsedPrompt.issueReferences.map((reference) => ({
									...reference,
								})),
							}
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
				this.#activeToolKey = lookupKey;
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
				if (this.#activeToolKey === lookupKey) this.#activeToolKey = null;
				if (event.type === 'tool.failed') this.#failOwnedCommands(lookupKey, event.error);
				this.#commandsByTool.delete(lookupKey);
				const running = this.#openTools.get(lookupKey);
				if (running) {
					const failed = event.type === 'tool.failed';
					const completed: Extract<RenderItem, { kind: 'tool' }> = {
						...running.item,
						tool: {
							...running.item.tool,
							completedAt: event.ts ?? null,
							status: failed ? 'failed' : 'completed',
							...(event.type === 'tool.failed' ? { error: event.error } : { output: event.output }),
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
							...(failed ? { error: event.error } : {}),
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
			case 'command.started': {
				if (this.#commandLive) {
					this.#removeItem(this.#commandLive.ownerRunId, this.#commandLive.item);
				}
				const item: Extract<RenderItem, { kind: 'command' }> = {
					kind: 'command',
					key: stableCommandKey(runId, envelope.seq),
					seq: envelope.seq,
					command: event.command,
					...(event.description ? { description: event.description } : {}),
					exitCode: null,
					output: null,
				};
				this.#push(runId, item);
				this.#commandLive = { ownerRunId: runId, item, owningToolKey: this.#activeToolKey };
				return;
			}
			case 'command.output': {
				if (!this.#commandLive) {
					const item: Extract<RenderItem, { kind: 'command' }> = {
						kind: 'command',
						key: stableCommandKey(runId, envelope.seq),
						seq: envelope.seq,
						command: '<unknown>',
						exitCode: null,
						output: null,
					};
					this.#push(runId, item);
					this.#commandLive = { ownerRunId: runId, item, owningToolKey: this.#activeToolKey };
				}
				const running = this.#commandLive;
				const previousOutput = running.item.output ?? '';
				const updated: Extract<RenderItem, { kind: 'command' }> = {
					...running.item,
					output:
						event.stream === 'stderr'
							? `${previousOutput}${event.text}\n[stderr]\n`
							: `${previousOutput}${event.text}`,
				};
				this.#replaceItem(running.ownerRunId, running.item, updated);
				this.#commandLive = { ...running, item: updated };
				return;
			}
			case 'command.completed': {
				if (!this.#commandLive) {
					const item: Extract<RenderItem, { kind: 'command' }> = {
						kind: 'command',
						key: stableCommandKey(runId, envelope.seq),
						seq: envelope.seq,
						command: event.command,
						...(event.description ? { description: event.description } : {}),
						exitCode: event.exitCode,
						output: null,
					};
					this.#push(runId, item);
					this.#ownCommand(this.#activeToolKey, runId, item);
				} else {
					const running = this.#commandLive;
					const completed: Extract<RenderItem, { kind: 'command' }> = {
						...running.item,
						command: event.command,
						...(event.description ? { description: event.description } : {}),
						exitCode: event.exitCode,
					};
					this.#replaceItem(running.ownerRunId, running.item, completed);
					this.#ownCommand(running.owningToolKey, running.ownerRunId, completed);
				}
				this.#commandLive = null;
				return;
			}
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
					this.#push(runId, item);
				}
				return;
			}
			case 'run.completed':
			case 'run.failed': {
				const group = this.#runFor(runId);
				if (group.terminal !== null) return;
				this.#discardOpenToolsForRun(runId);
				if (this.#commandLive?.ownerRunId === runId) {
					this.#removeItem(runId, this.#commandLive.item);
					this.#commandLive = null;
				}
				if (event.type === 'run.completed') {
					this.#terminal = 'completed';
					this.#withTerminal(group, 'completed', event.summary);
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
					this.#withTerminal(group, cancelled ? 'cancelled' : 'failed', event.error);
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
			case 'turn.superseded': {
				this.#supersededRanges.push({ fromSeq: event.fromSeq, toSeq: event.toSeq });
				return;
			}
			case 'turn.restored': {
				const index = this.#supersededRanges.findIndex(
					(range) => range.fromSeq === event.fromSeq && range.toSeq === event.toSeq,
				);
				if (index >= 0) this.#supersededRanges.splice(index, 1);
				return;
			}
			case 'run.obsoleted': {
				this.#obsoletedRunIds.add(event.runId);
				return;
			}
			case 'run.restored': {
				this.#obsoletedRunIds.delete(event.runId);
				return;
			}
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
	const openingSeq = run.items.find((item) => item.kind === 'user')?.seq;
	if (openingSeq === undefined) return false;
	return ranges.some((range) => openingSeq >= range.fromSeq && openingSeq <= range.toSeq);
}

function lastKeyMatches(envelopes: readonly EventEnvelope[], lastKey: string | null): boolean {
	const last = envelopes[envelopes.length - 1];
	return last === undefined || envelopeKey(last) === lastKey;
}
