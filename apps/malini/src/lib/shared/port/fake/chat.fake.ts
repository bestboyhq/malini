import type {
	LiveEventEnvelope,
	StagedAgentAttachment,
	StagedAgentAttachmentBytes,
} from '$contract/agent';
import { deriveAgentChatDisplayName, runIdForPromptRequest } from '$contract/chat-identity';
import { CHAT_AGENT_EVENT_CHANNEL } from '$contract/events';
import type { WorktreeChangeTotals } from '$contract/repositories';
import type { FakeAgentEvent, FakeAgentScriptContext, FakeAgentScriptStep } from './seed';
import type { FakeBridge } from './fake-bridge';
import { FAKE_PIXEL_PNG_BASE64, FAKE_PIXEL_PNG_BYTES } from './fake-constants';
import {
	cloneAgentSessionChanges,
	cloneEnvelope,
	cloneProviderCapability,
	createFakeInteractionGate,
	fakeInteractionKey,
	isRecord,
	nextFakeChatFallback,
	stableHash,
	stableHex,
	uniqueFakeChatName,
	uniqueSorted,
	type FakeSession,
	type FakeState,
} from './state';

export function setFakeAgentScript(state: FakeState, steps: readonly FakeAgentScriptStep[]): void {
	state.agentScript = [...steps];
}

