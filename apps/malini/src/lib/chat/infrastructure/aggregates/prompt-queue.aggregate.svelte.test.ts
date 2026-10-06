import { describe, expect, it } from 'vitest';
import {
	AgentPromptQueue,
	promptQueuePausedStorageKey,
	promptQueueStorageKey,
} from './prompt-queue.aggregate.svelte';

function memoryStorage(seed: Record<string, string> = {}): Pick<
	Storage,
	'getItem' | 'setItem' | 'removeItem'
> & {
	values: Map<string, string>;
} {
	const values = new Map(Object.entries(seed));
	return {
		values,
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => values.set(key, value),
		removeItem: (key) => values.delete(key),
	};
}

describe('AgentPromptQueue', () => {
	const attachment = {
		id: 'att-00000000000000000000000000000001',
		displayName: 'brief.pdf',
		relativePath: '.malini/agent-attachments/att-00000000000000000000000000000001/brief.pdf',
		mediaType: 'application/pdf',
		size: 42,
		sha256: 'a'.repeat(64),
	};
	const issueReference = {
		provider: 'github' as const,
		identifier: 'openai/codex#42',
		url: 'https://github.com/openai/codex/issues/42',
	};

	it('persists queues independently per workstream and restores them after restart', () => {
		const storage = memoryStorage();
		let nextId = 0;
		const first = new AgentPromptQueue({
			storage,
			createId: () => `q-${++nextId}`,
			now: () => 123,
		});

		first.enqueue({
			workstreamId: 'blog-a',
			prompt: '  polish the hero  ',
			model: 'sonnet',
			contextFiles: ['src/routes/+page.svelte', 'src/lib/hero.ts'],
			attachments: [attachment],
			issueReferences: [issueReference],
		});
		first.enqueue({
			workstreamId: 'blog-b',
			prompt: 'rewrite the proof',
			model: 'haiku',
		});

		expect(first.entriesFor('blog-a')).toEqual([
			{
				id: 'q-1',
				targetSessionId: null,
				forceFreshSession: false,
				prompt: 'polish the hero',
				role: 'implementation',
				model: 'sonnet',
				contextFiles: ['src/routes/+page.svelte', 'src/lib/hero.ts'],
				attachments: [attachment],
				issueReferences: [issueReference],
				transcriptReferences: [],
				elementReferences: [],
				profile: { effort: 'medium', mode: 'agent', access: 'sandboxed' },
				automated: false,
				createdAt: 123,
			},
		]);
		expect(first.entriesFor('blog-b')).toEqual([
			{
				id: 'q-2',
				targetSessionId: null,
				forceFreshSession: false,
				prompt: 'rewrite the proof',
				role: 'implementation',
				model: 'haiku',
				contextFiles: [],
				attachments: [],
				issueReferences: [],
				transcriptReferences: [],
				elementReferences: [],
				profile: { effort: 'medium', mode: 'agent', access: 'sandboxed' },
				automated: false,
				createdAt: 123,
			},
		]);

		const restored = new AgentPromptQueue({ storage });
		restored.hydrate('blog-a');
		restored.hydrate('blog-b');
		expect(restored.entriesFor('blog-a')).toEqual(first.entriesFor('blog-a'));
		expect(restored.entriesFor('blog-b')).toEqual(first.entriesFor('blog-b'));
	});

	it('edits, promotes, deletes, and pauses without disturbing another workstream', () => {
		const storage = memoryStorage();
		let nextId = 0;
		const queue = new AgentPromptQueue({ storage, createId: () => `q-${++nextId}` });
		const first = queue.enqueue({
			workstreamId: 'blog-a',
			prompt: 'first',
			model: 'haiku',
		});
		const second = queue.enqueue({
			workstreamId: 'blog-a',
			prompt: 'second',
			model: 'haiku',
		});
		queue.enqueue({
			workstreamId: 'blog-b',
			prompt: 'other',
			model: 'opus',
		});

		expect(queue.update('blog-a', second.id, { prompt: ' second, edited ' })).toBe(true);
		expect(queue.promote('blog-a', second.id)).toBe(true);
		expect(queue.entriesFor('blog-a').map((entry) => entry.prompt)).toEqual([
			'second, edited',
			'first',
		]);
		expect(queue.remove('blog-a', first.id)).toBe(true);
		queue.setPaused('blog-a', true);
		expect(queue.isPaused('blog-a')).toBe(true);
		expect(queue.isPaused('blog-b')).toBe(false);
		expect(queue.entriesFor('blog-b').map((entry) => entry.prompt)).toEqual(['other']);
	});

	it('restores a paused queue after app restart so queued work never auto-runs unexpectedly', () => {
		const storage = memoryStorage();
		const first = new AgentPromptQueue({ storage });
		first.enqueue({
			workstreamId: 'blog-paused',
			prompt: 'wait for explicit approval',
			model: 'sonnet',
		});
		first.setPaused('blog-paused', true);

		expect(storage.getItem(promptQueuePausedStorageKey('blog-paused'))).toBe('true');

		const restored = new AgentPromptQueue({ storage });
		restored.hydrate('blog-paused');
		expect(restored.isPaused('blog-paused')).toBe(true);
		expect(restored.entriesFor('blog-paused')).toHaveLength(1);

		restored.setPaused('blog-paused', false);
		expect(storage.getItem(promptQueuePausedStorageKey('blog-paused'))).toBeNull();
	});

	it('sanitizes corrupt persisted entries and enforces the configured bound', () => {
		const workstreamId = 'blog-corrupt';
		const storage = memoryStorage({
			[promptQueueStorageKey(workstreamId)]: JSON.stringify([
				{
					id: 'valid',
					prompt: 'keep me',
					model: 'haiku',
					createdAt: 1,
					contextFiles: ['src/app.ts', 'src/app.ts', 'bad\npath', 42],
				},
				{
					id: 'valid',
					prompt: 'duplicate',
					model: 'haiku',
					createdAt: 2,
				},
				{ id: 'bad-model', prompt: 'drop me', model: 'openai/gpt-5.5', createdAt: 3 },
				null,
			]),
		});
		let nextId = 0;
		const queue = new AgentPromptQueue({
			storage,
			createId: () => `new-${++nextId}`,
			maxEntries: 2,
		});
		queue.hydrate(workstreamId);
		expect(queue.entriesFor(workstreamId).map((entry) => entry.id)).toEqual(['valid']);
		expect(queue.entriesFor(workstreamId)[0]?.contextFiles).toEqual(['src/app.ts']);

		queue.enqueue({ workstreamId, prompt: 'two', model: 'haiku' });
		queue.enqueue({ workstreamId, prompt: 'three', model: 'haiku' });
		expect(queue.entriesFor(workstreamId).map((entry) => entry.prompt)).toEqual(['two', 'three']);
	});

	it('snapshots roles and drops persisted unknown-model entries', () => {
		const workstreamId = 'blog-roles';
		const storage = memoryStorage({
			[promptQueueStorageKey(workstreamId)]: JSON.stringify([
				{
					id: 'malini-plan',
					prompt: 'prepare a plan',
					model: 'opus',
					profile: { effort: 'high', mode: 'plan', access: 'sandboxed' },
					createdAt: 1,
				},
				{
					id: 'legacy-plan',
					prompt: 'drop the unknown model route',
					model: 'openai/gpt-5.5',
					profile: { effort: 'high', mode: 'plan', access: 'sandboxed' },
					createdAt: 2,
				},
			]),
		});
		const queue = new AgentPromptQueue({ storage, createId: () => 'implementation' });
		queue.hydrate(workstreamId);
		expect(queue.entriesFor(workstreamId)[0]?.role).toBe('planning');

		queue.enqueue({
			workstreamId,
			prompt: 'implement the plan',
			role: 'implementation',
			model: 'sonnet[1m]',
			profile: { effort: 'xhigh', mode: 'agent', access: 'sandboxed' },
		});
		expect(queue.entriesFor(workstreamId).map((entry) => entry.role)).toEqual([
			'planning',
			'implementation',
		]);
		expect(queue.entriesFor(workstreamId)[0]).toMatchObject({
			targetSessionId: null,
			forceFreshSession: false,
		});
	});

	it('persists exact chat affinity and explicit fresh intent', () => {
		const storage = memoryStorage();
		const first = new AgentPromptQueue({ storage, createId: () => 'targeted' });
		first.enqueue({
			workstreamId: 'blog-a',
			targetSessionId: 'session-older-selected',
			forceFreshSession: true,
			prompt: 'keep this turn on its captured chat boundary',
			model: 'sonnet',
		});

		const restored = new AgentPromptQueue({ storage });
		restored.hydrate('blog-a');
		expect(restored.entriesFor('blog-a')[0]).toMatchObject({
			targetSessionId: 'session-older-selected',
			forceFreshSession: true,
		});
	});

	it('keeps a prompt malini wrote marked as automated until the user rewrites it', () => {
		const storage = memoryStorage();
		const first = new AgentPromptQueue({ storage, createId: () => 'automated' });
		first.enqueue({
			workstreamId: 'blog-a',
			prompt: 'Resolve the merge conflicts in this workstream.',
			model: 'sonnet',
			automated: true,
		});

		const restored = new AgentPromptQueue({ storage });
		restored.hydrate('blog-a');
		expect(restored.entriesFor('blog-a')[0]?.automated).toBe(true);
		restored.update('blog-a', 'automated', {
			prompt: 'Resolve the merge conflicts in this workstream.',
		});
		expect(restored.entriesFor('blog-a')[0]?.automated).toBe(true);
		restored.update('blog-a', 'automated', { prompt: 'Keep both sides of the sidebar change' });
		expect(restored.entriesFor('blog-a')[0]?.automated).toBe(false);
	});

	it('selects queued turns by chat, keeping a sibling backlog out of this composer', () => {
		const storage = memoryStorage();
		let nextId = 0;
		const queue = new AgentPromptQueue({ storage, createId: () => `q-${++nextId}` });
		queue.enqueue({
			workstreamId: 'blog-a',
			targetSessionId: 'sess-a',
			prompt: 'for chat A',
			model: 'sonnet',
		});
		queue.enqueue({
			workstreamId: 'blog-a',
			targetSessionId: 'sess-b',
			prompt: 'for chat B',
			model: 'sonnet',
		});
		queue.enqueue({
			workstreamId: 'blog-a',
			targetSessionId: null,
			prompt: 'for the next fresh chat',
			model: 'sonnet',
		});

		expect(queue.entriesForSession('blog-a', 'sess-a').map((entry) => entry.prompt)).toEqual([
			'for chat A',
		]);
		expect(queue.entriesForSession('blog-a', 'sess-b').map((entry) => entry.prompt)).toEqual([
			'for chat B',
		]);
		expect(queue.entriesForSession('blog-a', null).map((entry) => entry.prompt)).toEqual([
			'for the next fresh chat',
		]);
		expect(queue.entriesFor('blog-a')).toHaveLength(3);
	});

	it('drops only a closed chat queued turns and survives a restart', () => {
		const storage = memoryStorage();
		let nextId = 0;
		const queue = new AgentPromptQueue({ storage, createId: () => `q-${++nextId}` });
		queue.enqueue({
			workstreamId: 'blog-a',
			targetSessionId: 'sess-a',
			prompt: 'doomed with chat A',
			model: 'sonnet',
		});
		queue.enqueue({
			workstreamId: 'blog-a',
			targetSessionId: 'sess-b',
			prompt: 'kept with chat B',
			model: 'sonnet',
		});

		expect(queue.removeForSession('blog-a', 'sess-a')).toBe(1);
		expect(queue.removeForSession('blog-a', 'sess-a')).toBe(0);
		expect(queue.entriesFor('blog-a').map((entry) => entry.prompt)).toEqual(['kept with chat B']);

		const restored = new AgentPromptQueue({ storage });
		restored.hydrate('blog-a');
		expect(restored.entriesFor('blog-a').map((entry) => entry.prompt)).toEqual([
			'kept with chat B',
		]);
	});
});
