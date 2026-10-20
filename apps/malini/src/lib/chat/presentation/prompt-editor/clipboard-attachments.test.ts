// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { clipboardAttachmentCandidates } from './clipboard-attachments';

function fileList(files: File[]): FileList {
	return Object.assign(files, { item: (index: number) => files[index] ?? null });
}

function dataTransferItemList(): DataTransferItemList {
	return Object.assign([], {
		add: () => null,
		clear: () => undefined,
		remove: () => undefined,
	});
}

function clipboard(types: string[], files: File[] = []): DataTransfer {
	return {
		types,
		files: fileList(files),
		items: dataTransferItemList(),
		dropEffect: 'none',
		effectAllowed: 'uninitialized',
		clearData: () => undefined,
		getData: () => '',
		setData: () => undefined,
		setDragImage: () => undefined,
	};
}

function png(name: string, bytes = [0x89, 0x50, 0x4e, 0x47]): File {
	return new File([new Uint8Array(bytes)], name, { type: 'image/png' });
}

describe('clipboardAttachmentCandidates', () => {
	it('lets a plain text paste through untouched', () => {
		expect(clipboardAttachmentCandidates(clipboard(['text/plain']))).toEqual([]);
		expect(clipboardAttachmentCandidates(clipboard(['text/plain', 'text/html']))).toEqual([]);
		expect(clipboardAttachmentCandidates(null)).toEqual([]);
		expect(clipboardAttachmentCandidates(clipboard([]))).toEqual([]);
	});

	it('names a macOS screenshot that arrived without one', () => {
		const unnamed = clipboardAttachmentCandidates(clipboard(['Files', 'image/png'], [png('')]));
		expect(unnamed.map((candidate) => candidate.fileName)).toEqual(['pasted-image.png']);

		const generic = clipboardAttachmentCandidates(
			clipboard(['Files', 'image/png'], [png('image.png')]),
			'3',
		);
		expect(generic.map((candidate) => candidate.fileName)).toEqual(['pasted-image-3.png']);
	});

	it('keeps a real filename and derives one only where it must', () => {
		const candidates = clipboardAttachmentCandidates(
			clipboard(['Files'], [png('diagram-v2.png'), png('')]),
			'7',
		);
		expect(candidates.map((candidate) => candidate.fileName)).toEqual([
			'diagram-v2.png',
			'pasted-image-7-2.png',
		]);
	});

	it('takes files even when a rich copy put html alongside them', () => {
		const candidates = clipboardAttachmentCandidates(
			clipboard(['text/html', 'Files', 'image/png'], [png('')]),
		);
		expect(candidates.map((candidate) => candidate.fileName)).toEqual(['pasted-image.png']);
	});

	it('skips zero-byte files and anything it cannot name', () => {
		const empty = new File([], 'image.png', { type: 'image/png' });
		const anonymous = new File([new Uint8Array([1])], '', { type: '' });
		const extensionless = new File([new Uint8Array([1])], 'archive', { type: '' });
		const candidates = clipboardAttachmentCandidates(
			clipboard(['Files'], [empty, anonymous, extensionless, png('shot.png')]),
		);
		expect(candidates.map((candidate) => candidate.fileName)).toEqual(['shot.png']);
	});

	it('hands back the file itself so the caller can read it', () => {
		const file = png('shot.png');
		expect(clipboardAttachmentCandidates(clipboard(['Files'], [file]))[0]?.file).toBe(file);
	});
});
