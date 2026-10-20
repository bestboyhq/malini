import { highlightCode, resolveLanguage, type CodeToken } from '@malini/extension-api';
import { SENSITIVE_REVEAL_LABEL, sensitiveSegmentsAcross } from '../sensitive/sensitive-segments';
import { sensitiveMasking } from '../sensitive/sensitive-masking.svelte';
import { BoundedHtmlCache, textFingerprint } from './bounded-html-cache';

const SENSITIVE_MATCH_ATTRIBUTE = 'data-sensitive-match';
const CODE_HTML_CACHE_CHARACTERS = 4_000_000;

const highlightedHtml = new BoundedHtmlCache(CODE_HTML_CACHE_CHARACTERS);

export function escapeCodeText(text: string): string {
	return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function highlightedCodeHtml(code: string, language: string | null | undefined): string {
	if (code.length === 0) return '';
	const key = cacheKey(code, language);
	const cached = highlightedHtml.get(key);
	if (cached !== undefined) return cached;
	const html = tokensHtml(highlightCode(code, resolveLanguage(language, code)));
	highlightedHtml.set(key, html);
	return html;
}

export function plainCodeHtml(code: string): string {
	return tokensHtml([{ text: code, kind: 'plain' }]);
}

export function hasHighlightedCodeHtml(code: string, language: string | null | undefined): boolean {
	return highlightedHtml.get(cacheKey(code, language)) !== undefined;
}

function cacheKey(code: string, language: string | null | undefined): string {
	const masked = sensitiveMasking.on ? 'masked' : 'shown';
	return `${masked}\u0000${language ?? ''}\u0000${textFingerprint(code)}`;
}

function tokensHtml(tokens: readonly CodeToken[]): string {
	const pieces = sensitiveSegmentsAcross(tokens.map((token) => token.text));
	let html = '';
	tokens.forEach((token, index) => {
		let inner = '';
		for (const piece of pieces[index] ?? []) {
			inner += piece.kind
				? `<span class="hyper-sensitive" data-sensitive="${piece.kind}" ${SENSITIVE_MATCH_ATTRIBUTE}="${piece.match}" role="button" tabindex="0" aria-label="${SENSITIVE_REVEAL_LABEL[piece.kind]}"><span class="hyper-sensitive-mask">${escapeCodeText(piece.text)}</span></span>`
				: escapeCodeText(piece.text);
		}
		html += token.kind === 'plain' ? inner : `<span class="tok-${token.kind}">${inner}</span>`;
	});
	return html;
}

export function revealSensitiveCode(event: Event): boolean {
	if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return false;
	if (!(event.target instanceof Element)) return false;
	const control = event.target.closest(`.hyper-sensitive[${SENSITIVE_MATCH_ATTRIBUTE}]`);
	const code = control?.closest('code');
	if (!control || !code) return false;
	event.preventDefault();
	event.stopPropagation();
	const match = control.getAttribute(SENSITIVE_MATCH_ATTRIBUTE);
	for (const piece of code.querySelectorAll(`[${SENSITIVE_MATCH_ATTRIBUTE}="${match}"]`)) {
		piece.replaceWith(...(piece.firstElementChild?.childNodes ?? []));
	}
	return true;
}
