export type AgentTranscriptReference = Readonly<{
	sessionId: string;
	label: string;
}>;

export const MAX_AGENT_TRANSCRIPT_REFERENCES = 5;
const MAX_TRANSCRIPT_REFERENCE_ID_BYTES = 256;
const MAX_TRANSCRIPT_REFERENCE_LABEL_BYTES = 160;

function utf8Bytes(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

export function sanitizeAgentTranscriptReferences(value: unknown): AgentTranscriptReference[] {
	if (!Array.isArray(value)) return [];
	const seen = new Set<string>();
	const references: AgentTranscriptReference[] = [];
	for (const candidate of value) {
		if (!candidate || typeof candidate !== 'object') continue;
		const sessionId = (candidate as { sessionId?: unknown }).sessionId;
		const label = (candidate as { label?: unknown }).label;
		if (typeof sessionId !== 'string' || typeof label !== 'string') continue;
		const normalizedSessionId = sessionId.trim();
		const normalizedLabel = label.trim();
		if (
			!normalizedSessionId ||
			!normalizedLabel ||
			utf8Bytes(normalizedSessionId) > MAX_TRANSCRIPT_REFERENCE_ID_BYTES ||
			utf8Bytes(normalizedLabel) > MAX_TRANSCRIPT_REFERENCE_LABEL_BYTES ||
			/[\n\r\0]/u.test(normalizedSessionId) ||
			/[\n\r\0]/u.test(normalizedLabel) ||
			seen.has(normalizedSessionId)
		) {
			continue;
		}
		seen.add(normalizedSessionId);
		references.push({ sessionId: normalizedSessionId, label: normalizedLabel });
		if (references.length >= MAX_AGENT_TRANSCRIPT_REFERENCES) break;
	}
	return references;
}
