import { describe, expect, it } from 'vitest';
import { toolImageRead } from './tool-image-read';

const IMAGE_OUTPUT = {
	path: '.malini/agent-attachments/att-949bae2d/pasted-image-0.png',
	mediaType: 'image/png',
	bytesRead: 32_820,
	kind: 'image',
};

describe('toolImageRead', () => {
	it('recognizes the text the Claude bridge reports for an image Read', () => {
		const input = { file_path: '/Users/simon/malini/workstreams/ws-1/docs/shot.PNG' };

		expect(toolImageRead('Read', input, '[image]')).toMatchObject({
			path: 'docs/shot.PNG',
			fileName: 'shot.PNG',
			mediaType: 'image/png',
			previewable: true,
		});
		expect(toolImageRead('Read', { file_path: 'notes.txt' }, '[image]')).toBeNull();
		expect(toolImageRead('Read', input, 'plain text')).toBeNull();
	});

	it('recognizes the shape the bridge returns for an image', () => {
		const image = toolImageRead('read', { path: 'ignored.png' }, IMAGE_OUTPUT);

		expect(image).toEqual({
			path: '.malini/agent-attachments/att-949bae2d/pasted-image-0.png',
			fileName: 'pasted-image-0.png',
			mediaType: 'image/png',
			bytes: 32_820,
			note: null,
			previewable: true,
		});
	});

	it('promises no preview for an approved read outside the worktree', () => {
		const outside = { ...IMAGE_OUTPUT, path: '/Users/simon/Desktop/shot.png' };

		expect(toolImageRead('read', {}, outside)).toMatchObject({
			fileName: 'shot.png',
			previewable: false,
		});
	});

	it('addresses the file the tool resolved, not the one the model typed', () => {
		const image = toolImageRead('read', { path: '~/shot.png' }, IMAGE_OUTPUT);

		expect(image?.path).toBe('.malini/agent-attachments/att-949bae2d/pasted-image-0.png');
	});

	it('keeps a note about an image the model was told about but never shown', () => {
		const note = 'image exceeds the 3670016-byte viewing limit; resize it before reading';

		expect(toolImageRead('read', {}, { ...IMAGE_OUTPUT, note })?.note).toBe(note);
	});

	it('reads Codex-style view_image calls too', () => {
		expect(toolImageRead('view_image', {}, IMAGE_OUTPUT)).not.toBeNull();
	});

	it('never guesses from the extension', () => {
		const text = { path: 'notes.png', content: 'plain text', bytesRead: 10, truncated: false };

		expect(toolImageRead('read', { path: 'notes.png' }, text)).toBeNull();
		expect(toolImageRead('read', { path: 'notes.png' }, undefined)).toBeNull();
	});

	it('declines an image-shaped output from a tool that is not a read', () => {
		expect(toolImageRead('write', { path: 'shot.png' }, IMAGE_OUTPUT)).toBeNull();
		expect(toolImageRead('bash', { command: 'cat shot.png' }, IMAGE_OUTPUT)).toBeNull();
	});

	it('declines an output whose media type is not an image', () => {
		expect(toolImageRead('read', {}, { ...IMAGE_OUTPUT, mediaType: 'application/pdf' })).toBeNull();
		expect(toolImageRead('read', {}, { ...IMAGE_OUTPUT, kind: 'text' })).toBeNull();
	});

	it('declines an image with no path to address', () => {
		expect(toolImageRead('read', {}, { mediaType: 'image/png', kind: 'image' })).toBeNull();
	});
});
