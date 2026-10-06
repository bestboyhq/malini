import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readChatMessageListSource } from './chat-message-list-source.testkit';

const transcript = readChatMessageListSource(new URL('./', import.meta.url));
const markdownText = readFileSync(new URL('./MarkdownText.svelte', import.meta.url), 'utf8');
const bufferedMarkdown = readFileSync(
	new URL('./BufferedStreamingMarkdown.svelte', import.meta.url),
	'utf8',
);
const target = readFileSync(
	new URL('../infrastructure/services/agent-file-mention-target.service.ts', import.meta.url),
	'utf8',
);

describe('a file link the agent wrote is wired to an open', () => {
	it('reaches every surface in the transcript that renders agent text', () => {
		const renderers = transcript.match(/<(?:MarkdownText|BufferedStreamingMarkdown)\b/gu) ?? [];
		const wired = transcript.match(/onopenfile=\{transcript\.openFileMention\}/gu) ?? [];
		const wiredFromShell = transcript.match(/onopenfile=\{openFileMention\}/gu) ?? [];
		expect(renderers.length).toBeGreaterThan(0);
		expect(wired.length + wiredFromShell.length).toBe(renderers.length);
	});

	it('tells every one of those surfaces which named files can be opened', () => {
		const renderers = transcript.match(/<(?:MarkdownText|BufferedStreamingMarkdown)\b/gu) ?? [];
		const wired = transcript.match(/canopenfile=\{transcript\.canOpenFileMention\}/gu) ?? [];
		const wiredFromShell = transcript.match(/canopenfile=\{canOpenFileMention\}/gu) ?? [];
		expect(wired.length + wiredFromShell.length).toBe(renderers.length);
	});

	it('threads the callback through the buffered renderer rather than stopping at it', () => {
		expect(bufferedMarkdown).toContain('onopenfile?:');
		expect(bufferedMarkdown).toContain('{onopenfile}');
		expect(bufferedMarkdown).toContain('{canopenfile}');
	});

	it('keeps the leaf free of transcript context, because it renders elsewhere too', () => {
		expect(markdownText).not.toContain('transcriptContext');
		expect(markdownText).toContain('onopenfile?:');
	});

	it('takes the file branch before the external-URL branch on a click', () => {
		const handler = markdownText.slice(
			markdownText.indexOf('function onLinkClick'),
			markdownText.indexOf('function onLinkKeydown'),
		);
		expect(handler.indexOf('readFileMentionTarget(anchor)')).toBeGreaterThan(-1);
		expect(handler.indexOf('readFileMentionTarget(anchor)')).toBeLessThan(
			handler.indexOf('safeExternalUrl(anchor.getAttribute'),
		);
		expect(handler).toContain('onopenfile?.(fileTarget, anchor)');
	});

	it('activates a mention from the keyboard as well as the pointer', () => {
		expect(markdownText).toContain("node.addEventListener('keydown', onLinkKeydown)");
		const handler = markdownText.slice(markdownText.indexOf('function onLinkKeydown'));
		expect(handler).toContain("event.key !== 'Enter' && event.key !== ' '");
		expect(handler).toContain('onopenfile?.(fileTarget, anchor)');
	});

	it('opens through the repository command and says so when it is refused', () => {
		expect(target).toContain("OPEN_REPOSITORY_FILE_COMMAND = 'malini.repository.open-file'");
		expect(target).toContain(
			'extensionCommands.execute(workstreamId, OPEN_REPOSITORY_FILE_COMMAND, {\n\t\t\tpath: target.path,\n\t\t\tline: target.line,\n\t\t})',
		);
		expect(target).toContain(
			'toast.info(fileMentionFailureMessage(target, cause), aboutWorkstream(workstreamId))',
		);
	});
});
