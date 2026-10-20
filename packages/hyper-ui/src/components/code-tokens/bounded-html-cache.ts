export class BoundedHtmlCache {
	readonly #entries = new Map<string, string>();
	#characterCount = 0;

	constructor(readonly maxCharacters: number) {
		if (!Number.isInteger(maxCharacters) || maxCharacters < 1) {
			throw new RangeError('HTML cache character bound must be a positive integer');
		}
	}

	get size(): number {
		return this.#entries.size;
	}

	get characterCount(): number {
		return this.#characterCount;
	}

	get(key: string): string | undefined {
		const html = this.#entries.get(key);
		if (html === undefined) return undefined;
		this.#entries.delete(key);
		this.#entries.set(key, html);
		return html;
	}

	set(key: string, html: string): boolean {
		this.#delete(key);
		const retained = key.length + html.length;
		if (retained > this.maxCharacters) return false;
		this.#entries.set(key, html);
		this.#characterCount += retained;
		while (this.#characterCount > this.maxCharacters) {
			const oldest = this.#entries.keys().next().value;
			if (oldest === undefined) break;
			this.#delete(oldest);
		}
		return this.#entries.has(key);
	}

	clear(): void {
		this.#entries.clear();
		this.#characterCount = 0;
	}

	#delete(key: string): void {
		const html = this.#entries.get(key);
		if (html === undefined) return;
		this.#entries.delete(key);
		this.#characterCount -= key.length + html.length;
	}
}

export function textFingerprint(text: string): string {
	let first = 0xdeadbeef;
	let second = 0x41c6ce57;
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		first = Math.imul(first ^ code, 2654435761);
		second = Math.imul(second ^ code, 1597334677);
	}
	first =
		Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
	second =
		Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
	return `${(4294967296 * (2097151 & second) + (first >>> 0)).toString(36)}:${text.length}`;
}
