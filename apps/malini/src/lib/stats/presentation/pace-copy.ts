import type { IconName } from '$hyper-ui/icons';
import type { Pace } from '$lib/stats/domain/pace';

export type PaceNudge = Readonly<{ icon: IconName; tone: string; line: string }>;

type Lines = readonly [string, ...string[]];

const NUDGES: Readonly<Record<Pace, Readonly<{ icon: IconName; tone: string; lines: Lines }>>> = {
	crushing: {
		icon: 'flame',
		tone: 'text-accent-2-primary',
		lines: [
			'Crushing it as always',
			'Your agents can barely keep up',
			"Shipping like it's a sport",
		],
	},
	'warming-up': {
		icon: 'sun',
		tone: 'text-warning-content',
		lines: [
			'Warming up before taking over the world',
			'Charging up for the next big push',
			'The calm before the shipping storm',
		],
	},
};

const DAY_MS = 86_400_000;

export function paceNudge(pace: Pace, today: string): PaceNudge {
	const { icon, tone, lines } = NUDGES[pace];
	const day = Math.floor(Date.parse(`${today}T00:00:00Z`) / DAY_MS);
	return { icon, tone, line: lines[day % lines.length] ?? lines[0] };
}
