export const HEARD_ABOUT_SETTING = 'heard-about';

export const HEARD_ABOUT_CHANNELS = [
	'hacker-news',
	'youtube',
	'twitter',
	'github',
	'reddit',
	'chatgpt',
	'claude',
	'google',
	'friend',
	'somewhere-else',
] as const;

export type HeardAboutChannel = (typeof HEARD_ABOUT_CHANNELS)[number];

export type HeardAbout = Readonly<{ channel: HeardAboutChannel; detail: string }>;

const DETAIL_LIMIT = 100;

export function heardAboutDetail(text: string): string {
	const words = text
		.replace(/[\p{Cc}@]/gu, ' ')
		.trim()
		.split(/\s+/u)
		.join(' ');
	return Array.from(words).slice(0, DETAIL_LIMIT).join('').trim();
}

export function heardAboutSetting(answer: HeardAbout | null): string {
	if (!answer) return '';
	if (answer.channel !== 'somewhere-else') return answer.channel;
	return heardAboutDetail(answer.detail) || answer.channel;
}

export function heardAbout(setting: string | null | undefined): HeardAbout | null {
	if (!setting) return null;
	const channel = HEARD_ABOUT_CHANNELS.find((known) => known === setting);
	if (channel) return { channel, detail: '' };
	return { channel: 'somewhere-else', detail: heardAboutDetail(setting) };
}

export function heardAboutProps(answer: HeardAbout | null): Readonly<Record<string, string>> {
	if (!answer) return {};
	return answer.detail
		? { heard_about: answer.channel, heard_about_detail: answer.detail }
		: { heard_about: answer.channel };
}
