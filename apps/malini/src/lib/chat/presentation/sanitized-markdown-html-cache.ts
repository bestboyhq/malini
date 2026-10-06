export const SANITIZED_MARKDOWN_HTML_CACHE_MAX_ENTRIES = 128;
export const SANITIZED_MARKDOWN_HTML_CACHE_MAX_CHARACTERS = 512_000;

type CacheEntry = Readonly<{
	html: string;
	retainedCharacters: number;
}>;

export class SanitizedMarkdownHtmlCache {
	readonly #entries = new Map<string, CacheEntry>();
	#characterCount = 0;

	constructor(
		readonly maxEntries = SANITIZED_MARKDOWN_HTML_CACHE_MAX_ENTRIES,
		readonly maxCharacters = SANITIZED_MARKDOWN_HTML_CACHE_MAX_CHARACTERS,
	) {
		if (!Number.isInteger(maxEntries) || maxEntries < 1) {
			throw new RangeError('Sanitized markdown HTML cache entry bound must be a positive integer');
		}
		if (!Number.isInteger(maxCharacters) || maxCharacters < 1) {
			throw new RangeError(
				'Sanitized markdown HTML cache character bound must be a positive integer',
			);
		}
	}

	get size(): number {
		return this.#entries.size;
	}

	get characterCount(): number {
		return this.#characterCount;
	}

	get(key: string): string | undefined {
		const existing = this.#entries.get(key);
		if (!existing) return undefined;

		this.#entries.delete(key);
		this.#entries.set(key, existing);
		return existing.html;
	}

	set(key: string, html: string): boolean {
		this.#delete(key);

		const retainedCharacters = key.length + html.length;
		if (retainedCharacters > this.maxCharacters) return false;

		this.#entries.set(key, { html, retainedCharacters });
		this.#characterCount += retainedCharacters;
		this.#evictOverflow();
		return this.#entries.has(key);
	}

	clear(): void {
		this.#entries.clear();
		this.#characterCount = 0;
	}

	#delete(key: string): boolean {
		const existing = this.#entries.get(key);
		if (!existing) return false;
		this.#entries.delete(key);
		this.#characterCount -= existing.retainedCharacters;
		return true;
	}

	#evictOverflow(): void {
		while (this.#entries.size > this.maxEntries || this.#characterCount > this.maxCharacters) {
			const leastRecentlyUsedKey = this.#entries.keys().next().value;
			if (leastRecentlyUsedKey === undefined) return;
			this.#delete(leastRecentlyUsedKey);
		}
	}
}

export function sanitizedMarkdownHtmlCacheKey(
	mode: 'markdown' | 'prose' | 'plain',
	source: string,
): string {
	return `${mode}\u0000${source}`;
}

export const sanitizedMarkdownHtmlCache = new SanitizedMarkdownHtmlCache();
