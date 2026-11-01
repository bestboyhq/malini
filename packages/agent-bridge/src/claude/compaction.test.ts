import { describe, expect, it } from 'vitest';
import type { ConversationHistoryMessage } from '../protocol.js';
import {
	HOOK_CONTEXT_CHARACTERS,
	previousConversation,
	RECORD_PARTS,
	recordParts,
} from './compaction.js';

describe('recordParts', () => {
	it('fits the largest record the bridge accepts into parts that rebuild it exactly', () => {
		const messages: ConversationHistoryMessage[] = Array.from({ length: 4_096 }, (_, index) => ({
			role: index % 2 === 0 ? 'user' : 'assistant',
			content: `${index}`.padEnd(64, '.'),
		}));

		const parts = recordParts(messages);

		expect(parts.length).toBeLessThanOrEqual(RECORD_PARTS);
		expect(parts.every((part) => part.length <= HOOK_CONTEXT_CHARACTERS)).toBe(true);
		expect(parts.join('\n').endsWith(previousConversation(messages))).toBe(true);
	});

	it('cuts a line longer than a part between whole characters', () => {
		const parts = recordParts([{ role: 'user', content: '🦀'.repeat(30_000) }]);

		expect(parts.length).toBeGreaterThan(1);
		expect(parts.every((part) => part.length <= HOOK_CONTEXT_CHARACTERS)).toBe(true);
		expect(parts.every((part) => Buffer.from(part).toString() === part)).toBe(true);
	});

	it('puts nothing back for a chat without messages', () => {
		expect(recordParts([])).toEqual([]);
	});
});
