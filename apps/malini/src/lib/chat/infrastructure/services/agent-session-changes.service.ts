import type {
	AgentSessionChangePatch,
	AgentSessionChangeScope,
	AgentSessionChangedFile,
	AgentSessionChanges,
} from '$shared/repositories/repositories.api';
import type {
	AgentSessionFileDiffRequest,
	AgentSessionFileDiffTarget,
} from '$lib/chat/domain/session-file-diff';

export const OPEN_AGENT_SESSION_DIFF_COMMAND = 'malini.repository.open-agent-session-diff';

export const AGENT_SESSION_FILE_DIFF_LIMITS = Object.freeze({
	maxRuns: 64,
	maxPatchBytes: 2 * 1024 * 1024,
	maxTotalPatchBytes: 2 * 1024 * 1024,
	maxPatchLines: 100_000,
	maxPathLength: 4_096,
	maxIdentifierLength: 256,
	maxCommitLength: 128,
	maxCapturedAtLength: 128,
});

type AgentSessionChangesPort = Readonly<{
	getSessionChanges(
		input: AgentSessionChangeScope & { sessionId: string },
	): Promise<AgentSessionChanges>;
	getSessionChangePatch(
		input: AgentSessionChangeScope & {
			sessionId: string;
			path: string;
		},
	): Promise<AgentSessionChangePatch>;
}>;

export class LatestAgentSessionChangesQuery {
	#revision = 0;

	constructor(private readonly port: Pick<AgentSessionChangesPort, 'getSessionChanges'>) {}

	cancel(): void {
		this.#revision += 1;
	}

	async execute(
		input: AgentSessionChangeScope & { sessionId: string },
	): Promise<AgentSessionChanges | null> {
		const revision = ++this.#revision;
		const changes = await this.port.getSessionChanges(input);
		if (revision !== this.#revision) return null;
		if (changes.sessionId !== input.sessionId) {
			throw new Error(
				`Agent session changes returned ${changes.sessionId} while ${input.sessionId} was requested`,
			);
		}
		return changes;
	}
}

export class OpenAgentSessionChangedFileCommand {
	#revision = 0;
	#controller: AbortController | null = null;

	constructor(
		private readonly port: Pick<AgentSessionChangesPort, 'getSessionChangePatch'>,
		private readonly target: AgentSessionFileDiffTarget,
	) {}

	cancel(): void {
		this.#revision += 1;
		this.#controller?.abort();
		this.#controller = null;
	}

