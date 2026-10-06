import { describe, expect, it } from 'vitest';
import {
	parseAgentIssueReferenceUrl,
	parseAgentPrompt,
	sanitizeAgentIssueReferences,
	serializeAgentPromptWithIssueReferences,
} from './issue-reference';

describe('agent issue references', () => {
	it('parses and canonicalizes GitHub and Linear issue urls', () => {
		expect(
			parseAgentIssueReferenceUrl('https://github.com/openai/codex/issues/42?tab=readme'),
		).toEqual({
			provider: 'github',
			identifier: 'openai/codex#42',
			url: 'https://github.com/openai/codex/issues/42',
		});
		expect(parseAgentIssueReferenceUrl('https://linear.app/acme/issue/smk-123/a-title')).toEqual({
			provider: 'linear',
			identifier: 'SMK-123',
			url: 'https://linear.app/acme/issue/SMK-123',
		});
	});

	it('rejects unsupported, malformed, and credential-bearing urls', () => {
		expect(parseAgentIssueReferenceUrl('https://example.com/acme/issues/1')).toBeNull();
		expect(
			parseAgentIssueReferenceUrl('https://user:secret@github.com/openai/codex/issues/1'),
		).toBeNull();
		expect(parseAgentIssueReferenceUrl('https://github.com/openai/codex/pull/1')).toBeNull();
		expect(parseAgentIssueReferenceUrl('javascript:alert(1)')).toBeNull();
	});

	it('sanitizes, deduplicates, and derives trusted descriptors from urls', () => {
		expect(
			sanitizeAgentIssueReferences([
				{
					provider: 'linear',
					identifier: 'FAKE-1',
					url: 'https://github.com/openai/codex/issues/42',
				},
				{ url: 'https://github.com/openai/codex/issues/42' },
				{ url: 'https://example.com/nope' },
			]),
		).toEqual([
			{
				provider: 'github',
				identifier: 'openai/codex#42',
				url: 'https://github.com/openai/codex/issues/42',
			},
		]);
	});

	it('round-trips an agent transport block without changing visible prompt text', () => {
		const reference = parseAgentIssueReferenceUrl('https://linear.app/acme/issue/SMK-123')!;
		const serialized = serializeAgentPromptWithIssueReferences('Fix the regression', [reference]);
		expect(serialized).toContain('<malini_issue_references version="1">');
		expect(serialized).toContain('authenticated GitHub or Linear tools');
		expect(parseAgentPrompt(serialized)).toEqual({
			prompt: 'Fix the regression',
			issueReferences: [reference],
		});
	});

	it('still reads the references out of a message stored before the rename', () => {
		const reference = parseAgentIssueReferenceUrl('https://linear.app/acme/issue/SMK-123')!;
		const payload = JSON.stringify({ references: [reference], instruction: 'resolve' });
		const stored = `Fix the regression\n\n<core_issue_references version="1">\n${payload}\n</core_issue_references>`;
		expect(parseAgentPrompt(stored)).toEqual({
			prompt: 'Fix the regression',
			issueReferences: [reference],
		});
		expect(serializeAgentPromptWithIssueReferences(stored, [reference])).not.toContain(
			'core_issue_references',
		);
	});

	it('leaves malformed or non-terminal blocks visible instead of swallowing user text', () => {
		for (const tag of ['malini_issue_references', 'core_issue_references']) {
			const value = `Keep this <${tag} version="1">not-json</${tag}>`;
			expect(parseAgentPrompt(value)).toEqual({ prompt: value, issueReferences: [] });
		}
	});
});
