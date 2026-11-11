import { describe, expect, it } from 'vitest';
import type { ContextMedia } from '$contract/workstream-images';
import { contextMediaTabs, touchesContextMedia } from './context-media';

function item(path: string, category: ContextMedia['category']): ContextMedia {
	return { path, size: 1, modifiedAt: '2026-01-01T00:00:00.000Z', category };
}

describe('touchesContextMedia', () => {
	it('reads again when a change lands in .context, or when the watcher lost count', () => {
		expect(touchesContextMedia(['.context/shot.png'])).toBe(true);
		expect(touchesContextMedia(['src/app.ts', '.context'])).toBe(true);
		expect(touchesContextMedia(null)).toBe(true);
	});

	it('stays put for changes anywhere else', () => {
		expect(touchesContextMedia([])).toBe(false);
		expect(touchesContextMedia(['src/app.ts', '.contextual/shot.png', 'docs/.context/a.png'])).toBe(
			false,
		);
	});
});

describe('contextMediaTabs', () => {
	it('counts every file under All, then each category that has files, in a fixed order', () => {
		expect(
			contextMediaTabs([
				item('.context/notes.md', 'documents'),
				item('.context/a.png', 'images'),
				item('.context/voice.mp3', 'audio'),
				item('.context/b.png', 'images'),
			]),
		).toEqual([
			{ category: 'all', count: 4 },
			{ category: 'images', count: 2 },
			{ category: 'audio', count: 1 },
			{ category: 'documents', count: 1 },
		]);
	});
});
