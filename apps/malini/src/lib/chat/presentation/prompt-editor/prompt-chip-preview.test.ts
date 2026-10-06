import { describe, expect, it } from 'vitest';
import type { StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
import type { AgentElementReference } from '$lib/chat/domain/element-reference';
import type { AgentIssueReference } from '$lib/chat/domain/issue-reference';
import { elementChipId } from '$lib/chat/domain/prompt-chip';
import type { AgentTranscriptReference } from '$lib/chat/domain/transcript-reference';
import { imagePreviewQuery } from '$lib/chat/application/queries/image-preview.query.svelte';
import {
	formatBytes,
	promptChipPreview,
	type PromptChipPreviewSources,
} from './prompt-chip-preview';

const IMAGE: StagedAgentAttachment = {
	id: 'att-0123456789abcdef0123456789abcdef',
	displayName: 'image.png',
	relativePath: '.malini/agent-attachments/att-0123456789abcdef0123456789abcdef/image.png',
	mediaType: 'image/png',
	size: 204_800,
	sha256: 'a'.repeat(64),
};

const DOCUMENT: StagedAgentAttachment = {
	id: 'att-fedcba9876543210fedcba9876543210',
	displayName: 'notes.txt',
	relativePath: '.malini/agent-attachments/att-fedcba9876543210fedcba9876543210/notes.txt',
	mediaType: 'text/plain',
	size: 512,
	sha256: 'b'.repeat(64),
};

const ISSUE: AgentIssueReference = {
	provider: 'github',
	identifier: 'bestboyhq/malini#412',
	url: 'https://github.com/bestboyhq/malini/issues/412',
};

const TRANSCRIPT: AgentTranscriptReference = {
	sessionId: 'session-9f2c',
	label: 'Composer chips',
};

const ELEMENT: AgentElementReference = {
	url: 'https://itscore.app/pricing',
	domPath: 'main > section.plans > button.cta',
	rect: { top: 128.4, left: 64, width: 220.6, height: 40 },
	html: '<button class="cta">Start free</button>',
};

function sources(overrides: Partial<PromptChipPreviewSources> = {}): PromptChipPreviewSources {
	return {
		attachments: [IMAGE, DOCUMENT],
		contextFiles: ['src/routes/+page.svelte', 'README.md'],
		issueReferences: [ISSUE],
		transcriptReferences: [TRANSCRIPT],
		elementReferences: [ELEMENT],
		...overrides,
	};
}

describe('promptChipPreview', () => {
	it('previews an image attachment with the resolved asset url', () => {
		const preview = promptChipPreview(
			{ kind: 'attachment', id: IMAGE.id },
			sources({ assetUrl: (path) => `asset://localhost/${path}` }),
		);

		expect(preview).toEqual({
			kind: 'image',
			title: 'image.png',
			src: `asset://localhost/${IMAGE.relativePath}`,
			meta: '200 KB',
		});
	});

	it('falls back to the file card when the asset url is unreachable', () => {
		const preview = promptChipPreview(
			{ kind: 'attachment', id: IMAGE.id },
			sources({ assetUrl: () => null }),
		);

		expect(preview).toEqual({ kind: 'file', title: 'image.png', meta: '200 KB' });
	});

	it('falls back to the file card when no asset resolver is injected at all', () => {
		const preview = promptChipPreview({ kind: 'attachment', id: IMAGE.id }, sources());

		expect(preview).toEqual({ kind: 'file', title: 'image.png', meta: '200 KB' });
	});

	it('draws the file card until the image preview has actually been read', () => {
		const preview = promptChipPreview(
			{ kind: 'attachment', id: IMAGE.id },
			sources({
				assetUrl: () => {
					const image = imagePreviewQuery.data('composer-unprimed', IMAGE.id);
					return image?.status === 'ready' ? image.src : null;
				},
			}),
		);

		expect(preview).toEqual({ kind: 'file', title: 'image.png', meta: '200 KB' });
	});

	it('previews a non-image attachment as a file', () => {
		const preview = promptChipPreview(
			{ kind: 'attachment', id: DOCUMENT.id },
			sources({ assetUrl: (path) => `asset://localhost/${path}` }),
		);

		expect(preview).toEqual({ kind: 'file', title: 'notes.txt', meta: '512 B' });
	});

	it.each([
		['Transcript of Composer chips.md', 'text/plain', '16.7 KB · Markdown'],
		['package.json', 'application/json', '16.7 KB · JSON'],
		['schema.ts', 'application/octet-stream', '16.7 KB · TypeScript'],
		['server.js', 'application/octet-stream', '16.7 KB · JavaScript'],
		['App.svelte', 'application/octet-stream', '16.7 KB · Svelte'],
		['report.pdf', 'application/pdf', '16.7 KB'],
		['Makefile', 'application/octet-stream', '16.7 KB'],
	])('describes %s by its size and file kind, never its %s transport type', (name, type, meta) => {
		const file: StagedAgentAttachment = {
			...DOCUMENT,
			displayName: name,
			mediaType: type,
			size: 17_100,
		};

		expect(
			promptChipPreview({ kind: 'attachment', id: file.id }, sources({ attachments: [file] })),
		).toEqual({ kind: 'file', title: name, meta });
	});

	it('previews a context file as its basename over its full path', () => {
		const preview = promptChipPreview(
			{ kind: 'context', id: 'src/routes/+page.svelte' },
			sources(),
		);

		expect(preview).toEqual({
			kind: 'file',
			title: '+page.svelte',
			meta: 'src/routes/+page.svelte',
		});
	});

	it('previews an issue as its provider, identifier and url', () => {
		const preview = promptChipPreview({ kind: 'issue', id: ISSUE.url }, sources());

		expect(preview).toEqual({
			kind: 'lines',
			title: 'GitHub issue',
			lines: ['bestboyhq/malini#412', ISSUE.url],
		});
	});

	it('names the provider a linear issue came from', () => {
		const linear: AgentIssueReference = {
			provider: 'linear',
			identifier: 'SMK-88',
			url: 'https://linear.app/bestboyhq/issue/SMK-88',
		};
		const preview = promptChipPreview(
			{ kind: 'issue', id: linear.url },
			sources({ issueReferences: [linear] }),
		);

		expect(preview).toEqual({
			kind: 'lines',
			title: 'Linear issue',
			lines: ['SMK-88', linear.url],
		});
	});

	it('previews a transcript as its label and session id', () => {
		const preview = promptChipPreview({ kind: 'transcript', id: TRANSCRIPT.sessionId }, sources());

		expect(preview).toEqual({
			kind: 'lines',
			title: 'Transcript',
			lines: ['Composer chips', 'session-9f2c'],
		});
	});

	it('previews a picked element as its markup over its path and position', () => {
		const preview = promptChipPreview(
			{ kind: 'element', id: elementChipId(ELEMENT.url, ELEMENT.domPath) },
			sources(),
		);

		expect(preview).toEqual({
			kind: 'code',
			title: 'button.cta',
			code: 'HTML Element: <button class="cta">Start free</button>',
			meta: 'DOM Path: main > section.plans > button.cta · Position: top=128px, left=64px, width=221px, height=40px',
		});
	});

	it('reads an element chip id as url plus dom path, not either alone', () => {
		const sameSelectorElsewhere = promptChipPreview(
			{ kind: 'element', id: elementChipId('https://itscore.app/other', ELEMENT.domPath) },
			sources(),
		);
		const unparseable = promptChipPreview({ kind: 'element', id: ELEMENT.domPath }, sources());

		expect(sameSelectorElsewhere).toBeNull();
		expect(unparseable).toBeNull();
	});

	it('returns null for every kind of stale reference', () => {
		const empty = sources({
			attachments: [],
			contextFiles: [],
			issueReferences: [],
			transcriptReferences: [],
			elementReferences: [],
		});

		expect(promptChipPreview({ kind: 'attachment', id: IMAGE.id }, empty)).toBeNull();
		expect(promptChipPreview({ kind: 'context', id: 'README.md' }, empty)).toBeNull();
		expect(promptChipPreview({ kind: 'issue', id: ISSUE.url }, empty)).toBeNull();
		expect(promptChipPreview({ kind: 'transcript', id: TRANSCRIPT.sessionId }, empty)).toBeNull();
		expect(
			promptChipPreview(
				{ kind: 'element', id: elementChipId(ELEMENT.url, ELEMENT.domPath) },
				empty,
			),
		).toBeNull();
	});

	it('does not preview a path the composer never staged', () => {
		expect(
			promptChipPreview({ kind: 'context', id: 'src/routes/+layout.svelte' }, sources()),
		).toBeNull();
	});
});

describe('formatBytes', () => {
	it('keeps byte counts whole', () => {
		expect(formatBytes(0)).toBe('0 B');
		expect(formatBytes(1)).toBe('1 B');
		expect(formatBytes(1023)).toBe('1023 B');
	});

	it('drops a trailing zero decimal rather than claiming precision', () => {
		expect(formatBytes(1024)).toBe('1 KB');
		expect(formatBytes(1024 * 1024)).toBe('1 MB');
		expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
	});

	it('keeps one decimal where it carries information', () => {
		expect(formatBytes(1536)).toBe('1.5 KB');
		expect(formatBytes(10 * 1024 * 1024 + 512 * 1024)).toBe('10.5 MB');
	});

	it('treats a missing or nonsensical size as zero', () => {
		expect(formatBytes(-1)).toBe('0 B');
		expect(formatBytes(Number.NaN)).toBe('0 B');
		expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 B');
	});
});
