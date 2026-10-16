import type { SkillPresetRecord } from '$contract/skills';

const MAX_EMOJI_LENGTH = 32;
const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' });
const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

export const PRESET_EMOJI_CHOICES: readonly string[] = Array.from(
	GRAPHEMES.segment(
		'🛠️🧰🏗️⚙️🔧🧪🐛🚀💻🖥️📱🌐☁️🗄️🔒🤖🎨🖌️✏️✍️📝📚🎬🎵📣📈📊💼🎯🔍🧭💡🎮🧩🧠✨⚡🔥🌱🦊',
	),
	({ segment }) => segment,
);

export function firstEmoji(text: string): string | null {
	for (const { segment } of GRAPHEMES.segment(text)) {
		if (PICTOGRAPH.test(segment) && segment.length <= MAX_EMOJI_LENGTH) return segment;
	}
	return null;
}

export function isPresetEmoji(value: unknown): value is string {
	return typeof value === 'string' && firstEmoji(value) === value;
}

export function presetMark(preset: Pick<SkillPresetRecord, 'name' | 'emoji'>): string {
	return preset.emoji ?? preset.name.slice(0, 1).toLocaleUpperCase();
}
