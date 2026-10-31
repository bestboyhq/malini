import type { ClassValue } from 'svelte/elements';

export type Brand =
	'claude' | 'github' | 'google' | 'hacker-news' | 'openai' | 'reddit' | 'x' | 'youtube';

export interface IconProps {
	class?: ClassValue;
	size?: number;
	ariaLabel?: string;
}

export function iconLabel(ariaLabel: string | undefined): {
	role?: 'img';
	'aria-label'?: string;
	'aria-hidden'?: 'true';
} {
	return ariaLabel === undefined
		? { 'aria-hidden': 'true' }
		: { role: 'img', 'aria-label': ariaLabel };
}
