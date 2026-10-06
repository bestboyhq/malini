import { describe, expect, it } from 'vitest';
import { agentDraftScopeKey } from '$lib/chat/domain/draft';
import { AgentDrafts } from './agent-drafts.aggregate.svelte';

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function memoryStorage(seed: Record<string, string> = {}): DraftStorage {
	const values = new Map(Object.entries(seed));
	return {
		getItem(key) {
			return values.get(key) ?? null;
		},
		setItem(key, value) {
			values.set(key, value);
		},
		removeItem(key) {
			values.delete(key);
		},
	};
}

describe('AgentDrafts', () => {
	const attachment = {
		id: 'att-00000000000000000000000000000001',
		displayName: 'brief.pdf',
		relativePath: '.malini/agent-attachments/att-00000000000000000000000000000001/brief.pdf',
		mediaType: 'application/pdf',
		size: 42,
		sha256: 'a'.repeat(64),
	};
	const issueReference = {
		provider: 'linear' as const,
		identifier: 'SMK-123',
		url: 'https://linear.app/acme/issue/SMK-123',
	};

	it('reads a durable text and context draft without hydrating it, and sanitizes corrupt context entries', () => {
		const drafts = new AgentDrafts(
			memoryStorage({
				'malini.chat.draft:ws-1': 'Tighten the hero copy',
				'malini.chat.draft-context:ws-1': JSON.stringify([
					'src/routes/+page.svelte',
					'  src/routes/+page.svelte  ',
					'',
					42,
				]),
			}),
		);

		expect(drafts.draftFor('ws-1')).toEqual({
			text: 'Tighten the hero copy',
			contextFiles: ['src/routes/+page.svelte'],
			attachments: [],
			issueReferences: [],
			transcriptReferences: [],
			elementReferences: [],
		});
		expect(drafts.hasDraft('ws-1')).toBe(false);

		drafts.hydrate('ws-1');

		expect(drafts.hasDraft('ws-1')).toBe(true);
	});

	it('keeps sidebar draft reads pure until an effect hydrates the workstream', () => {
		const drafts = new AgentDrafts(
			memoryStorage({
				'malini.chat.draft:ws-1': 'Persisted draft',
			}),
		);

		expect(drafts.hasDraft('ws-1')).toBe(false);

		drafts.hydrate('ws-1');

		expect(drafts.hasDraft('ws-1')).toBe(true);
	});

	it('keeps workstreams independent and writes updates through to storage', () => {
		const storage = memoryStorage();
		const drafts = new AgentDrafts(storage);

		drafts.setText('ws-a', 'Draft A');
		drafts.setContextFiles('ws-b', ['README.md']);

		expect(drafts.draftFor('ws-a')).toEqual({
			text: 'Draft A',
			contextFiles: [],
			attachments: [],
			issueReferences: [],
			transcriptReferences: [],
			elementReferences: [],
		});
		expect(drafts.draftFor('ws-b')).toEqual({
			text: '',
			contextFiles: ['README.md'],
			attachments: [],
			issueReferences: [],
			transcriptReferences: [],
			elementReferences: [],
		});
		expect(storage.getItem('malini.chat.draft:ws-a')).toBe('Draft A');
		expect(storage.getItem('malini.chat.draft-context:ws-b')).toBe('["README.md"]');
	});

	it('persists typed issue references and derives their trusted metadata from the url', () => {
		const storage = memoryStorage();
		const drafts = new AgentDrafts(storage);
		drafts.setIssueReferences('ws-issues', [
			issueReference,
			{
				provider: 'github',
				identifier: 'untrusted',
				url: 'https://linear.app/acme/issue/SMK-123',
			},
		]);

		expect(drafts.draftFor('ws-issues').issueReferences).toEqual([issueReference]);
		const restored = new AgentDrafts(storage);
		expect(restored.draftFor('ws-issues').issueReferences).toEqual([issueReference]);
	});

	it('persists unique transcript references as composer context', () => {
		const storage = memoryStorage();
		const drafts = new AgentDrafts(storage);
		drafts.setTranscriptReferences('ws-transcripts', [
			{ sessionId: 'session-1', label: 'Architecture decision' },
			{ sessionId: 'session-1', label: 'Duplicate' },
			{ sessionId: 'session-2', label: 'API constraints' },
		]);

		expect(drafts.draftFor('ws-transcripts').transcriptReferences).toEqual([
			{ sessionId: 'session-1', label: 'Architecture decision' },
			{ sessionId: 'session-2', label: 'API constraints' },
		]);
		const restored = new AgentDrafts(storage);
		expect(restored.draftFor('ws-transcripts').transcriptReferences).toEqual(
			drafts.draftFor('ws-transcripts').transcriptReferences,
		);
	});

	it('round-trips picked element references through storage', () => {
		const storage = memoryStorage();
		const drafts = new AgentDrafts(storage);
		const element = {
			url: 'https://example.com/',
			domPath: 'div[0] > main.hero > span.headline',
			rect: { top: 250, left: 113, width: 1024, height: 87 },
			html: '<span class="headline">Everyone can build now.</span>',
		};
		drafts.setElementReferences('ws-elements', [element, { ...element }]);

		expect(drafts.draftFor('ws-elements').elementReferences).toEqual([element]);
		const restored = new AgentDrafts(storage);
		expect(restored.draftFor('ws-elements').elementReferences).toEqual([element]);
		restored.hydrate('ws-elements');
		expect(restored.hasDraft('ws-elements')).toBe(true);
	});

	it('persists serializable staged attachment descriptors', () => {
		const storage = memoryStorage();
		const drafts = new AgentDrafts(storage);
		drafts.setAttachments('ws-files', [attachment]);

		expect(drafts.draftFor('ws-files').attachments).toEqual([attachment]);
		const restored = new AgentDrafts(storage);
		expect(restored.draftFor('ws-files').attachments).toEqual([attachment]);
	});

	it('clears both persisted parts and removes the sidebar draft signal', () => {
		const storage = memoryStorage();
		const drafts = new AgentDrafts(storage);
		drafts.setText('ws-2', 'Ship it');
		drafts.setContextFiles('ws-2', ['src/app.css']);

		drafts.clear('ws-2');

		expect(drafts.hasDraft('ws-2')).toBe(false);
		expect(storage.getItem('malini.chat.draft:ws-2')).toBeNull();
		expect(storage.getItem('malini.chat.draft-context:ws-2')).toBeNull();
	});

	it('treats a whitespace-only text as no draft, in storage and for the sidebar', () => {
		const storage = memoryStorage();
		const drafts = new AgentDrafts(storage);
		const chat = agentDraftScopeKey('ws-1', 'sess-a');
		drafts.setText(chat, 'Ship it');

		drafts.setText(chat, ' \n ');

		expect(drafts.draftFor(chat).text).toBe('');
		expect(storage.getItem(`malini.chat.draft:${chat}`)).toBeNull();
		expect(drafts.hasDraftForWorkstream('ws-1')).toBe(false);
	});

	it('keys a draft by the chat it was typed in, not the workstream', () => {
		expect(agentDraftScopeKey('ws-1', 'sess-a')).toBe('ws-1|sess-a');
		expect(agentDraftScopeKey('ws-1', null)).toBe('ws-1|new');
	});

	it('never offers one chat draft to another chat of the same workstream', () => {
		const storage = memoryStorage();
		const drafts = new AgentDrafts(storage);
		const firstChat = agentDraftScopeKey('ws-1', 'sess-a');
		const secondChat = agentDraftScopeKey('ws-1', 'sess-b');

		drafts.setText(firstChat, 'typed in chat A');
		drafts.setContextFiles(firstChat, ['src/a.ts']);

		expect(drafts.draftFor(secondChat).text).toBe('');
		expect(drafts.draftFor(secondChat).contextFiles).toEqual([]);

		drafts.setText(secondChat, 'typed in chat B');
		expect(drafts.draftFor(firstChat).text).toBe('typed in chat A');

		const restored = new AgentDrafts(storage);
		expect(restored.draftFor(firstChat).text).toBe('typed in chat A');
		expect(restored.draftFor(secondChat).text).toBe('typed in chat B');
	});

	it('keeps the fresh-chat draft separate from every minted chat', () => {
		const storage = memoryStorage();
		const drafts = new AgentDrafts(storage);

		drafts.setText(agentDraftScopeKey('ws-1', null), 'not sent yet');

		expect(drafts.draftFor(agentDraftScopeKey('ws-1', 'sess-a')).text).toBe('');
		expect(drafts.draftFor(agentDraftScopeKey('ws-1', null)).text).toBe('not sent yet');
	});

	it('indexes which chats hold a draft for the sidebar without hydrating them', () => {
		const storage = memoryStorage();
		const drafts = new AgentDrafts(storage);
		const chatA = agentDraftScopeKey('ws-1', 'sess-a');
		const chatB = agentDraftScopeKey('ws-1', 'sess-b');

		expect(drafts.hasDraftForWorkstream('ws-1')).toBe(false);

		drafts.setText(chatA, 'pending');
		expect(drafts.hasDraftForWorkstream('ws-1')).toBe(true);

		drafts.setText(chatB, 'also pending');
		drafts.clear(chatA);
		expect(drafts.hasDraftForWorkstream('ws-1')).toBe(true);

		drafts.clear(chatB);
		expect(drafts.hasDraftForWorkstream('ws-1')).toBe(false);

		drafts.setText(chatB, 'survives restart');
		const restored = new AgentDrafts(storage);
		restored.hydrateWorkstream('ws-1');
		expect(restored.hasDraftForWorkstream('ws-1')).toBe(true);
		expect(restored.draftFor(chatB).text).toBe('survives restart');
	});
});