	async execute(input: {
		scope: AgentSessionChangeScope;
		changes: AgentSessionChanges;
		file: AgentSessionChangedFile;
	}): Promise<boolean> {
		this.#controller?.abort();
		const revision = ++this.#revision;
		const controller = new AbortController();
		this.#controller = controller;
		try {
			const request = await buildAgentSessionFileDiffRequest(
				this.port,
				input.scope,
				input.changes,
				input.file,
			);
			if (revision !== this.#revision || controller.signal.aborted) return false;
			await this.target.open(input.scope.workstreamId, request, controller.signal);
			return revision === this.#revision && !controller.signal.aborted;
		} finally {
			if (this.#controller === controller) this.#controller = null;
		}
	}
}

export async function buildAgentSessionFileDiffRequest(
	port: Pick<AgentSessionChangesPort, 'getSessionChangePatch'>,
	scope: AgentSessionChangeScope,
	changes: AgentSessionChanges,
	file: AgentSessionChangedFile,
): Promise<AgentSessionFileDiffRequest> {
	assertBoundedString(
		scope.workstreamId,
		'Workstream id',
		AGENT_SESSION_FILE_DIFF_LIMITS.maxIdentifierLength,
	);
	assertBoundedString(
		changes.sessionId,
		'Agent chat id',
		AGENT_SESSION_FILE_DIFF_LIMITS.maxIdentifierLength,
	);
	assertBoundedString(
		file.path,
		'Agent chat changed-file path',
		AGENT_SESSION_FILE_DIFF_LIMITS.maxPathLength,
	);
	const canonicalFile = changes.files.find(({ path }) => path === file.path);
	if (!canonicalFile) {
		throw new Error(`File ${file.path} does not belong to agent chat ${changes.sessionId}`);
	}
	if (canonicalFile.runIds.length === 0) {
		throw new Error(`Agent chat change attribution for ${file.path} has no contributing runs`);
	}
	if (canonicalFile.runIds.length > AGENT_SESSION_FILE_DIFF_LIMITS.maxRuns) {
		throw new Error(
			`Agent chat diff for ${file.path} has ${canonicalFile.runIds.length} runs; at most ${AGENT_SESSION_FILE_DIFF_LIMITS.maxRuns} are supported`,
		);
	}
	for (const runId of canonicalFile.runIds) {
		assertBoundedString(runId, 'Agent run id', AGENT_SESSION_FILE_DIFF_LIMITS.maxIdentifierLength);
	}

	const requestedRunIds = new Set(canonicalFile.runIds);
	if (requestedRunIds.size !== canonicalFile.runIds.length) {
		throw new Error(`Agent chat change attribution for ${file.path} contains duplicate run ids`);
	}
	const contributingRuns = changes.runs.filter(({ runId }) => requestedRunIds.has(runId));
	if (contributingRuns.length !== requestedRunIds.size) {
		throw new Error(`Agent chat change attribution for ${file.path} references an unknown run`);
	}
	for (const run of contributingRuns) {
		assertBoundedString(
			run.runId,
			'Agent run id',
			AGENT_SESSION_FILE_DIFF_LIMITS.maxIdentifierLength,
		);
		if (!run.files.some(({ path }) => path === canonicalFile.path)) {
			throw new Error(`Run ${run.runId} does not attribute ${canonicalFile.path}`);
		}
	}
	assertBoundedString(
		changes.beforeCommit,
		'Agent chat before commit',
		AGENT_SESSION_FILE_DIFF_LIMITS.maxCommitLength,
	);
	assertBoundedString(
		changes.afterCommit,
		'Agent chat after commit',
		AGENT_SESSION_FILE_DIFF_LIMITS.maxCommitLength,
	);
	assertBoundedString(
		changes.capturedAt,
		'Agent chat capture timestamp',
		AGENT_SESSION_FILE_DIFF_LIMITS.maxCapturedAtLength,
	);
	const response = await port.getSessionChangePatch({
		...scope,
		sessionId: changes.sessionId,
		path: canonicalFile.path,
	});
	if (response.sessionId !== changes.sessionId) {
		throw new Error(
			`Agent chat patch returned ${response.sessionId} while ${changes.sessionId} was requested`,
		);
	}
	if (
		response.beforeCommit !== changes.beforeCommit ||
		response.afterCommit !== changes.afterCommit
	) {
		throw new Error('Agent chat patch snapshot does not match the listed net changes');
	}
	let totalPatchBytes = boundedPatchBytes(response.patch, changes.sessionId);
	if (response.turns.length > AGENT_SESSION_FILE_DIFF_LIMITS.maxRuns) {
		throw new Error(`Agent chat diff for ${canonicalFile.path} has too many turns`);
	}
	for (const turn of response.turns) {
		if (!requestedRunIds.has(turn.runId)) {
			throw new Error(`Agent chat turn ${turn.runId} does not attribute ${canonicalFile.path}`);
		}
		totalPatchBytes += boundedPatchBytes(turn.patch, changes.sessionId);
	}
	if (totalPatchBytes > AGENT_SESSION_FILE_DIFF_LIMITS.maxTotalPatchBytes) {
		throw new Error(
			`Agent chat patch ${changes.sessionId} exceeds the ${AGENT_SESSION_FILE_DIFF_LIMITS.maxTotalPatchBytes}-byte limit`,
		);
	}

	return {
		sessionId: changes.sessionId,
		path: canonicalFile.path,
		additions: canonicalFile.additions,
		deletions: canonicalFile.deletions,
		isBinary: canonicalFile.isBinary,
		contributingRunIds: [...canonicalFile.runIds],
		net: {
			beforeCommit: response.beforeCommit,
			afterCommit: response.afterCommit,
			capturedAt: changes.capturedAt,
			patch: response.patch,
		},
		turns: response.turns.map((turn) => ({ ...turn })),
	};
}

function assertBoundedString(
	value: unknown,
	label: string,
	maxLength: number,
): asserts value is string {
	if (typeof value !== 'string' || value.length === 0) {
		throw new Error(`${label} must be a non-empty string`);
	}
	if (value.length > maxLength) {
		throw new Error(`${label} exceeds the ${maxLength}-character limit`);
	}
}

function boundedPatchBytes(patch: unknown, sessionId: string): number {
	if (typeof patch !== 'string') throw new Error(`Agent chat patch ${sessionId} must be a string`);
	if (patch.length > AGENT_SESSION_FILE_DIFF_LIMITS.maxPatchBytes) {
		throw new Error(
			`Agent chat patch ${sessionId} exceeds the ${AGENT_SESSION_FILE_DIFF_LIMITS.maxPatchBytes}-byte limit`,
		);
	}
	const patchBytes = new TextEncoder().encode(patch).byteLength;
	if (patchBytes > AGENT_SESSION_FILE_DIFF_LIMITS.maxPatchBytes) {
		throw new Error(
			`Agent chat patch ${sessionId} exceeds the ${AGENT_SESSION_FILE_DIFF_LIMITS.maxPatchBytes}-byte limit`,
		);
	}
	let lineCount = patch.length === 0 ? 0 : 1;
	for (let index = patch.indexOf('\n'); index !== -1; index = patch.indexOf('\n', index + 1)) {
		lineCount += 1;
		if (lineCount > AGENT_SESSION_FILE_DIFF_LIMITS.maxPatchLines) {
			throw new Error(
				`Agent chat patch ${sessionId} exceeds the ${AGENT_SESSION_FILE_DIFF_LIMITS.maxPatchLines}-line rendering limit`,
			);
		}
	}
	return patchBytes;
}
