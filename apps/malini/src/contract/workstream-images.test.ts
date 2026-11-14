import { describe, expect, it } from 'vitest';
import {
	contextMediaCategory,
	mediaKind,
	workstreamImageFilePath,
	workstreamImagePath,
} from './workstream-images';

describe('contextMediaCategory', () => {
	it.each([
		['.context/shot.png', 'images'],
		['.context/shots/Photo.JPEG', 'images'],
		['.context/a.jpg', 'images'],
		['.context/a.gif', 'images'],
		['.context/a.webp', 'images'],
		['.context/logo.svg', 'images'],
		['.context/run.mp4', 'videos'],
		['.context/run.m4v', 'videos'],
		['.context/run.MOV', 'videos'],
		['.context/run.webm', 'videos'],
		['.context/voice.mp3', 'audio'],
		['.context/voice.m4a', 'audio'],
		['.context/voice.wav', 'audio'],
		['.context/voice.ogg', 'audio'],
		['.context/voice.oga', 'audio'],
		['.context/voice.flac', 'audio'],
		['.context/voice.aac', 'audio'],
		['.context/prototype.html', 'pages'],
		['.context/prototype.HTM', 'pages'],
		['.context/spec.pdf', 'documents'],
		['.context/notes.md', 'documents'],
		['.context/notes.markdown', 'documents'],
		['.context/log.txt', 'documents'],
		['.context/table.csv', 'documents'],
		['.context/data.json', 'documents'],
	] as const)('puts %s under %s', (path, category) => {
		expect(contextMediaCategory(path)).toBe(category);
	});

	it.each([
		'.context/run.log',
		'.context/archive.zip',
		'.context/png',
		'.context/notes.md.bak',
		'Makefile',
	])('leaves %s out', (path) => {
		expect(contextMediaCategory(path)).toBeNull();
	});

	it('keeps an svg a page for report media, which frames it', () => {
		expect(mediaKind('.context/logo.svg')).toBe('page');
	});
});

describe('workstreamImagePath', () => {
	it.each(['C:\\work\\.context\\shot.png', 'D:/work/.context/shot.png', '/work/.context/shot.png'])(
		'takes %s for a file',
		(path) => {
			expect(workstreamImagePath(path)).toBe(path);
		},
	);

	it.each(['https://example.com/shot.png', 'data:image/png;base64,AA', '//example.com/shot.png'])(
		'leaves %s to the web',
		(src) => {
			expect(workstreamImagePath(src)).toBeNull();
		},
	);
});

describe('workstreamImageFilePath', () => {
	it.each([
		['/ws/root/', './.context/shot.png', '/ws/root/.context/shot.png'],
		['/ws/root', '/elsewhere/shot.png', '/elsewhere/shot.png'],
		[null, '.context/shot.png', '.context/shot.png'],
		['C:\\ws\\root\\', './.context/shot.png', 'C:\\ws\\root\\.context\\shot.png'],
		['C:\\ws\\root', '.\\.context\\shot.png', 'C:\\ws\\root\\.context\\shot.png'],
		['C:\\ws\\root', 'D:/elsewhere/shot.png', 'D:\\elsewhere\\shot.png'],
		['\\\\server\\share\\root', '.context/shot.png', '\\\\server\\share\\root\\.context\\shot.png'],
	] as const)('puts %s and %s together as %s', (root, path, file) => {
		expect(workstreamImageFilePath(root, path)).toBe(file);
	});
});
