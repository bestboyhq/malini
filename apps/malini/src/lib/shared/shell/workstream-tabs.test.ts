import { describe, expect, it } from 'vitest';
import {
	closeWorkstreamChat,
	closeWorkstreamDocument,
	leaveWorkstreamDocuments,
	NO_WORKSTREAM_TABS,
	openWorkstreamDocument,
	pinWorkstreamDocument,
	readWorkstreamTabs,
	startWorkstreamFreshChat,
	syncWorkstreamChats,
	type WorkstreamTabs,
} from './workstream-tabs';

function open(state: WorkstreamTabs, ...paths: readonly string[]): WorkstreamTabs {
	return paths.reduce(
		(current, path) =>
			openWorkstreamDocument(current, {
				id: path,
				label: path,
				icon: `path:${path}`,
				tooltip: path,
			}),
		state,
	);
}

function strip(state: WorkstreamTabs): readonly string[] {
	return state.tabs.map((tab) =>
		tab.kind === 'chat' ? `chat ${tab.id}` : tab.preview ? `(${tab.id})` : tab.id,
	);
}

const chatsAB = syncWorkstreamChats(NO_WORKSTREAM_TABS, ['a', 'b'], 'a');

describe('the center tab strip', () => {
	it('keeps the order chats already had the first time it sees them', () => {
		expect(strip(chatsAB)).toEqual(['chat a', 'chat b']);
	});

	it('puts a new chat right after the chat it was started from, even through a fresh chat', () => {
		const fresh = syncWorkstreamChats(chatsAB, ['a', 'b'], null);
		const started = syncWorkstreamChats(fresh, ['c', 'a', 'b'], 'c');
		expect(strip(started)).toEqual(['chat a', 'chat c', 'chat b']);
	});

	it('puts a branch right after its parent when it shows up before or after the route moves', () => {
		const onB = syncWorkstreamChats(chatsAB, ['a', 'b'], 'b');
		expect(strip(syncWorkstreamChats(onB, ['a', 'b', 'x'], 'b'))).toEqual([
			'chat a',
			'chat b',
			'chat x',
		]);
		const routedFirst = syncWorkstreamChats(onB, ['a', 'b'], 'x');
		expect(strip(syncWorkstreamChats(routedFirst, ['a', 'b', 'x'], 'x'))).toEqual([
			'chat a',
			'chat b',
			'chat x',
		]);
	});

	it('keeps a fresh chat where it was started while files open around it', () => {
		let state = syncWorkstreamChats(NO_WORKSTREAM_TABS, [], null);
		state = open(pinWorkstreamDocument(open(state, 'f.ts'), 'f.ts'), 'g.ts');
		state = syncWorkstreamChats(state, ['n'], 'n');
		expect(strip(state)).toEqual(['f.ts', '(g.ts)', 'chat n']);
	});

	it('starts a new chat after the file in view', () => {
		let state = startWorkstreamFreshChat(open(chatsAB, 'f.ts'));
		expect(state.activeDocumentId).toBeNull();
		state = syncWorkstreamChats(syncWorkstreamChats(state, ['a', 'b'], null), ['a', 'b', 'n'], 'n');
		expect(strip(state)).toEqual(['chat a', '(f.ts)', 'chat n', 'chat b']);
	});

	it('opens a file as a preview right after the current chat', () => {
		const state = open(chatsAB, 'f.ts');
		expect(strip(state)).toEqual(['chat a', '(f.ts)', 'chat b']);
		expect(state.activeDocumentId).toBe('f.ts');
	});

	it('replaces the preview in place and adds after the current tab once it is kept', () => {
		let state = open(chatsAB, 'f.ts', 'g.ts');
		expect(strip(state)).toEqual(['chat a', '(g.ts)', 'chat b']);
		state = open(pinWorkstreamDocument(state, 'g.ts'), 'h.ts');
		expect(strip(state)).toEqual(['chat a', 'g.ts', '(h.ts)', 'chat b']);
	});

	it('focuses a file that already has a tab without adding or replacing one', () => {
		let state = open(pinWorkstreamDocument(open(chatsAB, 'f.ts'), 'f.ts'), 'g.ts');
		state = open(state, 'f.ts');
		expect(strip(state)).toEqual(['chat a', 'f.ts', '(g.ts)', 'chat b']);
		expect(state.activeDocumentId).toBe('f.ts');
	});

	it('opens a file after the chat in view once the files are left', () => {
		let state = pinWorkstreamDocument(open(chatsAB, 'f.ts'), 'f.ts');
		state = syncWorkstreamChats(leaveWorkstreamDocuments(state), ['a', 'b'], 'b');
		expect(strip(open(state, 'g.ts'))).toEqual(['chat a', 'f.ts', 'chat b', '(g.ts)']);
	});

	it('closes the active file onto its neighbour, and back to the chat when it was the last', () => {
		let state = open(pinWorkstreamDocument(open(chatsAB, 'f.ts'), 'f.ts'), 'g.ts');
		state = closeWorkstreamDocument(state, 'g.ts');
		expect(state.activeDocumentId).toBe('f.ts');
		state = closeWorkstreamDocument(state, 'f.ts');
		expect(state.activeDocumentId).toBeNull();
		expect(strip(state)).toEqual(['chat a', 'chat b']);
	});

	it('forgets a chat only when it is closed, not while the chat list is still loading', () => {
		expect(strip(syncWorkstreamChats(chatsAB, [], 'a'))).toEqual(['chat a', 'chat b']);
		expect(strip(closeWorkstreamChat(chatsAB, 'a'))).toEqual(['chat b']);
	});

	it('restores only well-formed saved tabs and an active file that still exists', () => {
		const saved = open(chatsAB, 'f.ts');
		expect(readWorkstreamTabs(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
		expect(
			readWorkstreamTabs({ tabs: [{ kind: 'document', id: 'x' }], activeDocumentId: 'x' }),
		).toEqual(NO_WORKSTREAM_TABS);
		expect(readWorkstreamTabs('garbage')).toEqual(NO_WORKSTREAM_TABS);
	});
});
