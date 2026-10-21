import { BoundedHtmlCache, textFingerprint } from '$hyper-ui/components/code-tokens';

export const SANITIZED_MARKDOWN_HTML_CACHE_MAX_CHARACTERS = 8_000_000;

export function sanitizedMarkdownHtmlCacheKey(
	mode: 'markdown' | 'prose' | 'plain',
	masked: boolean,
	runnable: boolean,
	source: string,
): string {
	return `${mode}\u0000${masked ? 'masked' : 'shown'}\u0000${runnable ? 'runnable' : 'static'}\u0000${textFingerprint(source)}`;
}

export const sanitizedMarkdownHtmlCache = new BoundedHtmlCache(
	SANITIZED_MARKDOWN_HTML_CACHE_MAX_CHARACTERS,
);
