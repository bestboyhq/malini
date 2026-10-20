import type { EventEnvelope } from './events';

export type TranscriptSummary = Readonly<{
	hasConversation: boolean;
	latestPlanText: string | null;
	latestTerminalKey: string | null;
}>;

export const EMPTY_TRANSCRIPT_SUMMARY: TranscriptSummary = Object.freeze({
	hasConversation: false,
	latestPlanText: null,
	latestTerminalKey: null,
});

export function extendTranscriptSummary(
	summary: TranscriptSummary,
	envelopes: readonly EventEnvelope[],
): TranscriptSummary {
	let { hasConversation, latestPlanText, latestTerminalKey } = summary;
	for (const { event, runId, seq } of envelopes) {
		switch (event.type) {
			case 'user.message':
			case 'assistant.message':
			case 'run.started':
				hasConversation = true;
				break;
			case 'plan.updated':
				latestPlanText = event.text;
				break;
			case 'run.completed':
			case 'run.failed':
				latestTerminalKey = `${runId}:${seq}`;
				break;
			default:
				break;
		}
	}
	if (
		hasConversation === summary.hasConversation &&
		latestPlanText === summary.latestPlanText &&
		latestTerminalKey === summary.latestTerminalKey
	) {
		return summary;
	}
	return { hasConversation, latestPlanText, latestTerminalKey };
}

export function summarizeTranscript(envelopes: readonly EventEnvelope[]): TranscriptSummary {
	return extendTranscriptSummary(EMPTY_TRANSCRIPT_SUMMARY, envelopes);
}
