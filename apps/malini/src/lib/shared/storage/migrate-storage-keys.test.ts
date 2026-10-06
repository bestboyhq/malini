import { describe, expect, it } from 'vitest';
import { migrateStorageKeys, migratedStorageKey } from './migrate-storage-keys';
import { WORKSTREAM_TRANSCRIPT_RATIO_KEY } from './panel-storage-keys';

function memoryStorage(seed: Record<string, string> = {}): Storage {
	const entries = new Map<string, string>(Object.entries(seed));
	return {
		get length() {
			return entries.size;
		},
		key: (index: number) => [...entries.keys()][index] ?? null,
		getItem: (key: string) => entries.get(key) ?? null,
		setItem: (key: string, value: string) => {
			entries.set(key, value);
		},
		removeItem: (key: string) => {
			entries.delete(key);
		},
		clear: () => entries.clear(),
	};
}

describe('migratedStorageKey', () => {
	it('maps every legacy prefix onto its malini namespace', () => {
		expect(migratedStorageKey('core.desktop.agentic.model-memory:v1:ws-1')).toBe(
			'malini.chat.model-memory:v1:ws-1',
		);
		expect(migratedStorageKey('core.agentic.extension-workstream-reservations.v1')).toBe(
			'malini.chat.extension-workstream-reservations.v1',
		);
		expect(migratedStorageKey('core.agent.something')).toBe('malini.chat.something');
		expect(migratedStorageKey('core.desktop.extensions.inspector-drawer-v1:ws-1')).toBe(
			'malini.extensions.inspector-drawer-v1:ws-1',
		);
		expect(migratedStorageKey('core.extensions.settings.v1/acme/global/mode')).toBe(
			'malini.extensions.settings.v1/acme/global/mode',
		);
		expect(migratedStorageKey('core.desktop.extension-state.v1')).toBe(
			'malini.extensions.state.v1',
		);
		expect(migratedStorageKey('core.desktop.last-route-v1')).toBe('malini.app.last-route-v1');
		expect(migratedStorageKey('core.desktop.panel:shell-sidebar')).toBe(
			'malini.app.panel:shell-sidebar',
		);
		expect(migratedStorageKey('agentic:draft:ws-1')).toBe('malini.chat.draft:ws-1');
		expect(migratedStorageKey('agentic:draft-context:ws-1')).toBe('malini.chat.draft-context:ws-1');
	});

	it('renames the transcript split ratio off the agentic name', () => {
		expect(migratedStorageKey('malini.app.panel:agentic-transcript-ratio-v3')).toBe(
			WORKSTREAM_TRANSCRIPT_RATIO_KEY,
		);
		expect(WORKSTREAM_TRANSCRIPT_RATIO_KEY).toBe('malini.app.panel:workstream-transcript-ratio-v3');
	});

	it('follows a Core-era key through every rename it has had', () => {
		expect(migratedStorageKey('core.desktop.panel:agentic-transcript-ratio-v3')).toBe(
			WORKSTREAM_TRANSCRIPT_RATIO_KEY,
		);
	});

	it('moves smack keys and the extension ids inside them to malini', () => {
		expect(migratedStorageKey('smack.chat.draft:ws-1')).toBe('malini.chat.draft:ws-1');
		expect(migratedStorageKey('smack.chat.model-favorites-v1')).toBe(
			'malini.providers.model-favorites:v1',
		);
		expect(
			migratedStorageKey('smack.extensions.settings.v1/smack.repository/global/smack.repository.x'),
		).toBe('malini.extensions.settings.v1/malini.repository/global/malini.repository.x');
		expect(migratedStorageKey('smack.app.panel:agentic-transcript-ratio-v3')).toBe(
			WORKSTREAM_TRANSCRIPT_RATIO_KEY,
		);
	});

	it('leaves extension command, panel and event ids alone', () => {
		expect(migratedStorageKey('core.repository.files-panel')).toBeNull();
		expect(migratedStorageKey('malini.chat.draft:ws-1')).toBeNull();
		expect(migratedStorageKey(WORKSTREAM_TRANSCRIPT_RATIO_KEY)).toBeNull();
	});
});

describe('migrateStorageKeys', () => {
	it('copies each legacy key onto its new name and removes the source', () => {
		const storage = memoryStorage({
			'agentic:draft:ws-1': 'Tighten the hero copy',
			'core.desktop.agentic.model-memory:v1:ws-1': 'opus',
			'core.desktop.panel:shell-sidebar': '320',
			'smack.chat.draft:ws-2': 'Ship the rename',
			unrelated: 'keep me',
		});

		migrateStorageKeys(storage);

		expect(storage.getItem('malini.chat.draft:ws-2')).toBe('Ship the rename');
		expect(storage.getItem('smack.chat.draft:ws-2')).toBeNull();
		expect(storage.getItem('malini.chat.draft:ws-1')).toBe('Tighten the hero copy');
		expect(storage.getItem('malini.chat.model-memory:v1:ws-1')).toBe('opus');
		expect(storage.getItem('malini.app.panel:shell-sidebar')).toBe('320');
		expect(storage.getItem('agentic:draft:ws-1')).toBeNull();
		expect(storage.getItem('core.desktop.agentic.model-memory:v1:ws-1')).toBeNull();
		expect(storage.getItem('unrelated')).toBe('keep me');
	});

	it('keeps an existing target value and is idempotent', () => {
		const storage = memoryStorage({
			'agentic:draft:ws-1': 'stale',
			'malini.chat.draft:ws-1': 'current',
		});

		migrateStorageKeys(storage);
		migrateStorageKeys(storage);

		expect(storage.getItem('malini.chat.draft:ws-1')).toBe('current');
		expect(storage.getItem('agentic:draft:ws-1')).toBeNull();
		expect(storage.length).toBe(1);
	});

	it('moves the transcript split ratio once and never over a newer value', () => {
		const fresh = memoryStorage({ 'malini.app.panel:agentic-transcript-ratio-v3': '0.55' });
		migrateStorageKeys(fresh);
		migrateStorageKeys(fresh);
		expect(fresh.getItem(WORKSTREAM_TRANSCRIPT_RATIO_KEY)).toBe('0.55');
		expect(fresh.getItem('malini.app.panel:agentic-transcript-ratio-v3')).toBeNull();
		expect(fresh.length).toBe(1);

		const coreEra = memoryStorage({ 'core.desktop.panel:agentic-transcript-ratio-v3': '0.4' });
		migrateStorageKeys(coreEra);
		expect(coreEra.getItem(WORKSTREAM_TRANSCRIPT_RATIO_KEY)).toBe('0.4');
		expect(coreEra.length).toBe(1);

		const both = memoryStorage({
			'malini.app.panel:agentic-transcript-ratio-v3': '0.3',
			[WORKSTREAM_TRANSCRIPT_RATIO_KEY]: '0.7',
		});
		migrateStorageKeys(both);
		expect(both.getItem(WORKSTREAM_TRANSCRIPT_RATIO_KEY)).toBe('0.7');
		expect(both.length).toBe(1);
	});

	it('drops per-file split ratios nothing reads any more', () => {
		const storage = memoryStorage({
			'malini.app.panel:agentic-transcript-ratio-v2:core.repository.file:package.json': '0.5',
			'core.desktop.panel:agentic-transcript-ratio-v2:core.repository.file:a.ts': '0.6',
			'malini.app.panel:shell-sidebar': '280',
		});

		migrateStorageKeys(storage);

		expect(storage.length).toBe(1);
		expect(storage.getItem('malini.app.panel:shell-sidebar')).toBe('280');
	});
});
