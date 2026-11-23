import type { UpdateInfo } from 'electron-updater';
import type { UpdateChange, UpdateRelease } from '$contract/events';

const ITEM = /<li>([\s\S]*?)<\/li>/g;
const TAG = /<[^>]*>/g;
const CREDIT = /\s+by\s+@\S+(?:\s+in\s+\S+)?$/;
const TITLE = /^(feat|fix|perf)(?:\([^)]*\))?!?:\s*(\S[\s\S]*)$/;
const ENTITY = /&(?:#(\d+)|#x([\da-f]+)|(amp|lt|gt|quot|apos));/gi;
const NAMED: Readonly<Record<string, string>> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
};
const KINDS: Readonly<Record<string, UpdateChange['kind']>> = {
	feat: 'feature',
	fix: 'fix',
	perf: 'perf',
};

// ponytail: GitHub's releases feed holds the last 10 releases, so a Mac further behind lists only those; read the releases API if that matters.
export function updateReleases(notes: UpdateInfo['releaseNotes']): UpdateRelease[] {
	if (!Array.isArray(notes)) return [];
	return notes.map(({ version, note }) => ({ version, changes: releaseChanges(note ?? '') }));
}

function releaseChanges(html: string): UpdateChange[] {
	return [...html.matchAll(ITEM)].flatMap(([, item = '']) => {
		const line = decode(item.replace(TAG, '')).replace(/\s+/g, ' ').trim().replace(CREDIT, '');
		const [, type = '', title = ''] = TITLE.exec(line) ?? [];
		const kind = KINDS[type];
		return kind ? [{ kind, summary: title.charAt(0).toUpperCase() + title.slice(1) }] : [];
	});
}

function decode(text: string): string {
	return text.replace(ENTITY, (entity, decimal?: string, hex?: string, name?: string) => {
		if (decimal) return String.fromCodePoint(Number(decimal));
		if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
		return NAMED[name?.toLowerCase() ?? ''] ?? entity;
	});
}
