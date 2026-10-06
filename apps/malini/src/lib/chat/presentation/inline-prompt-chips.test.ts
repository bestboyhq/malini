import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/public', () => ({ env: {} }));

import type { StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
import type { AgentElementReference } from '$lib/chat/domain/element-reference';
import type { AgentIssueReference } from '$lib/chat/domain/issue-reference';
import type { AgentTranscriptReference } from '$lib/chat/domain/transcript-reference';
import { elementChipId } from '$lib/chat/domain/prompt-chip';
import {
	describeInlinePromptChip,
	inlinePromptChipKeys,
	referencesOutsidePrompt,
} from './inline-prompt-chips';

const attachment: StagedAgentAttachment = {
	id: 'att-1',
	displayName: 'flaky-build.log',
	relativePath: '.malini/agent-attachments/att-1/flaky-build.log',
	mediaType: 'text/plain',
	size: 128,
	sha256: 'c'.repeat(64),
};

const issue: AgentIssueReference = {
	provider: 'github',
	identifier: 'openai/codex#42',
	url: 'https://github.com/openai/codex/issues/42',
};

const transcript: AgentTranscriptReference = {
	sessionId: 'session-7',
	label: 'Earlier debugging run',
};

const element: AgentElementReference = {
	url: 'https://example.com/pricing',
	domPath: 'body > main > h1.hero',
	rect: { top: 10, left: 20, width: 300, height: 40 },
	html: '<h1 class="hero">Pricing</h1>',
};

const references = {
	attachments: [attachment],
	issueReferences: [issue],
	transcriptReferences: [transcript],
	elementReferences: [element],
};

describe('describeInlinePromptChip', () => {
	it('gives every kind its glyph, testid, noun and resolved label', () => {
		expect(describeInlinePromptChip({ kind: 'attachment', id: 'att-1' }, references)).toEqual({
			kind: 'attachment',
			glyph: '▣',
			label: 'flaky-build.log',
			ariaLabel: 'Attached file: flaky-build.log',
			testId: 'chat-message-attachment-chip',
			attributes: { 'data-attachment-id': 'att-1' },
		});

		expect(describeInlinePromptChip({ kind: 'context', id: 'src/lib/a.ts' }, references)).toEqual({
			kind: 'context',
			glyph: '◧',
			label: 'a.ts',
			ariaLabel: 'Workstream file: a.ts',
			testId: 'chat-message-context-file-chip',
			attributes: { 'data-context-path': 'src/lib/a.ts' },
		});

		expect(describeInlinePromptChip({ kind: 'issue', id: issue.url }, references)).toEqual({
			kind: 'issue',
			glyph: '◆',
			label: issue.identifier,
			ariaLabel: `Issue: ${issue.identifier}`,
			testId: 'chat-message-issue-reference-chip',
			attributes: { 'data-issue-url': issue.url, 'data-issue-provider': 'github' },
		});

		expect(describeInlinePromptChip({ kind: 'transcript', id: 'session-7' }, references)).toEqual({
			kind: 'transcript',
			glyph: '◍',
			label: transcript.label,
			ariaLabel: `Transcript: ${transcript.label}`,
			testId: 'chat-message-transcript-reference-chip',
			attributes: { 'data-transcript-session-id': 'session-7' },
		});

		const elementChip = describeInlinePromptChip(
			{ kind: 'element', id: elementChipId(element.url, element.domPath) },
			references,
		);
		expect(elementChip.glyph).toBe('⌗');
		expect(elementChip.testId).toBe('chat-message-element-reference-chip');
		expect(elementChip.label).toContain('h1.hero');
		expect(elementChip.attributes).toEqual({
			'data-element-url': element.url,
			'data-element-dom-path': element.domPath,
		});
	});

	it('names a reference whose sibling array never arrived', () => {
		expect(describeInlinePromptChip({ kind: 'context', id: 'deep/nested/config.json' }).label).toBe(
			'config.json',
		);
		expect(describeInlinePromptChip({ kind: 'attachment', id: 'att-9' }).label).toBe('Attachment');
	});

	it('flattens a newline out of a label so the chip stays one line high', () => {
		const chip = describeInlinePromptChip(
			{ kind: 'transcript', id: 'session-7' },
			{
				transcriptReferences: [{ sessionId: 'session-7', label: 'first\nsecond' }],
			},
		);
		expect(chip.label).toBe('first second');
		expect(chip.ariaLabel).toBe('Transcript: first second');
	});
});

describe('inlinePromptChipKeys', () => {
	it('reports each distinct reference once, keyed by kind and id', () => {
		const keys = inlinePromptChipKeys('[[attachment:att-1]] [[attachment:att-1]] [[context:a.ts]]');
		expect([...keys]).toEqual(['attachment att-1', 'context a.ts']);
	});
});

describe('referencesOutsidePrompt', () => {
	it('drops the references the prompt already shows inline', () => {
		const kept = referencesOutsidePrompt(
			'look at [[attachment:att-1]]',
			'attachment',
			[attachment, { ...attachment, id: 'att-2', displayName: 'other.log' }],
			(item) => item.id,
		);
		expect(kept.map((item) => item.id)).toEqual(['att-2']);
	});

	it('keeps every kind of reference the prompt never mentions', () => {
		const prompt = 'plain prompt with no markers';
		expect(referencesOutsidePrompt(prompt, 'issue', [issue], (item) => item.url)).toEqual([issue]);
		expect(referencesOutsidePrompt(prompt, 'context', ['src/a.ts'], (path) => path)).toEqual([
			'src/a.ts',
		]);
	});

	it('matches an element by the same key its chip id is built from', () => {
		const marker = `[[element:${elementChipId(element.url, element.domPath).replaceAll('\n', '%0A')}]]`;
		expect(
			referencesOutsidePrompt(`fix ${marker}`, 'element', [element], (item) =>
				elementChipId(item.url, item.domPath),
			),
		).toEqual([]);
	});
});
