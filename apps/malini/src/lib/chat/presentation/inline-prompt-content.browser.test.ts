import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';

import type { StagedAgentAttachment } from '$lib/chat/domain/composer-actions';
import type { AgentElementReference } from '$lib/chat/domain/element-reference';
import type { AgentIssueReference } from '$lib/chat/domain/issue-reference';
import type { AgentTranscriptReference } from '$lib/chat/domain/transcript-reference';
import { elementChipId } from '$lib/chat/domain/prompt-chip';
import InlinePromptContent from './InlinePromptContent.svelte';

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

type Mounted = Readonly<{ host: HTMLElement; stop: () => void }>;

function render(text: string, props: Record<string, unknown> = {}): Mounted {
	const host = document.createElement('div');
	document.body.append(host);
	const app = mount(InlinePromptContent, {
		target: host,
		props: {
			text,
			attachments: [attachment],
			issueReferences: [issue],
			transcriptReferences: [transcript],
			elementReferences: [element],
			...props,
		},
	});
	flushSync();
	return {
		host,
		stop: () => {
			void unmount(app);
			host.remove();
		},
	};
}

function shownText(text: string): string {
	const { host, stop } = render(text);
	const shown = host.textContent ?? '';
	stop();
	return shown;
}

function commentText(host: HTMLElement): string[] {
	const walker = document.createTreeWalker(host, NodeFilter.SHOW_COMMENT);
	const said: string[] = [];
	while (walker.nextNode()) {
		const data = walker.currentNode.nodeValue ?? '';
		if (data !== '') said.push(data);
	}
	return said;
}

describe('the prompt bubble body', () => {
	it('shows the whole message back when the writer wrote markup in it', () => {
		const reported =
			'Create a new file PARITY-CHECK.md at the repository root containing exactly one line: parity e2e run. Then append a new last line to README.md containing exactly: <!-- parity e2e -->. Do not run any tests, builds or git commands.';
		expect(shownText(reported)).toBe(reported);

		expect(shownText('<!-- parity e2e -->')).toBe('<!-- parity e2e -->');
		expect(shownText('plain <b>bold</b> end')).toBe('plain <b>bold</b> end');
		expect(shownText('render <Foo /> here')).toBe('render <Foo /> here');
		expect(shownText('a < b && c > d')).toBe('a < b && c > d');
	});

	it('renders that markup as text and never as markup', () => {
		const { host, stop } = render('plain <b>bold</b> and <!-- comment --> and <Foo /> end');

		expect(host.querySelector('b')).toBeNull();
		expect(host.querySelector('foo')).toBeNull();
		expect(commentText(host)).toEqual([]);
		expect(host.innerHTML).toContain('&lt;b&gt;bold&lt;/b&gt;');
		expect(host.innerHTML).toContain('&lt;!-- comment --&gt;');
		expect(host.innerHTML).toContain('&lt;Foo /&gt;');

		stop();
	});

	it('cannot be talked into executing what the writer typed', () => {
		const hostile = '<img src=x onerror=alert(1)> <script>alert(2)</script> done';
		const { host, stop } = render(hostile);

		expect(host.textContent).toBe(hostile);
		expect(host.querySelectorAll('img')).toHaveLength(0);
		expect(host.querySelectorAll('script')).toHaveLength(0);
		expect(host.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;');

		stop();
	});

	it('leaves markdown syntax as the characters that were typed', () => {
		expect(shownText('**tighten this** and `code` and - a list')).toBe(
			'**tighten this** and `code` and - a list',
		);

		const { host, stop } = render('**tighten this**');
		expect(host.querySelector('strong')).toBeNull();
		stop();
	});

	it('keeps the writer’s own line breaks and spacing', () => {
		const written = 'first line\n\nthird line\n    indented';
		const { host, stop } = render(written);

		expect(host.textContent).toBe(written);
		const run = host.querySelector('span');
		expect(run?.className).toContain('whitespace-pre-wrap');

		stop();
	});
});

describe('the references written into a prompt', () => {
	it('draws each kind as a chip standing where the writer put it', () => {
		const marker = `[[element:${elementChipId(element.url, element.domPath).replaceAll('\n', '%0A')}]]`;
		const { host, stop } = render(
			`fix [[attachment:att-1]] and [[context:src/lib/a.ts]] and [[issue:${issue.url}]] and [[transcript:session-7]] and ${marker} now`,
		);

		const attachmentChip = host.querySelector('[data-testid="chat-message-attachment-chip"]');
		expect(attachmentChip?.getAttribute('data-attachment-id')).toBe('att-1');
		expect(attachmentChip?.getAttribute('aria-label')).toBe('Attached file: flaky-build.log');
		expect(attachmentChip?.textContent).toContain('flaky-build.log');

		expect(
			host
				.querySelector('[data-testid="chat-message-context-file-chip"]')
				?.getAttribute('data-context-path'),
		).toBe('src/lib/a.ts');
		expect(
			host
				.querySelector('[data-testid="chat-message-issue-reference-chip"]')
				?.getAttribute('data-issue-url'),
		).toBe(issue.url);
		expect(
			host
				.querySelector('[data-testid="chat-message-transcript-reference-chip"]')
				?.getAttribute('data-transcript-session-id'),
		).toBe('session-7');
		expect(
			host
				.querySelector('[data-testid="chat-message-element-reference-chip"]')
				?.getAttribute('data-element-dom-path'),
		).toBe(element.domPath);

		expect(host.textContent).toContain('fix ');
		expect(host.textContent).toContain(' now');
		expect(host.textContent).not.toContain('[[');

		stop();
	});

	it('carries a read-only chip: nothing to click, nothing to remove', () => {
		const { host, stop } = render('look at [[attachment:att-1]]');
		expect(host.querySelectorAll('button')).toHaveLength(0);
		stop();
	});

	it('dims the chip while the prompt is still being sent', () => {
		const inFlight = render('look at [[attachment:att-1]]', { pending: true });
		expect(
			inFlight.host.querySelector('[data-testid="chat-message-attachment-chip"]')?.className,
		).toContain('opacity-70');
		inFlight.stop();

		const sent = render('look at [[attachment:att-1]]');
		expect(
			sent.host.querySelector('[data-testid="chat-message-attachment-chip"]')?.className,
		).not.toContain('opacity-70');
		sent.stop();
	});

	it('cannot be escaped by a display name that contains markup', () => {
		const displayName = '"><img src=x onerror=alert(1)>';
		const { host, stop } = render('see [[attachment:att-x]]', {
			attachments: [{ ...attachment, id: 'att-x', displayName }],
		});

		expect(host.querySelector('img[onerror]')).toBeNull();
		expect(host.querySelector('img[src="x"]')).toBeNull();
		const chip = host.querySelector('[data-testid="chat-message-attachment-chip"]');
		expect(chip?.textContent?.replace('▣', '').trim()).toBe(displayName);

		stop();
	});
});
