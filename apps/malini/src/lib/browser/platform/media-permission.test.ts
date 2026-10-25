import type { MessageBoxOptions } from 'electron';
import { describe, expect, it } from 'vitest';
import { mediaPermissionQuestion, rememberMediaAnswers, type MediaKind } from './media-permission';

describe('mediaPermissionQuestion', () => {
	it.each<[string, MediaKind[], string]>([
		['http://localhost:5173/', ['audio'], 'Allow localhost:5173 to use your microphone?'],
		['https://example.com', ['video'], 'Allow example.com to use your camera?'],
		[
			'http://localhost:5173/',
			['audio', 'video'],
			'Allow localhost:5173 to use your camera and microphone?',
		],
		['malini-worktree://01abc/', ['audio'], 'Allow this worktree page to use your microphone?'],
	])('asks %s for %j as %s', (origin, kinds, message) => {
		expect(mediaPermissionQuestion(origin, kinds)).toEqual({
			type: 'question',
			message,
			detail: 'Malini remembers your answer until it quits.',
			buttons: ['Allow', 'Don’t Allow'],
			defaultId: 1,
			cancelId: 1,
		});
	});
});

describe('rememberMediaAnswers', () => {
	const asker = (answers: boolean[]) => {
		const asked: string[] = [];
		const media = rememberMediaAnswers(async (question: MessageBoxOptions) => {
			asked.push(question.message);
			return answers.shift() ?? false;
		});
		return { asked, media };
	};

	it('asks once per origin and kind and remembers an allow', async () => {
		const { asked, media } = asker([true, false, true]);
		expect(await media.request('http://localhost:5173/app', ['audio'])).toBe(true);
		expect(await media.request('http://localhost:5173/other', ['audio'])).toBe(true);
		expect(media.allowed('http://localhost:5173/', 'audio')).toBe(true);
		expect(media.allowed('http://localhost:5173/', 'video')).toBe(false);
		expect(media.allowed('http://localhost:5174/', 'audio')).toBe(false);
		expect(await media.request('http://localhost:5173/', ['audio', 'video'])).toBe(false);
		expect(await media.request('http://localhost:5174/', ['audio'])).toBe(true);
		expect(asked).toEqual([
			'Allow localhost:5173 to use your microphone?',
			'Allow localhost:5173 to use your camera?',
			'Allow localhost:5174 to use your microphone?',
		]);
	});

	it('remembers a deny, so a page that asks in a loop is asked once', async () => {
		const { asked, media } = asker([false, true]);
		const answers = await Promise.all(
			Array.from({ length: 5 }, () => media.request('malini-worktree://01abc/a.html', ['audio'])),
		);
		expect(answers).toEqual([false, false, false, false, false]);
		expect(media.allowed('malini-worktree://01abc/', 'audio')).toBe(false);
		expect(asked).toEqual(['Allow this worktree page to use your microphone?']);
	});

	it('refuses without asking when there is no site or no device', async () => {
		const { asked, media } = asker([true]);
		expect(await media.request('null', ['audio'])).toBe(false);
		expect(await media.request('about:blank', ['audio'])).toBe(false);
		expect(await media.request('http://localhost:5173/', [])).toBe(false);
		expect(media.allowed('null', 'audio')).toBe(false);
		expect(asked).toEqual([]);
	});
});
