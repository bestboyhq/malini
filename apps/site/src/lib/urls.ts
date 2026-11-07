import { dev } from '$app/environment';
import { asset } from '$app/paths';

export const GITHUB_URL = 'https://github.com/bestboyhq/malini';

export type DemoPlay = 'hero' | 'tour' | 'sweep' | 'cycle' | 'docs';

export function demoHref(page: 'app' | 'card', hash: string, play?: DemoPlay): string {
	return `${asset(dev ? `/demo/${page}.html` : `/demo/${page}`)}${play ? `?play=${play}` : ''}#${hash}`;
}