export function installChatFake(bridge: FakeBridge, state: FakeState): void {
	let scriptQueue = Promise.resolve();
	const emit = <T>(event: string, payload: T): void => {
		bridge.emit(event, payload);
	};
	const assertAgentChangeScope = (input: { workstreamId: string; sessionId: string }): void => {
		const session = state.sessions.get(input.sessionId);
		const workstream = state.workstreams.find(({ id }) => id === input.workstreamId);
		if (!session || session.workstreamId !== input.workstreamId || !workstream) {
			throw new Error('agent session does not belong to the requested workstream');
		}
	};

	bridge.onReset(() => {
		scriptQueue = Promise.resolve();
	});

	bridge.define('chat.pick-and-stage-attachments', async (input) => {
		return (state.stagedAgentAttachments[input.workstreamId] ?? []).map((attachment) => ({
			...attachment,
		}));
	});

	bridge.define('chat.stage-attachment-bytes', async (input) => {
		const mediaType = fakeAttachmentMediaType(input.fileName);
		if (!mediaType) {
			throw new Error(`\`${input.fileName}\` is not a type that can be pasted as an attachment`);
		}
		const staged = state.stagedAgentAttachments[input.workstreamId] ?? [];

		const seed = `${input.workstreamId}:${input.fileName}:${staged.length}`;
		const id = `att-${stableHex(seed, 32)}`;
		const attachment: StagedAgentAttachment = {
			id,
			displayName: input.fileName,
			relativePath: `.malini/agent-attachments/${id}/${input.fileName}`,
			mediaType,
			size: base64ByteLength(input.base64),
			sha256: stableHex(`${seed}:sha256`, 64),
		};
		state.stagedAgentAttachments[input.workstreamId] = [...staged, attachment];
		return { ...attachment };
	});

	bridge.define('chat.stage-fork-transcript', async (input) => {
		const parent = state.sessions.get(input.sessionId);
		if (parent?.workstreamId !== input.workstreamId) {
			throw new Error(`chat \`${input.sessionId}\` is not in this workstream`);
		}
		const staged = state.stagedAgentAttachments[input.workstreamId] ?? [];
		const displayName = `Transcript of ${parent.displayName.trim() || 'Chat'}.md`;
		const seed = `${input.workstreamId}:${input.sessionId}:${input.atSeq}:${staged.length}`;
		const id = `att-${stableHex(seed, 32)}`;
		const attachment: StagedAgentAttachment = {
			id,
			displayName,
			relativePath: `.malini/agent-attachments/${id}/${displayName}`,
			mediaType: 'text/plain',
			size: 1_024,
			sha256: stableHex(`${seed}:sha256`, 64),
		};
		state.stagedAgentAttachments[input.workstreamId] = [...staged, attachment];
		return { ...attachment };
	});

	bridge.define('chat.remove-staged-attachment', async (input) => {
		const error = state.removeStagedAgentAttachmentErrors[input.attachmentId];
		if (error) throw new Error(error);
		state.stagedAgentAttachments[input.workstreamId] = (
			state.stagedAgentAttachments[input.workstreamId] ?? []
		).filter((attachment) => attachment.id !== input.attachmentId);
	});

	bridge.define('chat.read-staged-attachment', async (input) => {
		const attachment = (state.stagedAgentAttachments[input.workstreamId] ?? []).find(
			(candidate) => candidate.id === input.attachmentId,
		);
		if (!attachment) throw new Error(`staged attachment \`${input.attachmentId}\` not found`);

		if (!attachment.mediaType.startsWith('image/')) return null;
		return {
			mediaType: attachment.mediaType,
			base64: FAKE_PIXEL_PNG_BASE64,
			size: FAKE_PIXEL_PNG_BYTES,
		} satisfies StagedAgentAttachmentBytes;
	});

	bridge.define('chat.agent-capabilities', async () => {
		return state.providerCapabilities.map(cloneProviderCapability);
	});

	bridge.define('chat.refresh-mcp-status', async () => {});

	bridge.define('chat.start-session', async (input) => {
		if (state.agentSessionBootstrapFailures > 0) {
			state.agentSessionBootstrapFailures -= 1;
			throw new Error(state.agentSessionBootstrapError);
		}
		const id = `fake-session-${state.nextSession}`;
		state.nextSession += 1;
		state.sessions.set(id, {
			id,
			workstreamId: input.workstreamId,
			displayName: nextFakeChatFallback(state.sessions, input.workstreamId),
			model: input.model,
			startedAt: new Date(state.nextSession * 1_000).toISOString(),
			archivedAt: null,
			status: 'idle',
			hasSentPrompt: false,
			currentRunId: null,
			cancelled: false,
		});
		return id;
	});

	bridge.define('chat.send-prompt', async (input) => {
		const session = state.sessions.get(input.sessionId);
		if (!session) {
			throw new Error(`Unknown fake session: ${input.sessionId}`);
		}
		if (session.archivedAt !== null) {
			throw new Error(`Cannot send a prompt to archived fake session: ${input.sessionId}`);
		}
		if (!session.hasSentPrompt && input.automated !== true) {
			const baseName = deriveAgentChatDisplayName(input.prompt);
			if (baseName) {
				session.displayName = uniqueFakeChatName(
					state.sessions,
					session.workstreamId,
					baseName,
					session.id,
				);
			}
			session.hasSentPrompt = true;
		}
		session.cancelled = false;
		const runId = runIdForPromptRequest(input.clientRequestId) ?? `fake-run-${state.nextRun}`;
		state.nextRun += 1;
		session.currentRunId = runId;
		session.status = 'running';
		const previous = scriptQueue;
		scriptQueue = (async () => {
			await previous;
			await runAgentScript(session, runId, input.prompt, emit);
		})();
		return runId;
	});

	async function cancelFakeRun(session: FakeSession): Promise<void> {
		session.cancelled = true;
		const runId = session.currentRunId;
		if (runId) {
			settleFakeRunInteractions(session.id, runId);
			await nextMicrotask();
			emitAgentEvent(emit, session.id, runId, {
				type: 'run.failed',
				runId,
				error: 'run cancelled',
			});
		}
	}

	bridge.define('chat.cancel-run', async (input) => {
		const session = state.sessions.get(input.sessionId);
		if (session) await cancelFakeRun(session);
	});

	bridge.define('chat.decide-approval', async (input) => {
		const key = fakeInteractionKey(input.sessionId, input.runId, input.approvalId);
		const pending = state.pendingApprovals.get(key);
		if (
			state.resolvedApprovals.has(key) ||
			(!pending && !hasPendingSeededInteraction(input, 'approval.requested'))
		) {
			throw new Error(`Unknown or stale fake approval: ${input.approvalId}`);
		}
		state.pendingApprovals.delete(key);
		state.resolvedApprovals.add(key);
		pending?.resolve();
		markFakeSessionRunning(input.sessionId, input.runId);
		const remembered =
			input.decision === 'allow' && input.scope !== 'once' && input.permission !== undefined;
		return {
			decision: input.decision,
			scope: input.scope,
			remembered,
			...(remembered ? { ruleId: `fake-rule-${stableHash(key)}` } : {}),
		};
	});

	bridge.define('chat.answer-question', async (input) => {
		const key = fakeInteractionKey(input.sessionId, input.runId, input.questionId);
		const pending = state.pendingQuestions.get(key);
		if (
			state.resolvedQuestions.has(key) ||
			(!pending && !hasPendingSeededInteraction(input, 'question.requested'))
		) {
			throw new Error(`Unknown or stale fake question: ${input.questionId}`);
		}
		state.pendingQuestions.delete(key);
		state.resolvedQuestions.add(key);
		pending?.resolve();
		markFakeSessionRunning(input.sessionId, input.runId);
	});

	bridge.define('chat.restart-agent', async () => {});

	bridge.define('chat.agent-health', async () => true);

	bridge.define('chat.list-sessions', async (input) => {
		return [...state.sessions.values()]
			.filter(
				(session) => session.workstreamId === input.workstreamId && session.archivedAt === null,
			)
			.map((session) => ({
				id: session.id,
				workstreamId: session.workstreamId,
				displayName: session.displayName,
				model: session.model ?? null,
				status: session.status,
				startedAt: session.startedAt,
			}))
			.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
	});

	bridge.define('chat.archive-session', async (input) => {
		const session = state.sessions.get(input.sessionId);
		if (!session) {
			throw new Error(`Unknown fake session: ${input.sessionId}`);
		}
		if (session.archivedAt !== null) return;
		if (session.currentRunId !== null) await cancelFakeRun(session);
		session.archivedAt = new Date(state.nextSession * 1_000).toISOString();
	});

	bridge.define('chat.activate-session', async (input) => {
		if (!state.sessions.has(input.sessionId)) {
			throw new Error(`Unknown fake session: ${input.sessionId}`);
		}
	});

	bridge.define('chat.list-events', async (input) => {
		const log = state.eventLogBySession.get(input.sessionId) ?? [];
		return log.filter((envelope) => envelope.seq > input.afterSeq).map(cloneEnvelope);
	});

	bridge.define('chat.list-recent-events', async (input) => {
		const log = state.eventLogBySession.get(input.sessionId) ?? [];
		const runs = new Map<string, { firstSeq: number; bytes: number }>();
		for (const envelope of log) {
			const bytes = JSON.stringify(envelope.event).length;
			const run = runs.get(envelope.runId);
			if (run) {
				run.firstSeq = Math.min(run.firstSeq, envelope.seq);
				run.bytes += bytes;
			} else {
				runs.set(envelope.runId, { firstSeq: envelope.seq, bytes });
			}
		}
		const newestFirst = [...runs.values()].sort((left, right) => right.firstSeq - left.firstSeq);
		let fromSeq: number | null = null;
		let tailBytes = 0;
		for (const run of newestFirst) {
			tailBytes += run.bytes;
			if (tailBytes > input.byteBudget) break;
			fromSeq = run.firstSeq;
		}
		if (fromSeq === null) return { envelopes: [], overBudget: log.length > 0 };
		const since = fromSeq;
		return {
			envelopes: log.filter((envelope) => envelope.seq >= since).map(cloneEnvelope),
			overBudget: false,
		};
	});

	bridge.define('chat.session-changes', async (input) => {
		assertAgentChangeScope(input);
		const changes = state.agentSessionChanges[input.sessionId];
		if (!changes) {
			return {
				sessionId: input.sessionId,
				runs: [],
				files: [],
				beforeCommit: null,
				afterCommit: null,
				capturedAt: null,
			};
		}
		const cloned = cloneAgentSessionChanges(changes);
		if (state.obsoletedRunIds.size === 0) return cloned;
		const liveRuns = cloned.runs.filter((run) => !state.obsoletedRunIds.has(run.runId));
		if (liveRuns.length === cloned.runs.length) return cloned;
		const liveFiles = cloned.files
			.map((file) => ({
				...file,
				runIds: file.runIds.filter((runId) => !state.obsoletedRunIds.has(runId)),
			}))
			.filter((file) => file.runIds.length > 0);
		return { ...cloned, runs: liveRuns, files: liveFiles };
	});

	bridge.define('chat.run-change-patch', async (input) => {
		assertAgentChangeScope(input);
		const patch = state.agentRunChangePatches[input.sessionId]?.[input.runId];
		if (!patch) {
			throw new Error(`Unknown fake run change patch: ${input.sessionId}/${input.runId}`);
		}
		return { ...patch };
	});

	bridge.define('chat.session-change-patch', async (input) => {
		assertAgentChangeScope(input);
		const patch = state.agentSessionChangePatches[input.sessionId]?.[input.path];
		if (!patch) {
			throw new Error(`Unknown fake session change patch: ${input.sessionId}/${input.path}`);
		}
		return { ...patch };
	});

	bridge.define('chat.reset-workstream-runs', async (input) => {
		let closed = 0;
		for (const session of state.sessions.values()) {
			if (session.workstreamId === input.workstreamId && session.currentRunId) {
				session.currentRunId = null;
				session.status = 'failed';
				session.cancelled = true;
				closed += 1;
			}
		}
		return closed;
	});

	bridge.define('chat.restore-checkpoint', async (input) => {
		const at = new Date().toISOString();
		let target: FakeSession | null = null;
		let targetEvents: LiveEventEnvelope[] = [];
		let selectedIndex = -1;
		let selectedEnvelope: LiveEventEnvelope | null = null;
		for (const session of state.sessions.values()) {
			if (session.workstreamId !== input.workstreamId) continue;
			const events = state.eventLogBySession.get(session.id) ?? [];
			const index = events.findIndex((envelope) => {
				const event = envelope.event as { type?: string; checkpointId?: string };
				return event.type === 'user.message' && event.checkpointId === input.checkpointId;
			});
			if (index < 0) continue;
			target = session;
			targetEvents = events;
			selectedIndex = index;
			selectedEnvelope = events[index] ?? null;
			break;
		}
		if (!target || selectedIndex < 0 || !selectedEnvelope) {
			throw new Error(`Unknown fake checkpoint: ${input.checkpointId}`);
		}

		const cutSeq = selectedEnvelope.seq;
		const toSeq = targetEvents.at(-1)?.seq ?? cutSeq;
		const cutOrder = state.eventOrder.get(selectedEnvelope);
		const obsoletedBySession = new Map<string, string[]>();
		for (const session of state.sessions.values()) {
			if (session.workstreamId !== input.workstreamId) continue;
			const events = state.eventLogBySession.get(session.id) ?? [];
			const runIds = [...new Set(events.map((envelope) => envelope.runId))];
			const touched = runIds.filter((runId) =>
				events.some((envelope) => {
					if (envelope.runId !== runId) return false;
					const order = state.eventOrder.get(envelope);
					return order !== undefined && cutOrder !== undefined && order >= cutOrder;
				}),
			);
			if (touched.length > 0) obsoletedBySession.set(session.id, touched);
		}
		const obsoletedRunIds = [...obsoletedBySession.values()].flat();
		const restoreSeq = emitAgentEvent(emit, target.id, selectedEnvelope.runId, {
			type: 'checkpoint.restored',
			runId: selectedEnvelope.runId,
			workstreamId: input.workstreamId,
			checkpointId: input.checkpointId,
			salvageRef: `refs/malini/salvage/${input.workstreamId}.undo.fake`,
			salvageCommit: 'fake-salvage-commit',
			fromSeq: cutSeq,
			toSeq,
			obsoletedRunIds,
			at,
		});
		emitAgentEvent(emit, target.id, selectedEnvelope.runId, {
			type: 'turn.superseded',
			runId: selectedEnvelope.runId,
			fromSeq: cutSeq,
			toSeq,
			restoreSeq,
			at,
		});
		for (const [sessionId, runIds] of obsoletedBySession) {
			if (sessionId === target.id) continue;
			for (const runId of runIds) {
				emitAgentEvent(emit, sessionId, runId, {
					type: 'run.obsoleted',
					runId,
					restoreSeq,
					at,
				});
			}
		}

		for (const runId of obsoletedRunIds) state.obsoletedRunIds.add(runId);
		target.currentRunId = null;
		target.status = 'idle';
		target.cancelled = false;
		return {
			sessionId: target.id,
			removedRunCount: obsoletedRunIds.length,
			restoreSeq,
		};
	});

	bridge.define('chat.redo-checkpoint-restore', async (input) => {
		const at = new Date().toISOString();
		const workstreamHasOpenRun = [...state.sessions.values()].some(
			(session) => session.workstreamId === input.workstreamId && session.currentRunId !== null,
		);
		if (workstreamHasOpenRun) {
			throw new Error('wait for the active run to finish before redoing an undo');
		}
		const target = state.sessions.get(input.sessionId);
		if (!target || target.workstreamId !== input.workstreamId) {
			throw new Error(`Unknown fake session: ${input.sessionId}`);
		}
		const events = state.eventLogBySession.get(target.id) ?? [];
		const restoreEnvelope = events.find(
			(envelope) =>
				envelope.seq === input.restoreSeq &&
				(envelope.event as { type?: string }).type === 'checkpoint.restored',
		);
		if (!restoreEnvelope) {
			throw new Error(`no checkpoint.restored event at seq \`${input.restoreSeq}\` in this chat`);
		}
		const alreadyRedone = events.some(
			(envelope) =>
				(envelope.event as { type?: string }).type === 'turn.restored' &&
				(envelope.event as { restoreSeq?: number }).restoreSeq === input.restoreSeq,
		);
		if (alreadyRedone) throw new Error('this undo has already been redone');
		const restoreEvent = restoreEnvelope.event as {
			type: 'checkpoint.restored';
			fromSeq: number;
			toSeq: number;
			salvageCommit?: string | null;
			obsoletedRunIds?: readonly string[];
		};
		if (!restoreEvent.salvageCommit) {
			throw new Error('the undo saved no salvage snapshot; it cannot be redone');
		}
		const hasNewTalk = events.some((envelope) => {
			if (envelope.seq <= input.restoreSeq) return false;
			const type = (envelope.event as { type?: string }).type;
			return type === 'user.message' || type === 'run.started';
		});
		if (hasNewTalk) {
			throw new Error('the chat has new talk since the undo; branch instead');
		}
		const obsoletedRunIds = [...(restoreEvent.obsoletedRunIds ?? [])];
		const restoreOrder = state.eventOrder.get(restoreEnvelope);
		const revertedSessions = new Set<string>();
		for (const runId of obsoletedRunIds) {
			for (const [sessionId, log] of state.eventLogBySession) {
				if (log.some((envelope) => envelope.runId === runId)) {
					revertedSessions.add(sessionId);
				}
			}
		}
		for (const sessionId of revertedSessions) {
			const log = state.eventLogBySession.get(sessionId) ?? [];
			const startedAfter = log.some((envelope) => {
				if ((envelope.event as { type?: string }).type !== 'run.started') return false;
				const order = state.eventOrder.get(envelope);
				return order !== undefined && restoreOrder !== undefined && order > restoreOrder;
			});
			if (startedAfter) {
				throw new Error('a reverted chat has a newer run; branch instead');
			}
		}
		emitAgentEvent(emit, target.id, restoreEnvelope.runId, {
			type: 'turn.restored',
			runId: restoreEnvelope.runId,
			fromSeq: restoreEvent.fromSeq,
			toSeq: restoreEvent.toSeq,
			restoreSeq: input.restoreSeq,
			at,
		});
		const restoredBySession = new Map<string, string[]>();
		for (const runId of obsoletedRunIds) {
			for (const [sessionId, log] of state.eventLogBySession) {
				const obsoleted = log.some(
					(envelope) =>
						envelope.runId === runId &&
						(envelope.event as { type?: string; restoreSeq?: number }).type === 'run.obsoleted' &&
						(envelope.event as { restoreSeq?: number }).restoreSeq === input.restoreSeq,
				);
				if (!obsoleted) continue;
				const runIds = restoredBySession.get(sessionId) ?? [];
				runIds.push(runId);
				restoredBySession.set(sessionId, runIds);
			}
		}
		for (const [sessionId, runIds] of restoredBySession) {
			for (const runId of runIds) {
				emitAgentEvent(emit, sessionId, runId, {
					type: 'run.restored',
					runId,
					restoreSeq: input.restoreSeq,
					at,
				});
			}
		}
		for (const runId of obsoletedRunIds) state.obsoletedRunIds.delete(runId);
		target.currentRunId = null;
		target.status = 'idle';
		target.cancelled = false;
		return {
			sessionId: target.id,
			restoreSeq: input.restoreSeq,
			restoredRunIds: obsoletedRunIds,
		};
	});

	bridge.define('chat.workstream-has-open-run', async (input) => {
		return [...state.sessions.values()].some(
			(session) => session.workstreamId === input.workstreamId && session.currentRunId !== null,
		);
	});

	bridge.define('chat.get-or-create-session', async (input) => {
		if (state.agentSessionBootstrapFailures > 0) {
			state.agentSessionBootstrapFailures -= 1;
			throw new Error(state.agentSessionBootstrapError);
		}
		for (const session of state.sessions.values()) {
			if (session.archivedAt === null && session.workstreamId === input.workstreamId) {
				return session.id;
			}
		}
		const id = `fake-session-${state.nextSession}`;
		state.nextSession += 1;
		state.sessions.set(id, {
			id,
			workstreamId: input.workstreamId,
			displayName: nextFakeChatFallback(state.sessions, input.workstreamId),
			model: input.model,
			startedAt: new Date(state.nextSession * 1_000).toISOString(),
			archivedAt: null,
			status: 'idle',
			hasSentPrompt: false,
			currentRunId: null,
			cancelled: false,
		});
		return id;
	});

	async function runAgentScript(
		session: FakeSession,
		runId: string,
		prompt: string,
		eventEmit: <T>(event: string, payload: T) => void,
	): Promise<void> {
		const context: FakeAgentScriptContext = { sessionId: session.id, runId, prompt };
		for (const step of state.agentScript) {
			await nextScriptStep();
			if (session.cancelled || session.currentRunId !== runId) {
				return;
			}
			const event = materializeAgentEvent(step, context);
			if (event.type === 'fake.wait') {
				const durationMs = Number(event.durationMs);
				await waitForFakeScript(Number.isFinite(durationMs) ? durationMs : 0);
				continue;
			}
			if (event.type === 'file.changed') {
				const path = typeof event.path === 'string' ? event.path : 'src/fake-platform.ts';
				const patch = diffForChangedPath(path);
				state.diffs[session.workstreamId] = patch;
				state.workstreamChangeTotals[session.workstreamId] = changeTotalsForPatch(patch);
				state.workstreamFiles[session.workstreamId] = uniqueSorted([
					...(state.workstreamFiles[session.workstreamId] ?? []),
					path,
				]);
				const sessionFiles = (state.extensionWorkstreamFiles[session.workstreamId] ??= {});
				sessionFiles[path] ??= '';
				const previousStatus = state.workstreamStatuses[session.workstreamId] ?? {
					branch: `malini/${session.workstreamId}`,
					dirtyPaths: [],
					conflictedPaths: [],
					conflictMarkerPaths: [],
					ahead: 0,
					behind: 0,
					hasUpstream: true,
					mergeInProgress: false,
					operationInProgress: null,
					headSha: null,
				};
				state.workstreamStatuses[session.workstreamId] = {
					...previousStatus,
					dirtyPaths: uniqueSorted([...previousStatus.dirtyPaths, path]),
				};
			}
			if (event.type === 'approval.requested' && typeof event.approvalId === 'string') {
				const gate = createFakeInteractionGate();
				state.pendingApprovals.set(fakeInteractionKey(session.id, runId, event.approvalId), gate);
				event.sessionId ??= session.id;
				emitAgentEvent(eventEmit, session.id, runId, event);
				await gate.promise;
				continue;
			}
			if (event.type === 'question.requested' && typeof event.questionId === 'string') {
				const gate = createFakeInteractionGate();
				state.pendingQuestions.set(fakeInteractionKey(session.id, runId, event.questionId), gate);
				event.sessionId ??= session.id;
				emitAgentEvent(eventEmit, session.id, runId, event);
				await gate.promise;
				continue;
			}
			emitAgentEvent(eventEmit, session.id, runId, event);
		}
	}

	function hasPendingSeededInteraction(
		input: Readonly<{
			sessionId: string;
			runId: string;
			approvalId?: string;
			questionId?: string;
		}>,
		type: 'approval.requested' | 'question.requested',
	): boolean {
		const id = input.approvalId ?? input.questionId;
		const log = state.eventLogBySession.get(input.sessionId) ?? [];
		let requested = false;
		for (const envelope of log) {
			if (envelope.runId !== input.runId) continue;
			const event: Record<string, unknown> = isRecord(envelope.event) ? envelope.event : {};
			if (event.type === type && (event.approvalId === id || event.questionId === id)) {
				requested = true;
			}
			if (event.type === 'run.completed' || event.type === 'run.failed') requested = false;
		}
		return requested;
	}

	function markFakeSessionRunning(sessionId: string, runId: string): void {
		const session = state.sessions.get(sessionId);
		if (!session || session.currentRunId !== runId || session.cancelled) return;
		session.status = 'running';
	}

	function settleFakeRunInteractions(sessionId: string, runId: string): void {
		const prefix = `${sessionId}:${runId}:`;
		for (const [key, pending] of state.pendingApprovals) {
			if (!key.startsWith(prefix)) continue;
			state.pendingApprovals.delete(key);
			pending.resolve();
		}
		for (const [key, pending] of state.pendingQuestions) {
			if (!key.startsWith(prefix)) continue;
			state.pendingQuestions.delete(key);
			pending.resolve();
		}
	}

	function emitAgentEvent(
		eventEmit: <T>(event: string, payload: T) => void,
		sessionId: string,
		runId: string,
		event: FakeAgentEvent,
	): number {
		const seq = (state.seqBySession.get(sessionId) ?? 0) + 1;
		state.seqBySession.set(sessionId, seq);
		const { ephemeral, ...eventFields } = event;
		const nextEvent: FakeAgentEvent = {
			...eventFields,
			runId: typeof event.runId === 'string' ? event.runId : runId,
		};
		if (nextEvent.type === 'run.started' && typeof nextEvent.sessionId !== 'string') {
			nextEvent.sessionId = sessionId;
		}
		const envelope: LiveEventEnvelope = {
			sessionId,
			runId,
			seq,
			event: nextEvent,
			...(ephemeral === true ? { ephemeral: true } : {}),
		};
		state.eventOrder.set(envelope, state.nextEventOrder);
		state.nextEventOrder += 1;
		const session = state.sessions.get(sessionId);
		if (session) {
			if (nextEvent.type === 'run.started') {
				session.status = 'running';
				session.currentRunId = runId;
			} else if (
				nextEvent.type === 'approval.requested' ||
				nextEvent.type === 'question.requested'
			) {
				session.status = 'waiting_for_approval';
			} else if (nextEvent.type === 'run.completed') {
				session.status = 'completed';
				session.currentRunId = null;
			} else if (nextEvent.type === 'run.failed') {
				session.status = 'failed';
				session.currentRunId = null;
			}
		}
		appendEventLog(sessionId, envelope);
		eventEmit(CHAT_AGENT_EVENT_CHANNEL, envelope);
		return seq;
	}

	function appendEventLog(sessionId: string, envelope: LiveEventEnvelope): void {
		const log = state.eventLogBySession.get(sessionId) ?? [];
		log.push(envelope);
		state.eventLogBySession.set(sessionId, log);
	}
}

