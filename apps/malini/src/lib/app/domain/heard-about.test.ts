import { describe, expect, it } from 'vitest';
import { heardAbout, heardAboutProps, heardAboutSetting } from './heard-about';

describe('where you heard about Malini', () => {
	it('keeps a channel you picked and reads it back', () => {
		const setting = heardAboutSetting({ channel: 'hacker-news', detail: 'ignored' });
		expect(setting).toBe('hacker-news');
		expect(heardAboutProps(heardAbout(setting))).toEqual({ heard_about: 'hacker-news' });
	});

	it('keeps what you typed for somewhere else on your Mac, and sends only the option', () => {
		const setting = heardAboutSetting({
			channel: 'somewhere-else',
			detail: `  @theo's\nvideo ${'x'.repeat(200)}`,
		});
		expect(setting).toBe(`theo's video ${'x'.repeat(87)}`);
		expect(heardAboutProps(heardAbout(setting))).toEqual({ heard_about: 'somewhere-else' });
	});

	it('sends nothing before you answer, or after you skip', () => {
		expect(heardAboutProps(heardAbout(null))).toEqual({});
		expect(heardAboutSetting(null)).toBe('');
		expect(heardAboutProps(heardAbout(heardAboutSetting(null)))).toEqual({});
	});

	it('sends somewhere else alone when you typed nothing', () => {
		const setting = heardAboutSetting({ channel: 'somewhere-else', detail: ' @ ' });
		expect(heardAboutProps(heardAbout(setting))).toEqual({ heard_about: 'somewhere-else' });
	});
});
