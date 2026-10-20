import { describe, expect, it } from 'vitest';
import {
	MAX_AGENT_TRANSCRIPT_REFERENCES,
	sanitizeAgentTranscriptReferences,
} from './transcript-reference';

describe('transcript references', () => {
	it('normalizes, deduplicates, and caps references', () => {
		const values = Array.from({ length: MAX_AGENT_TRANSCRIPT_REFERENCES + 2 }, (_, index) => ({
			sessionId: ` session-${index} `,
			label: ` Chat ${index} `,
		}));
		values.splice(1, 0, { sessionId: 'session-0', label: 'duplicate' });

		expect(sanitizeAgentTranscriptReferences(values)).toEqual(
			Array.from({ length: MAX_AGENT_TRANSCRIPT_REFERENCES }, (_, index) => ({
				sessionId: `session-${index}`,
				label: `Chat ${index}`,
			})),
		);
	});

	it('rejects malformed identifiers and labels', () => {
		expect(
			sanitizeAgentTranscriptReferences([
				{ sessionId: '', label: 'Empty ID' },
				{ sessionId: 'session-1\nforged', label: 'Forged' },
				{ sessionId: 'session-2', label: '' },
				{ sessionId: 'session-3', label: 'bad\nlabel' },
				{ sessionId: 'ż'.repeat(129), label: 'Too many UTF-8 bytes' },
				{ sessionId: 'session-4', label: 'ż'.repeat(81) },
			]),
		).toEqual([]);
	});
});
