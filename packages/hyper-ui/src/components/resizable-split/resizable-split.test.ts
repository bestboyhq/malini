import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
	clampRatio,
	clampSize,
	closedSecondaryGridTemplate,
	defaultStorageKey,
	gridTemplate,
	loadPanelRatio,
	loadPanelSize,
	readPanelRatio,
	savePanelRatio,
	savePanelSize,
} from './resizable-split';

function installLocalStorageStub(): void {
	const store = new Map<string, string>();
	const storage: Storage = {
		getItem: (key: string): string | null => store.get(key) ?? null,
		setItem: (key: string, value: string): void => {
			store.set(key, value);
		},
		removeItem: (key: string): void => {
			store.delete(key);
		},
		clear: (): void => {
			store.clear();
		},
		key: (index: number): string | null => Array.from(store.keys())[index] ?? null,
		get length(): number {
			return store.size;
		},
	};
	(globalThis as { localStorage?: Storage }).localStorage = storage;
}

beforeEach(() => {
	installLocalStorageStub();
});

afterEach(() => {
	delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe('clampSize', () => {
	it('returns the floor when value is below min', () => {
		expect(clampSize(50, 100, 200)).toBe(100);
	});

	it('returns the ceiling when value is above max', () => {
		expect(clampSize(250, 100, 200)).toBe(200);
	});

	it('returns value unchanged when inside the range', () => {
		expect(clampSize(150, 100, 200)).toBe(150);
	});

	it('treats NaN as the floor', () => {
		expect(clampSize(Number.NaN, 100, 200)).toBe(100);
	});

	it('treats Infinity as the ceiling', () => {
		expect(clampSize(Number.POSITIVE_INFINITY, 100, 200)).toBe(200);
	});
});

describe('clampRatio', () => {
	it('keeps a usable panel on both sides', () => {
		expect(clampRatio(0)).toBe(0.05);
		expect(clampRatio(0.6)).toBe(0.6);
		expect(clampRatio(1)).toBe(0.95);
	});

	it('uses a balanced fallback for non-finite input', () => {
		expect(clampRatio(Number.NaN)).toBe(0.5);
		expect(clampRatio(Number.POSITIVE_INFINITY)).toBe(0.5);
	});
});

describe('loadPanelSize', () => {
	it('returns the clamped fallback when storage is empty', () => {
		expect(loadPanelSize('panel:threads-list', 384, 260, 560)).toBe(384);
	});

	it('returns the clamped fallback when storage is absent', () => {
		delete (globalThis as { localStorage?: Storage }).localStorage;
		expect(loadPanelSize('panel:threads-list', 384, 260, 560)).toBe(384);
	});

	it('returns the stored value when inside the range', () => {
		globalThis.localStorage.setItem('panel:threads-list', '500');
		expect(loadPanelSize('panel:threads-list', 384, 260, 560)).toBe(500);
	});

	it('clamps a stored value above the ceiling', () => {
		globalThis.localStorage.setItem('panel:threads-list', '999');
		expect(loadPanelSize('panel:threads-list', 384, 260, 560)).toBe(560);
	});

	it('clamps a stored value below the floor', () => {
		globalThis.localStorage.setItem('panel:threads-list', '42');
		expect(loadPanelSize('panel:threads-list', 384, 260, 560)).toBe(260);
	});

	it('returns the fallback when stored value is garbage (non-numeric)', () => {
		globalThis.localStorage.setItem('panel:threads-list', 'not-a-number');
		expect(loadPanelSize('panel:threads-list', 384, 260, 560)).toBe(384);
	});

	it('returns the fallback when stored value is an empty string', () => {
		globalThis.localStorage.setItem('panel:threads-list', '');
		expect(loadPanelSize('panel:threads-list', 384, 260, 560)).toBe(384);
	});
});

describe('savePanelSize', () => {
	it('round-trips a value through localStorage', () => {
		savePanelSize('panel:threads-list', 432);
		expect(loadPanelSize('panel:threads-list', 384, 260, 560)).toBe(432);
	});

	it('rounds fractional values before persisting', () => {
		savePanelSize('panel:threads-list', 432.7);
		expect(globalThis.localStorage.getItem('panel:threads-list')).toBe('433');
	});
});

describe('panel ratio storage', () => {
	it('round-trips a resize ratio independently of viewport width', () => {
		savePanelRatio('panel:transcript', 0.62346);
		expect(loadPanelRatio('panel:transcript', 0.6)).toBe(0.62346);
	});

	it('preserves a small but real drag on a wide desktop window', () => {
		savePanelRatio('panel:transcript', 0.5727923627684964);
		expect(loadPanelRatio('panel:transcript', 0.6)).toBe(0.572792);
	});

	it('uses the fallback for missing or invalid values', () => {
		expect(loadPanelRatio('panel:transcript', 0.6)).toBe(0.6);
		globalThis.localStorage.setItem('panel:transcript', 'invalid');
		expect(loadPanelRatio('panel:transcript', 0.6)).toBe(0.6);
	});

	it('separates a pane nobody dragged from one dragged to the fallback proportion', () => {
		expect(readPanelRatio('panel:transcript')).toBeNull();
		globalThis.localStorage.setItem('panel:transcript', '   ');
		expect(readPanelRatio('panel:transcript')).toBeNull();
		globalThis.localStorage.setItem('panel:transcript', 'invalid');
		expect(readPanelRatio('panel:transcript')).toBeNull();

		savePanelRatio('panel:transcript', 0.6);
		expect(readPanelRatio('panel:transcript')).toBe(0.6);
	});

	it('clamps an out-of-bounds stored ratio on read without rewriting it', () => {
		globalThis.localStorage.setItem('panel:transcript', '0.99');
		expect(readPanelRatio('panel:transcript')).toBe(0.95);
		expect(globalThis.localStorage.getItem('panel:transcript')).toBe('0.99');
	});
});

describe('gridTemplate', () => {
	it('formats horizontal axis with handle track between a and b', () => {
		expect(gridTemplate(384, 'horizontal')).toBe('384px auto minmax(0, 1fr)');
	});

	it('formats vertical axis with handle track between a and b', () => {
		expect(gridTemplate(384, 'vertical')).toBe('minmax(0, 1fr) auto 384px');
	});

	it('rounds fractional sizes before formatting', () => {
		expect(gridTemplate(384.6, 'horizontal')).toBe('385px auto minmax(0, 1fr)');
	});
});

describe('closedSecondaryGridTemplate', () => {
	it('hands the whole split back to the primary pane instead of leaving a gap', () => {
		expect(closedSecondaryGridTemplate()).toBe('minmax(0, 1fr) auto');
		expect(closedSecondaryGridTemplate()).not.toContain('px');
	});

	it('keeps the saved size untouched so reopening restores the chosen width', () => {
		savePanelRatio('malini.app.panel:workstream-transcript-ratio-v1', 0.44);
		closedSecondaryGridTemplate();

		expect(loadPanelRatio('malini.app.panel:workstream-transcript-ratio-v1', 0.6)).toBe(0.44);
	});
});

describe('ResizableSplit closed secondary pane', () => {
	const source = readFileSync(new URL('./ResizableSplit.svelte', import.meta.url), 'utf8');

	it('keeps the closed pane mounted so its caller loses no state', () => {
		expect(source).toContain('secondaryOpen = true');
		expect(source).toContain('const secondaryClosed = $derived(!secondaryOpen)');
		expect(source).toContain(
			'secondaryClosed ? closedSecondaryGridTemplate() : gridTemplate(size, axis)',
		);
		expect(source).not.toContain('{#if secondaryOpen}');
	});

	it('removes the drag handle while there is no boundary to drag', () => {
		expect(source).toContain('const showHandle = $derived(!secondaryClosed)');
		expect(source).toContain('{#if showHandle}');
		expect(source).toContain("data-secondary-open={secondaryOpen ? 'true' : 'false'}");
	});

	it('holds a declared default size until someone resizes, then follows their proportion', () => {
		expect(source).toContain('const storedRatio = readPanelRatio(key)');
		expect(source).toContain(
			'usingDefaultSize = storedRatio === null && defaultSize !== undefined',
		);
		expect(source).toContain(
			'applySize(usingDefaultSize ? fallbackSize : containerExtent * panelRatio, false)',
		);
		expect(source).toContain('usingDefaultSize = false;');
		expect(source).not.toContain('loadPanelRatio');
	});
});

describe('defaultStorageKey', () => {
	it('prefixes the panelId with the malini.app.panel: namespace', () => {
		expect(defaultStorageKey('chatter-threads-list')).toBe('malini.app.panel:chatter-threads-list');
	});
});

describe('double-click reset math', () => {
	it('clamps the defaultSize when setting ondblclick state', () => {
		const resetToFloor = clampSize(50, 260, 560);
		const resetToCeiling = clampSize(800, 260, 560);
		const resetInside = clampSize(384, 260, 560);

		expect(resetToFloor).toBe(260);
		expect(resetToCeiling).toBe(560);
		expect(resetInside).toBe(384);
	});
});
