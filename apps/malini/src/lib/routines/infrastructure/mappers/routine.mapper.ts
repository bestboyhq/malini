import type {
	RoutineEvidence as RawRoutineEvidence,
	RoutinePromptEvidence as RawRoutinePromptEvidence,
	RoutineRecord as RawRoutine,
} from '$contract/routines';
import type { Routine, RoutineEvidence, RoutinePromptEvidence } from '$lib/routines/domain/routine';

export class RoutineMapper {
	static fromRawList(raws: readonly RawRoutine[]): readonly Routine[] {
		return raws.map((raw) => this.fromRaw(raw));
	}

	static fromRaw(raw: RawRoutine): Routine {
		return {
			id: raw.id,
			status: raw.status,
			origin: raw.origin,
			label: raw.label,
			when: raw.when,
			run: raw.run,
			evidence: raw.evidence.map((entry) => this.evidenceFromRaw(entry)),
			createdAt: raw.createdAt,
			updatedAt: raw.updatedAt,
		};
	}

	static evidenceFromRaw(raw: RawRoutineEvidence): RoutineEvidence {
		if (raw.kind === 'prompt') return this.promptEvidenceFromRaw(raw);
		return {
			kind: 'run',
			runId: raw.runId,
			...(raw.sessionId === undefined ? {} : { sessionId: raw.sessionId }),
			...(raw.workstreamId === undefined ? {} : { workstreamId: raw.workstreamId }),
			...(raw.summary === undefined ? {} : { summary: raw.summary }),
		};
	}

	static promptEvidenceFromRaw(raw: RawRoutinePromptEvidence): RoutinePromptEvidence {
		return {
			kind: 'prompt',
			text: raw.text,
			...(raw.runId === undefined ? {} : { runId: raw.runId }),
			...(raw.sessionId === undefined ? {} : { sessionId: raw.sessionId }),
			...(raw.workstreamId === undefined ? {} : { workstreamId: raw.workstreamId }),
			...(raw.submittedAt === undefined ? {} : { submittedAt: raw.submittedAt }),
		};
	}
}
