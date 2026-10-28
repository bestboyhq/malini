<script module lang="ts">
	import DOMPurify from 'dompurify';
	import { marked } from 'marked';
	import { mount, unmount, type Component } from 'svelte';
	import {
		escapeCodeText,
		hasHighlightedCodeHtml,
		highlightedCodeHtml,
		plainCodeHtml,
	} from '$hyper-ui/components/code-tokens';
	import { maskSensitiveText } from '$hyper-ui/components/sensitive';
	import { languageHintLabel, languageLabel, resolveLanguage } from '@malini/extension-api';
	import { linkifyFileMentionsIn, markFileMentions } from './file-mention-links';
	import {
		holdWorkstreamImagesIn,
		offerImages,
		showImages,
		WORKSTREAM_IMAGE_ATTRIBUTE,
	} from './workstream-images';
	import {
		sanitizedMarkdownHtmlCache,
		sanitizedMarkdownHtmlCacheKey,
	} from './sanitized-markdown-html-cache';
	import MarkdownCodeCopyButton from './MarkdownCodeCopyButton.svelte';
	import MarkdownCodeRunButton from './MarkdownCodeRunButton.svelte';

	export type MarkdownRenderMode = 'markdown' | 'prose' | 'plain';

	export type StreamingMarkdownUpdate = {
		text: string;
		mode: MarkdownRenderMode;
		streamingTailCharacters: number;
		masked?: boolean;
	};

	export type MarkdownDecorations = {
		canOpenFile: ((path: string) => boolean) | undefined;
		imageSource: ((path: string) => string | null) | undefined;
		galleryImages: boolean;
	};

	export type StreamingMarkdownRenderer = {
		update(update: StreamingMarkdownUpdate): void;
		decorate(decorations: MarkdownDecorations): void;
		destroy(): void;
	};

	function closeUnclosedFence(source: string): string {
		const fenceMatches = source.match(/^ {0,3}```/gm);
		if (fenceMatches && fenceMatches.length % 2 === 1) {
			return `${source}\n\`\`\``;
		}
		return source;
	}

	const PLAIN_URL_PATTERN = /https?:\/\/[^\s<>"'`]+/giu;
	const MAX_FADED_TAIL_CHARACTERS = 160;
	const STREAM_TOKEN_CLASS = 'markdown-stream-token';
	const CODE_BLOCK_SELECTOR = 'code[data-code-block]';
	const CODE_LANGUAGE_ATTRIBUTE = 'data-code-language';
	const SYNC_HIGHLIGHT_CHARACTERS = 2_000;
	const CODE_WATCH_OPTIONS: IntersectionObserverInit = {
		rootMargin: '100% 0px',
		scrollMargin: '100% 0px',
	};

	const FENCE_LINE = /^ {0,3}(?:```|~~~)/u;
	const BLANK_LINE = /^[ \t]*$/u;
	const CONTINUATION_LINE = /^(?:[ \t]|[-*+][ \t]|\d{1,9}[.)][ \t]|>)/u;
	const LINK_REFERENCE_DEFINITION = /^ {0,3}\[[^\]\n]+\]:/mu;

	/**
	 * Splits markdown into blocks that reassemble to exactly the input and parse
	 * to exactly the same HTML, cutting only where the next line cannot continue
	 * the block above it. Every block but the last is then final for the rest of
	 * a stream.
	 */
	export function splitMarkdownChunks(source: string): string[] {
		if (source.length === 0) return [];
		if (LINK_REFERENCE_DEFINITION.test(source)) return [source];

		const lines = source.split('\n');
		const lineStarts: number[] = [];
		let cursor = 0;
		for (const line of lines) {
			lineStarts.push(cursor);
			cursor += line.length + 1;
		}

		const chunks: string[] = [];
		let chunkStart = 0;
		let insideFence = false;
		let chunkHasContent = false;

		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index] ?? '';
			if (FENCE_LINE.test(line)) {
				insideFence = !insideFence;
				chunkHasContent = true;
				continue;
			}
			if (insideFence || !BLANK_LINE.test(line)) {
				chunkHasContent = true;
				continue;
			}
			if (!chunkHasContent) continue;

			let next = index + 1;
			while (next < lines.length && BLANK_LINE.test(lines[next] ?? '')) next += 1;
			if (next >= lines.length || CONTINUATION_LINE.test(lines[next] ?? '')) continue;

			const nextStart = lineStarts[next] ?? source.length;
			chunks.push(source.slice(chunkStart, nextStart));
			chunkStart = nextStart;
			chunkHasContent = false;
			index = next - 1;
		}

		if (chunkStart < source.length) chunks.push(source.slice(chunkStart));
		return chunks;
	}

	function escapeHtml(value: string): string {
		return value
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;')
			.replaceAll("'", '&#39;');
	}

	function splitTrailingPunctuation(candidate: string): [url: string, trailing: string] {
		let end = candidate.length;
		while (end > 0 && /[.,;!]/u.test(candidate[end - 1] ?? '')) end -= 1;
		for (const [opening, closing] of [
			['(', ')'],
			['[', ']'],
			['{', '}'],
		] as const) {
			while (
				candidate[end - 1] === closing &&
				candidate.slice(0, end).split(closing).length >
					candidate.slice(0, end).split(opening).length
			) {
				end -= 1;
			}
		}
		return [candidate.slice(0, end), candidate.slice(end)];
	}

	function safeExternalUrl(value: string | null): string | null {
		if (!value) return null;
		try {
			const url = new URL(value);
			return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
		} catch {
			return null;
		}
	}

	function linkifyPlainText(source: string): string {
		let cursor = 0;
		let result = '';
		for (const match of source.matchAll(PLAIN_URL_PATTERN)) {
			const index = match.index ?? cursor;
			const [candidate, trailing] = splitTrailingPunctuation(match[0]);
			const safeUrl = safeExternalUrl(candidate);
			result += escapeHtml(source.slice(cursor, index));
			result += safeUrl
				? `<a href="${escapeHtml(safeUrl)}">${escapeHtml(candidate)}</a>${escapeHtml(trailing)}`
				: escapeHtml(match[0]);
			cursor = index + match[0].length;
		}
		return result + escapeHtml(source.slice(cursor));
	}

	function unsanitizedHtml(source: string, renderMode: MarkdownRenderMode): string {
		return renderMode === 'plain'
			? linkifyPlainText(source)
			: marked.parse(source, { async: false, breaks: renderMode !== 'prose', gfm: true });
	}

	export function renderSanitizedHtml(source: string, renderMode: MarkdownRenderMode): string {
		return DOMPurify.sanitize(unsanitizedHtml(source, renderMode));
	}

	type CodeBlockButtons = Readonly<{ copy: string; run: string }>;

	function decoratedFragment(
		source: string,
		mode: MarkdownRenderMode,
		masked: boolean,
		buttons: CodeBlockButtons,
	): DocumentFragment {
		const fragment = DOMPurify.sanitize(unsanitizedHtml(source, mode), {
			RETURN_DOM_FRAGMENT: true,
		});
		holdWorkstreamImagesIn(fragment);
		linkifyFileMentionsIn(fragment);
		if (masked) maskSensitiveText(fragment);
		wrapCodeBlocks(fragment, buttons);
		return fragment;
	}

	function wrapCodeBlocks(root: DocumentFragment, buttons: CodeBlockButtons): void {
		for (const code of root.querySelectorAll('pre > code')) {
			const pre = code.parentElement;
			if (!pre) continue;
			const template = root.ownerDocument.createElement('template');
			template.innerHTML = codeBlockHtml(
				(code.textContent ?? '').replace(/\n$/u, ''),
				/(?:^|\s)language-(\S+)/u.exec(code.className)?.[1] ?? null,
				buttons,
			);
			pre.replaceWith(template.content);
		}
	}

	function codeBlockHtml(source: string, hint: string | null, buttons: CodeBlockButtons): string {
		const language = resolveLanguage(hint, source);
		const runButton =
			buttons.run && language === 'shell'
				? `<span class="flex" data-code-run>${buttons.run}</span>`
				: '';
		const label = languageHintLabel(hint) ?? languageLabel(language);
		const header = label
			? `<div class="flex h-9 items-center px-3 pt-2"><span class="text-3xs text-fg-tertiary leading-none" data-testid="markdown-code-language">${escapeCodeText(label)}</span></div>`
			: '';
		return [
			`<div class="border-surface-50-border relative my-[0.5em] max-w-full overflow-hidden rounded-xl border-[0.5px]" data-testid="markdown-code-block" data-language="${language}">`,
			header,
			`<div class="absolute top-2 right-2 z-30 flex gap-1">${runButton}<span class="flex" data-code-copy>${buttons.copy}</span></div>`,
			`<div class="relative overflow-hidden ${label ? 'w-full' : 'mr-11'}">`,
			`<div class="code-tokens-scroll max-w-full" aria-label="Code block" data-testid="markdown-code-scroll">`,
			`<pre data-managed-code-block class="m-0 min-w-max bg-transparent px-3 pb-3 ${label ? 'pt-0' : 'pt-3'}">`,
			`<code class="code-tokens" data-code-block ${CODE_LANGUAGE_ATTRIBUTE}="${escapeHtml(hint ?? '')}">${plainCodeHtml(source)}</code>`,
			'</pre></div></div></div>',
		].join('');
	}

	type SegmentContent = { fragment: DocumentFragment; html: string | null };

	function segmentContent(
		source: string,
		mode: MarkdownRenderMode,
		masked: boolean,
		tailCharacters: number,
		buttons: CodeBlockButtons,
	): SegmentContent {
		if (tailCharacters > 0) {
			const fragment = decoratedFragment(source, mode, masked, buttons);
			fadeStreamingTail(fragment, tailCharacters);
			return { fragment, html: null };
		}
		const key = sanitizedMarkdownHtmlCacheKey(mode, masked, buttons.run !== '', source);
		const cached = sanitizedMarkdownHtmlCache.get(key);
		if (cached !== undefined) return { fragment: parsedHtml(cached), html: cached };
		const fragment = decoratedFragment(source, mode, masked, buttons);
		const holder = document.createElement('div');
		holder.append(fragment);
		const html = holder.innerHTML;
		sanitizedMarkdownHtmlCache.set(key, html);
		fragment.append(...holder.childNodes);
		return { fragment, html };
	}

	function parsedHtml(html: string): DocumentFragment {
		const template = document.createElement('template');
		template.innerHTML = html;
		return template.content;
	}

	function fadeStreamingTail(root: DocumentFragment, tailCharacters: number): void {
		const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
		const nodes: Text[] = [];
		let total = 0;
		while (walker.nextNode()) {
			const node = walker.currentNode;
			if (!(node instanceof Text) || node.data.trim().length === 0) continue;
			if (node.parentElement?.closest('pre')) continue;
			nodes.push(node);
			total += node.data.length;
		}
		let remaining = Math.min(MAX_FADED_TAIL_CHARACTERS, Math.max(1, tailCharacters), total);
		for (let index = nodes.length - 1; index >= 0 && remaining > 0; index -= 1) {
			const node = nodes[index];
			if (!node) continue;
			const start = Math.max(0, node.data.length - remaining);
			remaining -= node.data.length - start;
			const faded = start > 0 ? node.splitText(start) : node;
			const run = root.ownerDocument.createElement('span');
			run.className = STREAM_TOKEN_CLASS;
			faded.replaceWith(run);
			run.append(faded);
		}
	}

	type RenderedSegment = {
		source: string;
		html: string | null;
		nodes: ChildNode[];
		decorated: boolean;
		mentions: Element[];
		images: HTMLImageElement[];
	};

	function undecorateSegment(segment: RenderedSegment): void {
		if (!segment.decorated) return;
		segment.decorated = false;
		const nodes: ChildNode[] = [];
		for (const node of segment.nodes) {
			if (!(node instanceof Element)) {
				nodes.push(node);
				continue;
			}
			if (node.classList.contains(STREAM_TOKEN_CLASS)) {
				const children = [...node.childNodes];
				node.replaceWith(...children);
				nodes.push(...children);
				continue;
			}
			for (const run of [...node.querySelectorAll(`.${STREAM_TOKEN_CLASS}`)]) {
				run.replaceWith(...run.childNodes);
			}
			nodes.push(node);
		}
		segment.nodes = nodes;
	}

	function elementsIn<T extends Element>(
		nodes: readonly ChildNode[],
		selector: string,
		type: new () => T,
	): T[] {
		const found: T[] = [];
		for (const node of nodes) {
			if (!(node instanceof Element)) continue;
			if (node.matches(selector) && node instanceof type) found.push(node);
			for (const match of node.querySelectorAll(selector)) {
				if (match instanceof type) found.push(match);
			}
		}
		return found;
	}

	const ATTRIBUTES_DECORATED_IN_PLACE = new Set([
		'src',
		'role',
		'tabindex',
		'aria-label',
		'data-testid',
		'data-file-missing',
		'data-gallery-image',
	]);

	function syncAttributes(existing: Element, incoming: Element): void {
		for (const attribute of [...existing.attributes]) {
			if (incoming.hasAttribute(attribute.name)) continue;
			if (ATTRIBUTES_DECORATED_IN_PLACE.has(attribute.name)) continue;
			existing.removeAttribute(attribute.name);
		}
		for (const attribute of incoming.attributes) {
			if (existing.getAttribute(attribute.name) !== attribute.value) {
				existing.setAttribute(attribute.name, attribute.value);
			}
		}
	}

	function patchNode(existing: ChildNode, incoming: ChildNode): boolean {
		if (existing.nodeType !== incoming.nodeType) return false;
		if (existing.nodeType === Node.TEXT_NODE || existing.nodeType === Node.COMMENT_NODE) {
			if (existing.nodeValue !== incoming.nodeValue) existing.nodeValue = incoming.nodeValue;
			return true;
		}
		if (!(existing instanceof Element) || !(incoming instanceof Element)) return false;
		if (existing.tagName !== incoming.tagName) return false;
		if (existing.namespaceURI !== incoming.namespaceURI) return false;
		if (
			incoming.classList.contains(STREAM_TOKEN_CLASS) &&
			existing.textContent !== incoming.textContent
		) {
			return false;
		}

		syncAttributes(existing, incoming);
		if (existing.matches(CODE_BLOCK_SELECTOR)) {
			const source = incoming.textContent ?? '';
			if (existing.textContent !== source) {
				highlightedCode.add(existing);
				existing.innerHTML = highlightedCodeHtml(source, codeLanguage(existing));
			}
			return true;
		}
		reconcileChildren(existing, [...existing.childNodes], [...incoming.childNodes]);
		return true;
	}

	function reconcileChildren(
		parent: Node,
		existingNodes: readonly ChildNode[],
		incomingNodes: readonly ChildNode[],
	): ChildNode[] {
		const result: ChildNode[] = [];
		const shared = Math.min(existingNodes.length, incomingNodes.length);
		for (let index = 0; index < shared; index += 1) {
			const existing = existingNodes[index];
			const incoming = incomingNodes[index];
			if (existing === undefined || incoming === undefined) break;
			if (patchNode(existing, incoming)) {
				result.push(existing);
				continue;
			}
			parent.replaceChild(incoming, existing);
			result.push(incoming);
		}
		const after = existingNodes[existingNodes.length - 1]?.nextSibling ?? null;
		for (let index = shared; index < existingNodes.length; index += 1) {
			existingNodes[index]?.remove();
		}
		for (let index = shared; index < incomingNodes.length; index += 1) {
			const incoming = incomingNodes[index];
			if (incoming === undefined) continue;
			parent.insertBefore(incoming, after);
			result.push(incoming);
		}
		return result;
	}

	function codeLanguage(code: Element): string | null {
		return code.getAttribute(CODE_LANGUAGE_ATTRIBUTE) || null;
	}

	const highlightedCode = new WeakSet<Element>();
	let codeWatcher: IntersectionObserver | null = null;

	function watchCodeBlocks(codes: readonly Element[]): void {
		for (const code of codes) {
			const source = code.textContent ?? '';
			if (
				source.length <= SYNC_HIGHLIGHT_CHARACTERS ||
				hasHighlightedCodeHtml(source, codeLanguage(code))
			) {
				highlight(code);
			}
			if (typeof IntersectionObserver === 'undefined') {
				highlight(code);
				continue;
			}
			codeWatcher ??= new IntersectionObserver(onCodeVisibility, CODE_WATCH_OPTIONS);
			codeWatcher.observe(code);
		}
	}

	function onCodeVisibility(entries: IntersectionObserverEntry[]): void {
		for (const { target, isIntersecting } of entries) {
			if (!target.isConnected) {
				codeWatcher?.unobserve(target);
				continue;
			}
			if (isIntersecting) highlight(target);
			else flatten(target);
		}
	}

	function highlight(code: Element): void {
		if (highlightedCode.has(code)) return;
		highlightedCode.add(code);
		code.innerHTML = highlightedCodeHtml(code.textContent ?? '', codeLanguage(code));
	}

	function flatten(code: Element): void {
		if (!highlightedCode.delete(code)) return;
		code.innerHTML = plainCodeHtml(code.textContent ?? '');
	}

	/**
	 * Renders a growing markdown source block by block. Settled blocks are never
	 * reparsed or touched again, so per-delta cost follows the block being
	 * written, not the message. The one block that is still growing is patched in
	 * place rather than rebuilt.
	 */
	export function createStreamingMarkdownRenderer(options: {
		container: HTMLElement;
		copyButton?: string;
		runButton?: string;
	}): StreamingMarkdownRenderer {
		const { container } = options;
		const buttons: CodeBlockButtons = {
			copy: options.copyButton ?? '',
			run: options.runButton ?? '',
		};
		const segments: RenderedSegment[] = [];
		let decorations: MarkdownDecorations = {
			canOpenFile: undefined,
			imageSource: undefined,
			galleryImages: false,
		};
		let shown: Required<StreamingMarkdownUpdate> | null = null;

		function dropSegmentsFrom(index: number): void {
			for (const segment of segments.splice(index)) {
				for (const node of segment.nodes) node.remove();
			}
		}

		function adopt(segment: RenderedSegment, content: SegmentContent): void {
			const html = content.html;
			segment.html = html;
			segment.mentions =
				html === null || html.includes('data-file-path')
					? elementsIn(segment.nodes, 'a[data-file-path]', Element)
					: [];
			segment.images =
				html === null || html.includes('<img')
					? elementsIn(segment.nodes, 'img', HTMLImageElement)
					: [];
			decorateSegment(segment, true, true);
			if (html === null || html.includes('data-code-block')) {
				watchCodeBlocks(elementsIn(segment.nodes, CODE_BLOCK_SELECTOR, Element));
			}
		}

		function decorateSegment(segment: RenderedSegment, mentions: boolean, images: boolean): void {
			if (mentions && segment.mentions.length > 0) {
				markFileMentions(segment.mentions, decorations.canOpenFile);
			}
			if (!images || segment.images.length === 0) return;
			showImages(segment.images, decorations.imageSource);
			if (decorations.galleryImages) offerImages(segment.images);
		}

		function renderSegment(
			source: string,
			mode: MarkdownRenderMode,
			masked: boolean,
			tailCharacters: number,
			before: ChildNode | null,
		): RenderedSegment {
			const content = segmentContent(source, mode, masked, tailCharacters, buttons);
			const segment: RenderedSegment = {
				source,
				html: null,
				nodes: [...content.fragment.childNodes],
				decorated: tailCharacters > 0,
				mentions: [],
				images: [],
			};
			container.insertBefore(content.fragment, before);
			adopt(segment, content);
			return segment;
		}

		function patchSegment(
			segment: RenderedSegment,
			source: string,
			mode: MarkdownRenderMode,
			masked: boolean,
			tailCharacters: number,
		): void {
			const content = segmentContent(source, mode, masked, tailCharacters, buttons);
			if (segment.nodes.length === 0) {
				segment.nodes = [...content.fragment.childNodes];
				container.insertBefore(content.fragment, nextNodeAfter(segment));
			} else {
				segment.nodes = reconcileChildren(container, segment.nodes, [
					...content.fragment.childNodes,
				]);
			}
			segment.source = source;
			segment.decorated = tailCharacters > 0;
			adopt(segment, content);
		}

		function nextNodeAfter(segment: RenderedSegment): ChildNode | null {
			const index = segments.indexOf(segment);
			for (const later of segments.slice(index + 1)) {
				const first = later.nodes[0];
				if (first) return first;
			}
			return null;
		}

		function remask(masked: boolean, mode: MarkdownRenderMode, tail: number): void {
			segments.forEach((segment, index) => {
				const segmentTail = index === segments.length - 1 ? tail : 0;
				const key = sanitizedMarkdownHtmlCacheKey(mode, masked, buttons.run !== '', segment.source);
				if (segmentTail === 0 && sanitizedMarkdownHtmlCache.get(key) === segment.html) return;
				const before = nextNodeAfter(segment);
				for (const node of segment.nodes) node.remove();
				segments[index] = renderSegment(segment.source, mode, masked, segmentTail, before);
			});
		}

		function nextChunks(text: string, mode: MarkdownRenderMode): string[] {
			const blockSource = (value: string): string =>
				mode === 'plain' ? value : closeUnclosedFence(value);
			if (shown === null || shown.mode !== mode || segments.length < 3) {
				return splitMarkdownChunks(blockSource(text));
			}
			const settled: string[] = [];
			let offset = 0;
			for (const segment of segments.slice(0, -2)) {
				if (!text.startsWith(segment.source, offset)) break;
				settled.push(segment.source);
				offset += segment.source.length;
			}
			const rest = text.slice(offset);
			if (settled.length === 0 || LINK_REFERENCE_DEFINITION.test(rest)) {
				return splitMarkdownChunks(blockSource(text));
			}
			return [...settled, ...splitMarkdownChunks(blockSource(rest))];
		}

		return {
			update({ text, mode, streamingTailCharacters, masked = false }) {
				const next = { text, mode, streamingTailCharacters, masked };
				if (
					shown !== null &&
					shown.text === text &&
					shown.mode === mode &&
					shown.masked === masked &&
					shown.streamingTailCharacters === streamingTailCharacters
				) {
					return;
				}
				if (shown !== null && shown.masked !== masked && shown.mode === mode) {
					remask(masked, mode, shown.streamingTailCharacters);
				}
				const chunks = nextChunks(text, mode);
				shown = next;

				let settled = 0;
				while (
					settled < chunks.length &&
					settled < segments.length &&
					segments[settled]?.source === chunks[settled]
				) {
					settled += 1;
				}
				for (let index = 0; index < settled; index += 1) {
					const segment = segments[index];
					if (segment) undecorateSegment(segment);
				}

				const growing = segments[settled];
				const grown = chunks[settled];
				if (growing !== undefined && grown !== undefined) {
					dropSegmentsFrom(settled + 1);
					const isTail = settled === chunks.length - 1;
					patchSegment(growing, grown, mode, masked, isTail ? streamingTailCharacters : 0);
					settled += 1;
				}

				dropSegmentsFrom(settled);
				for (let index = settled; index < chunks.length; index += 1) {
					const isTail = index === chunks.length - 1;
					segments.push(
						renderSegment(
							chunks[index] ?? '',
							mode,
							masked,
							isTail ? streamingTailCharacters : 0,
							null,
						),
					);
				}
			},
			decorate(next) {
				const mentions = next.canOpenFile !== decorations.canOpenFile;
				const images =
					next.imageSource !== decorations.imageSource ||
					next.galleryImages !== decorations.galleryImages;
				decorations = next;
				if (!mentions && !images) return;
				for (const segment of segments) decorateSegment(segment, mentions, images);
			},
			destroy: () => dropSegmentsFrom(0),
		};
	}

	type CopyButtonMarkup = { button: string; idleIcon: string; copiedIcon: string };

	let copyButtonMarkup: CopyButtonMarkup | null = null;

	let runButtonMarkup: string | null = null;

	function codeCopyButtonMarkup(): CopyButtonMarkup {
		if (copyButtonMarkup) return copyButtonMarkup;
		const idle = renderedButton(MarkdownCodeCopyButton, { copied: false });
		const copied = renderedButton(MarkdownCodeCopyButton, { copied: true });
		copyButtonMarkup = {
			button: idle?.outerHTML ?? '',
			idleIcon: idle?.innerHTML ?? '',
			copiedIcon: copied?.innerHTML ?? '',
		};
		return copyButtonMarkup;
	}

	function codeRunButtonMarkup(): string {
		runButtonMarkup ??= renderedButton(MarkdownCodeRunButton, {})?.outerHTML ?? '';
		return runButtonMarkup;
	}

	function renderedButton<Props extends Record<string, unknown>>(
		component: Component<Props>,
		props: Props,
	): HTMLButtonElement | null {
		const host = document.createElement('div');
		const instance = mount(component, { target: host, props });
		const button = host.querySelector('button');
		const snapshot = button?.cloneNode(true);
		void unmount(instance);
		return snapshot instanceof HTMLButtonElement ? snapshot : null;
	}
</script>

<script lang="ts">
	import { getAllContexts, untrack } from 'svelte';
	import type { ShellRun } from '$contract/shell-runs';
	import { revealSensitiveCode } from '$hyper-ui/components/code-tokens';
	import { revealSensitiveTarget, sensitiveMasking } from '$hyper-ui/components/sensitive';
	import { tooltip } from '$hyper-ui/components/tooltip';
	import { copyTextCommand } from '$lib/chat/application/commands/copy-text.command';
	import { openExternalUrlCommand } from '$lib/chat/application/commands/open-external-url.command';
	import { chatRequestQuery } from '$lib/chat/application/queries/chat-request.query.svelte';
	import { newChatRequestId, type ChatRequestId } from '$lib/chat/domain/chat-request';
	import { readFileMentionTarget, type FileMentionTarget } from './file-mention-links';
	import { GALLERY_IMAGE_ATTRIBUTE } from './workstream-images';
	import ShellRunCard from './ShellRunCard.svelte';

	interface Props {
		text: string;
		class?: string;
		/**
		 * `markdown` keeps every authored newline, `prose` reflows the paragraph,
		 * `plain` renders verbatim text while safely linkifying only http(s) URLs.
		 */
		mode?: MarkdownRenderMode;
		/** Source characters contributed by the newest streaming delta. */
		streamingTailCharacters?: number;
		/**
		 * Opens a file the text named. A prop rather than a context read: this
		 * component also renders outside the transcript, and a leaf that reaches
		 * for transcript state can only ever be mounted inside one.
		 */
		onopenfile?: ((target: FileMentionTarget, mention: HTMLElement) => void) | undefined;
		canopenfile?: ((path: string) => boolean) | undefined;
		imagesrc?: ((path: string) => string | null) | undefined;
		onopenimage?: ((id: string) => void) | undefined;
		onruncommand?: ((command: string, block: number) => void) | undefined;
		coderuns?: ReadonlyMap<number, ShellRun> | undefined;
	}

	let {
		text,
		class: className = '',
		mode = 'markdown',
		streamingTailCharacters = 0,
		onopenfile,
		canopenfile,
		imagesrc,
		onopenimage,
		onruncommand,
		coderuns,
	}: Props = $props();

	const COPY_SELECTOR = '[data-testid="markdown-code-copy"]';
	const RUN_SELECTOR = '[data-testid="markdown-code-run"]';
	const CODE_BLOCK_ROOT_SELECTOR = '[data-testid="markdown-code-block"]';
	const COPY_ANCHOR_SELECTOR = '[data-code-copy]';
	const RUN_ANCHOR_ATTRIBUTE = 'data-code-run';
	const RUN_OUTPUT_ATTRIBUTE = 'data-code-run-output';
	const ACTION_ANCHOR_SELECTOR = `${COPY_ANCHOR_SELECTOR}, [${RUN_ANCHOR_ATTRIBUTE}]`;
	const RUN_TOOLTIP = { text: 'Run in this workstream', placement: 'top' } as const;
	const COPIED_MS = 1_500;

	type MarkdownTextUpdate = StreamingMarkdownUpdate &
		MarkdownDecorations & { codeRuns: ReadonlyMap<number, ShellRun> | undefined };
	type CodeRunOutput = {
		host: HTMLElement;
		props: { run: ShellRun };
		instance: ReturnType<typeof mount>;
	};
	type CopyRequest = { id: ChatRequestId; button: Element };
	type TooltipHandle = ReturnType<typeof tooltip>;

	let copyRequest = $state<CopyRequest | null>(null);
	const copyOutcome = $derived(chatRequestQuery.data(copyRequest?.id ?? null));
	const actionTooltips = new Map<Element, TooltipHandle>();
	const contexts = getAllContexts();

	$effect(() => {
		const request = copyRequest;
		if (!request || copyOutcome?.status !== 'accepted') return;
		showCopied(request.button, true);
		const reset = setTimeout(() => {
			copyRequest = null;
		}, COPIED_MS);
		return () => {
			clearTimeout(reset);
			showCopied(request.button, false);
		};
	});

	function showCopied(button: Element, copied: boolean): void {
		const markup = codeCopyButtonMarkup();
		button.innerHTML = copied ? markup.copiedIcon : markup.idleIcon;
		button.setAttribute('aria-label', copied ? 'Code copied' : 'Copy code');
		const anchor = button.closest(COPY_ANCHOR_SELECTOR);
		if (anchor) actionTooltips.get(anchor)?.update(copyTooltip(copied));
	}

	function copyTooltip(copied: boolean): { text: string; placement: 'top' } {
		return { text: copied ? 'Copied' : 'Copy code', placement: 'top' };
	}

	function copyCode(target: Element): boolean {
		const button = target.closest(COPY_SELECTOR);
		if (!button) return false;
		const code = button.closest(CODE_BLOCK_ROOT_SELECTOR)?.querySelector('code');
		if (!code) return false;
		const id = newChatRequestId();
		copyRequest = { id, button };
		copyTextCommand({ requestId: id, text: code.textContent ?? '' });
		return true;
	}

	function runCode(target: Element, container: Element): boolean {
		const block = target.closest(RUN_SELECTOR)?.closest(CODE_BLOCK_ROOT_SELECTOR);
		const code = block?.querySelector(CODE_BLOCK_SELECTOR);
		if (!block || !code) return false;
		const index = [...container.querySelectorAll(CODE_BLOCK_ROOT_SELECTOR)].indexOf(block);
		onruncommand?.(code.textContent ?? '', index);
		return true;
	}

	function codeRunOutputs(container: HTMLElement): {
		show: (runs: ReadonlyMap<number, ShellRun> | undefined) => void;
		destroy: () => void;
	} {
		const outputs = new Map<Element, CodeRunOutput>();
		const remove = (block: Element, output: CodeRunOutput): void => {
			void unmount(output.instance);
			output.host.remove();
			outputs.delete(block);
		};
		const show = (runs: ReadonlyMap<number, ShellRun> | undefined): void => {
			if (outputs.size === 0 && !runs?.size) return;
			const blocks = [...container.querySelectorAll(CODE_BLOCK_ROOT_SELECTOR)];
			for (const [block, output] of outputs) {
				const run = runs?.get(blocks.indexOf(block));
				if (run && output.host.parentElement === block) output.props.run = run;
				else remove(block, output);
			}
			runs?.forEach((run, index) => {
				const block = blocks[index];
				if (!block || outputs.has(block)) return;
				const host = document.createElement('div');
				host.setAttribute(RUN_OUTPUT_ATTRIBUTE, '');
				block.append(host);
				const props = $state({ run });
				const instance = mount(ShellRunCard, { target: host, props, context: contexts });
				outputs.set(block, { host, props, instance });
			});
		};
		return {
			show: (runs) => untrack(() => show(runs)),
			destroy: () => {
				for (const [block, output] of outputs) remove(block, output);
			},
		};
	}

	function streamingMarkdown(
		node: HTMLElement,
		initial: MarkdownTextUpdate,
	): { update: (next: MarkdownTextUpdate) => void; destroy: () => void } {
		const renderer = createStreamingMarkdownRenderer({
			container: node,
			copyButton: codeCopyButtonMarkup().button,
			runButton: onruncommand ? codeRunButtonMarkup() : '',
		});
		const outputs = codeRunOutputs(node);
		const render = ({
			canOpenFile,
			imageSource,
			galleryImages,
			codeRuns,
			...update
		}: MarkdownTextUpdate): void => {
			renderer.decorate({ canOpenFile, imageSource, galleryImages });
			renderer.update(update);
			outputs.show(codeRuns);
		};
		render(initial);
		return {
			update: render,
			destroy: () => {
				outputs.destroy();
				renderer.destroy();
			},
		};
	}

	function onLinkClick(event: MouseEvent): void {
		if (revealSensitiveCode(event) || revealSensitiveTarget(event)) return;
		if (!(event.target instanceof Element)) return;
		if (!(event.currentTarget instanceof Element)) return;
		if (copyCode(event.target) || runCode(event.target, event.currentTarget)) return;
		if (openGalleryImage(event.target)) return;
		const anchor = event.target.closest('a');
		if (!(anchor instanceof HTMLAnchorElement)) return;
		event.preventDefault();
		const fileTarget = readFileMentionTarget(anchor);
		if (fileTarget) {
			onopenfile?.(fileTarget, anchor);
			return;
		}
		const url = safeExternalUrl(anchor.getAttribute('href'));
		if (!url) return;
		openExternalUrlCommand(url);
	}

	function onLinkKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		if (revealSensitiveCode(event) || revealSensitiveTarget(event)) return;
		if (!(event.target instanceof Element)) return;
		if (openGalleryImage(event.target)) {
			event.preventDefault();
			return;
		}
		const anchor = event.target.closest('a');
		if (!(anchor instanceof HTMLAnchorElement)) return;
		const fileTarget = readFileMentionTarget(anchor);
		if (!fileTarget) return;
		event.preventDefault();
		onopenfile?.(fileTarget, anchor);
	}

	function openGalleryImage(target: Element): boolean {
		const id = target.getAttribute(GALLERY_IMAGE_ATTRIBUTE);
		if (id === null || !onopenimage) return false;
		onopenimage(id);
		return true;
	}

	function onActionHover(event: PointerEvent): void {
		const anchor = actionAnchorFor(event.target);
		if (!anchor) return;
		anchor.dispatchEvent(new PointerEvent('pointerenter', { pointerType: event.pointerType }));
	}

	function onActionFocus(event: FocusEvent): void {
		if (!(event.target instanceof Element) || !actionAnchorFor(event.target)) return;
		event.target.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
	}

	function actionAnchorFor(target: EventTarget | null): HTMLElement | null {
		if (!(target instanceof Element)) return null;
		const anchor = target.closest(ACTION_ANCHOR_SELECTOR);
		if (!(anchor instanceof HTMLElement) || actionTooltips.has(anchor)) return null;
		const options = anchor.hasAttribute(RUN_ANCHOR_ATTRIBUTE) ? RUN_TOOLTIP : copyTooltip(false);
		actionTooltips.set(anchor, tooltip(anchor, options));
		return anchor;
	}

	function onImageError(event: Event): void {
		const image = event.target;
		if (!(image instanceof HTMLImageElement)) return;
		if (image.hasAttribute(WORKSTREAM_IMAGE_ATTRIBUTE)) image.removeAttribute('src');
	}

	function markdownLinks(node: HTMLElement): { destroy: () => void } {
		node.addEventListener('click', onLinkClick);
		node.addEventListener('keydown', onLinkKeydown);
		node.addEventListener('pointerover', onActionHover);
		node.addEventListener('focusin', onActionFocus);
		node.addEventListener('error', onImageError, true);
		return {
			destroy: () => {
				node.removeEventListener('click', onLinkClick);
				node.removeEventListener('keydown', onLinkKeydown);
				node.removeEventListener('pointerover', onActionHover);
				node.removeEventListener('focusin', onActionFocus);
				node.removeEventListener('error', onImageError, true);
				for (const handle of actionTooltips.values()) handle.destroy();
				actionTooltips.clear();
			},
		};
	}
</script>

<!--
	One root element for both the growing and the settled document. The renderer
	handles `streamingTailCharacters === 0` by committing the final sanitized
	document, so the same node simply stops fading in new text.
-->
<div
	class={['markdown-text', className]}
	data-render-mode={mode}
	data-streaming={streamingTailCharacters > 0 ? 'true' : undefined}
	data-testid="markdown-text"
	use:markdownLinks
	use:streamingMarkdown={{
		text,
		mode,
		streamingTailCharacters,
		masked: sensitiveMasking.on,
		canOpenFile: canopenfile,
		imageSource: imagesrc,
		galleryImages: onopenimage !== undefined,
		codeRuns: coderuns,
	}}
></div>

<style>
	.markdown-text {
		font-size: inherit;
		line-height: inherit;
		color: inherit;
	}

	.markdown-text[data-render-mode='plain'] {
		white-space: inherit;
		overflow-wrap: inherit;
	}

	.markdown-text[data-streaming] :global([data-code-run]),
	.markdown-text :global(:has(> [data-code-run-output] [data-state='running']) [data-code-run]) {
		display: none;
	}

	.markdown-text :global(> *:first-child) {
		margin-top: 0;
	}

	.markdown-text :global(.markdown-stream-token) {
		animation: markdown-tail-fade 220ms cubic-bezier(0.16, 1, 0.3, 1) both;
	}

	@keyframes markdown-tail-fade {
		from {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.markdown-text :global(.markdown-stream-token) {
			animation: none;
		}
	}

	.markdown-text :global(> *:last-child) {
		margin-bottom: 0;
	}

	.markdown-text :global(p) {
		margin: 0.875em 0;
		white-space: pre-wrap;
	}

	.markdown-text[data-render-mode='prose'] :global(p) {
		white-space: normal;
	}

	.markdown-text :global(ul),
	.markdown-text :global(ol) {
		margin: 0.75em 0;
		padding-left: 1.25em;
	}

	.markdown-text :global(ul) {
		list-style: disc;
	}

	.markdown-text :global(ol) {
		list-style: decimal;
		padding-left: 2.5em;
	}

	.markdown-text :global(li) {
		margin: 0.3em 0;
	}

	.markdown-text :global(a) {
		color: var(--color-brand, currentColor);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.markdown-text :global(strong) {
		color: var(--color-fg-agent-message-strong);
		font-weight: 600;
	}

	.markdown-text :global(blockquote) {
		margin: 0.875em 0;
		padding-left: 0.75em;
		border-left: 2px solid var(--color-surface-100-border, currentColor);
		color: var(--color-fg-secondary, currentColor);
	}

	.markdown-text :global(h1),
	.markdown-text :global(h2),
	.markdown-text :global(h3),
	.markdown-text :global(h4),
	.markdown-text :global(h5),
	.markdown-text :global(h6) {
		margin: 1.4em 0 0.5em;
		font-weight: 600;
		line-height: 1.3;
	}

	.markdown-text :global(h1) {
		font-size: 1.35em;
	}

	.markdown-text :global(h2) {
		font-size: 1.2em;
	}

	.markdown-text :global(h3) {
		font-size: 1.05em;
	}

	.markdown-text :global(h4),
	.markdown-text :global(h5),
	.markdown-text :global(h6) {
		font-size: 1em;
	}

	.markdown-text :global(code) {
		font-family: var(--font-mono);
		font-size: 0.85em;
		padding: 0.1em 0.4em;
		border-radius: 0.375em;
		background: var(--color-surface-100);
		color: var(--color-fg-default);
		overflow-wrap: anywhere;
		box-decoration-break: clone;
	}

	.markdown-text :global(a[data-file-path]) {
		color: inherit;
		text-decoration: none;
		cursor: pointer;
	}

	.markdown-text :global(a[data-file-missing]) {
		cursor: auto;
	}

	.markdown-text:not([data-render-mode='plain'])
		:global(a[data-file-path]:not([data-file-missing]):not(:has(> code))) {
		font-family: var(--font-mono);
		font-size: 0.85em;
		padding: 0.1em 0.4em;
		border-radius: 0.375em;
		background: var(--color-surface-100);
		color: var(--color-fg-default);
		overflow-wrap: anywhere;
		box-decoration-break: clone;
	}

	.markdown-text :global(a[data-file-path]:not([data-file-missing]):hover) {
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.markdown-text:not([data-render-mode='plain'])
		:global(a[data-file-path]:not([data-file-missing]):not(:has(> code)):hover),
	.markdown-text :global(a[data-file-path]:not([data-file-missing]):hover > code) {
		background: var(--color-surface-100-hover);
	}

	.markdown-text :global(a[data-file-path]:focus-visible) {
		outline: 2px solid var(--color-brand);
		outline-offset: 1px;
		border-radius: 0.375em;
	}

	@media (prefers-reduced-motion: reduce) {
		.markdown-text :global(a[data-file-path]) {
			transition: none;
		}
	}

	.markdown-text :global(img) {
		width: auto;
		max-width: 100%;
		height: 16rem;
		aspect-ratio: 16 / 10;
		margin: 0.25rem 0.25rem 0.25rem 0;
		vertical-align: top;
		object-fit: scale-down;
		border: 0.5px solid var(--color-border-default);
		border-radius: 0.375em;
		background: var(--color-surface-50);
	}

	.markdown-text :global(img[data-gallery-image]) {
		cursor: zoom-in;
	}

	.markdown-text :global(img[data-gallery-image]:focus-visible) {
		outline: 2px solid var(--color-brand);
		outline-offset: 2px;
	}

	.markdown-text :global(pre:not([data-managed-code-block])) {
		margin: 0.5em 0;
		padding: 0.6em 0.75em;
		overflow-x: auto;
		border: 0.5px solid var(--color-surface-50-border, currentColor);
		border-radius: 0.75rem;
		background: transparent;
	}

	.markdown-text :global(pre[data-managed-code-block]) {
		overflow: visible;
		border-radius: 0;
	}

	.markdown-text :global(pre code) {
		padding: 0;
		border: none;
		border-radius: 0;
		background: none;
		color: inherit;
		font-size: 0.8em;
	}

	.markdown-text :global(hr) {
		margin: 1.75em 0;
		border: none;
		border-top: 1px solid var(--color-surface-50-border, currentColor);
	}

	.markdown-text :global(table) {
		display: block;
		width: 100%;
		max-width: 100%;
		overflow-x: auto;
		border-collapse: collapse;
		margin: 1em 0;
	}

	.markdown-text :global(th),
	.markdown-text :global(td) {
		border: none;
		border-bottom: 0.5px solid var(--color-surface-50-border, currentColor);
		padding: 0.375em 0.75em;
		text-align: left;
		font-variant-numeric: tabular-nums;
	}

	.markdown-text :global(th) {
		border-bottom: 1px solid var(--color-surface-100-border, currentColor);
		font-size: 0.8125em;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--color-fg-tertiary, currentColor);
	}

	.markdown-text :global(tbody tr:last-child td) {
		border-bottom: none;
	}
</style>