function materializeAgentEvent(
	step: FakeAgentScriptStep,
	context: FakeAgentScriptContext,
): FakeAgentEvent {
	const event = typeof step === 'function' ? step(context) : step;
	const runId = typeof event.runId === 'string' ? event.runId : context.runId;
	if (event.type === 'run.started') {
		return {
			...event,
			runId,
			sessionId: typeof event.sessionId === 'string' ? event.sessionId : context.sessionId,
		};
	}
	return { ...event, runId };
}

function nextMicrotask(): Promise<void> {
	return Promise.resolve();
}

function nextScriptStep(): Promise<void> {
	if (typeof window === 'undefined') return nextMicrotask();
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function waitForFakeScript(durationMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(5_000, durationMs))));
}

const FAKE_ATTACHMENT_MEDIA_TYPES: Readonly<Record<string, string>> = {
	txt: 'text/plain',
	md: 'text/plain',
	log: 'text/plain',
	json: 'application/json',
	pdf: 'application/pdf',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	webp: 'image/webp',
};

function fakeAttachmentMediaType(fileName: string): string | null {
	const extension = fileName.includes('.') ? fileName.split('.').pop() : undefined;
	if (!extension) return null;
	return FAKE_ATTACHMENT_MEDIA_TYPES[extension.toLowerCase()] ?? null;
}

function base64ByteLength(base64: string): number {
	const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
	return Math.max(0, Math.floor(base64.length / 4) * 3 - padding);
}

function diffForChangedPath(path: string): string {
	return [
		`diff --git a/${path} b/${path}`,
		'index 0123abc..4567def 100644',
		`--- a/${path}`,
		`+++ b/${path}`,
		'@@ -1,3 +1,5 @@',
		' export const mode = "fake";',
		'+export const fakePlatform = true;',
		'+export const deterministic = true;',
		' export const owner = "malini";',
	].join('\n');
}

function changeTotalsForPatch(patch: string): WorktreeChangeTotals {
	let additions = 0;
	let deletions = 0;
	let files = 0;
	for (const line of patch.split('\n')) {
		if (line.startsWith('diff --git ')) files += 1;
		if (line.startsWith('+++') || line.startsWith('---')) continue;
		if (line.startsWith('+')) additions += 1;
		else if (line.startsWith('-')) deletions += 1;
	}
	return { additions, deletions, files };
}
