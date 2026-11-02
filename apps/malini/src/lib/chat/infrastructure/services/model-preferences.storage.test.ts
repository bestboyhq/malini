import { describe, expect, it } from 'vitest';
import {
	chatModelSnapshotKey,
	NEW_CHAT_SETUP_KEY,
	readChatModelSnapshot,
	readChatSetup,
	readNewChatSetup,
	rememberChatPick,
	writeChatModelSnapshot,
} from './model-preferences.storage';

function memoryStorage(seed: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> & {
	values: Map<string, string>;
} {
	const values = new Map(Object.entries(seed));
	return {
		values,
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
	};
}

describe('chat setup', () => {
	it('starts a new chat in any workstream with the last pick, and keeps access per workstream', () => {
		const storage = memoryStorage();
		expect(readNewChatSetup('ws-new', storage)).toEqual({
			selection: { provider: 'claude', model: 'opus' },
			profile: { effort: 'medium', mode: 'agent', access: 'auto', report: 'medium' },
		});

		rememberChatPick(
			'ws-a',
			'session-a',
			{
				selection: { provider: 'claude', model: 'sonnet' },
				profile: { effort: 'low', mode: 'plan', access: 'full', report: 'high' },
			},
			storage,
		);

		expect(readNewChatSetup('ws-new', storage)).toEqual({
			selection: { provider: 'claude', model: 'sonnet' },
			profile: { effort: 'low', mode: 'plan', access: 'auto', report: 'high' },
		});
		expect(readNewChatSetup('ws-a', storage).profile.access).toBe('full');
		expect(readChatSetup('session-a', storage)).toEqual({
			selection: { provider: 'claude', model: 'sonnet' },
			profile: { effort: 'low', mode: 'plan', access: 'full', report: 'high' },
		});
		expect(readChatSetup('session-b', storage)).toBeNull();
	});

	it('starts the first new chat after the update with the effort, report and model picked before it', () => {
		const storage = memoryStorage({
			'malini.chat.last-effort:v1': JSON.stringify('xhigh'),
			'malini.chat.last-report:v1': JSON.stringify('low'),
			'malini.chat.model-memory:v2': JSON.stringify({
				planning: { provider: 'claude', model: 'opus' },
				implementation: { provider: 'claude', model: 'haiku' },
			}),
		});

		expect(readNewChatSetup('ws-old', storage)).toEqual({
			selection: { provider: 'claude', model: 'haiku' },
			profile: { effort: 'xhigh', mode: 'agent', access: 'auto', report: 'low' },
		});
	});

	it('repairs a corrupt last pick from the defaults', () => {
		const storage = memoryStorage({ [NEW_CHAT_SETUP_KEY]: '{"profile":{"effort":"huge"}}' });
		expect(readNewChatSetup('ws-a', storage)).toEqual({
			selection: { provider: 'claude', model: 'opus' },
			profile: { effort: 'medium', mode: 'agent', access: 'auto', report: 'medium' },
		});
	});

	it('persists an immutable role/model snapshot per chat', () => {
		const storage = memoryStorage();
		writeChatModelSnapshot(
			'session-a',
			{ role: 'planning', selection: { provider: 'claude', model: 'opus' } },
			storage,
		);

		expect(JSON.parse(storage.values.get(chatModelSnapshotKey('session-a')) ?? '')).toEqual({
			role: 'planning',
			selection: { provider: 'claude', model: 'opus' },
		});
		expect(readChatModelSnapshot('session-a', storage)).toEqual({
			role: 'planning',
			selection: { provider: 'claude', model: 'opus' },
		});
	});

	it('gives a snapshot stored before providers existed the provider its model belongs to', () => {
		const storage = memoryStorage({
			[chatModelSnapshotKey('session-claude')]: JSON.stringify({
				role: 'implementation',
				selection: { model: 'sonnet' },
			}),
			[chatModelSnapshotKey('session-deepseek')]: JSON.stringify({
				role: 'planning',
				selection: { model: 'deepseek-v4-pro' },
			}),
		});

		expect(readChatModelSnapshot('session-claude', storage)?.selection).toEqual({
			provider: 'claude',
			model: 'sonnet',
		});
		expect(readChatModelSnapshot('session-deepseek', storage)?.selection).toEqual({
			provider: 'deepseek',
			model: 'deepseek-v4-pro',
		});
	});
});
