<script module lang="ts">
	import DOMPurify from 'dompurify';
	import { marked } from 'marked';
	import { maskSensitiveHtml, revealSensitiveTarget } from '$hyper-ui/components/sensitive';
	import { linkifyFileMentions } from './file-mention-links';
	import { holdWorkstreamImages } from './workstream-images';
	import {
		sanitizedMarkdownHtmlCache,
		sanitizedMarkdownHtmlCacheKey,
	} from './sanitized-markdown-html-cache';

	export type MarkdownRenderMode = 'markdown' | 'prose' | 'plain';

	export type ManagedCodeBlockProps = { code: string; safeHtml: string };

	export type ManagedCodeBlock = {
		update?(props: ManagedCodeBlockProps): void;
		destroy(): void;
	};

	export type ManagedCodeBlockMounter = (
		target: HTMLElement,
		props: ManagedCodeBlockProps,
	) => ManagedCodeBlock;

	export type StreamingMarkdownUpdate = {
		text: string;
		mode: MarkdownRenderMode;
		streamingTailCharacters: number;
	};

	export type StreamingMarkdownRenderer = {
		update(update: StreamingMarkdownUpdate): void;
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
	const MAX_ANIMATED_TAIL_CHARACTERS = 160;
	const MAX_STAGGER_INDEX = 6;

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

	export function renderSanitizedHtml(source: string, renderMode: MarkdownRenderMode): string {
		const rawHtml =
			renderMode === 'plain'
				? linkifyPlainText(source)
				: marked.parse(source, { async: false, breaks: renderMode !== 'prose', gfm: true });
		return DOMPurify.sanitize(rawHtml);
	}

	function decorateStreamingTail(sanitized: string, sourceCharacterCount: number): string {
		if (typeof document === 'undefined') return sanitized;

		const template = document.createElement('template');
		template.innerHTML = sanitized;
		const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
		const textNodes: Text[] = [];
		let totalVisibleCharacters = 0;
		while (walker.nextNode()) {
			const node = walker.currentNode;
			if (!(node instanceof Text) || node.data.length === 0) continue;
			textNodes.push(node);
			totalVisibleCharacters += node.data.length;
		}

		if (textNodes.length === 0) return sanitized;
		const animatedCharacterCount = Math.min(
			MAX_ANIMATED_TAIL_CHARACTERS,
			Math.max(1, sourceCharacterCount),
			totalVisibleCharacters,
		);
		const animatedStart = totalVisibleCharacters - animatedCharacterCount;
		let visibleCursor = 0;
		let tokenIndex = 0;

		for (const node of textNodes) {
			const nodeEnd = visibleCursor + node.data.length;
			if (nodeEnd <= animatedStart) {
				visibleCursor = nodeEnd;
				continue;
			}

			const localStart = Math.max(0, animatedStart - visibleCursor);
			const stablePrefix = node.data.slice(0, localStart);
			const animatedSuffix = node.data.slice(localStart);
			const fragment = document.createDocumentFragment();
			if (stablePrefix) fragment.append(document.createTextNode(stablePrefix));

			for (const part of animatedSuffix.split(/(\s+)/u)) {
				if (!part) continue;
				if (/^\s+$/u.test(part)) {
					fragment.append(document.createTextNode(part));
					continue;
				}
				const token = document.createElement('span');
				token.className = 'markdown-stream-token';
				token.dataset.testid = 'streaming-tail-token';
				token.style.setProperty('--stream-order', String(Math.min(tokenIndex, MAX_STAGGER_INDEX)));
				token.textContent = part;
				fragment.append(token);
				tokenIndex += 1;
			}

			node.replaceWith(fragment);
			visibleCursor = nodeEnd;
		}

		return template.innerHTML;
	}

	/**
	 * Settled markdown is parsed once per distinct block and shared through the
	 * process-wide sanitized cache. Growing tails are deliberately never read
	 * from or written to it: their decoration is per-tick and would evict real
	 * settled entries for HTML that is thrown away on the next reveal.
	 *
	 * The mode belongs in the cache key: identical source parses to different
	 * HTML per mode, so a shared key would serve a user prompt the assistant's
	 * reflowed document, or the reverse.
	 *
	 * File mentions are rewritten here rather than at either call site, so a
	 * block that settles mid-answer carries exactly the links it carried while it
	 * was the growing tail. The rewrite is a pure function of the sanitized HTML,
	 * which is the only reason its output is safe to cache under `(mode, source)`.
	 */
	function segmentHtml(
		chunkSource: string,
		mode: MarkdownRenderMode,
		tailCharacters: number,
	): string {
		if (tailCharacters > 0) {
			return decorateStreamingTail(
				maskSensitiveHtml(
					linkifyFileMentions(holdWorkstreamImages(renderSanitizedHtml(chunkSource, mode))),
				),
				tailCharacters,
			);
		}

		const cacheKey = sanitizedMarkdownHtmlCacheKey(mode, chunkSource);
		const cached = sanitizedMarkdownHtmlCache.get(cacheKey);
		if (cached !== undefined) return cached;

		const sanitized = maskSensitiveHtml(
			linkifyFileMentions(holdWorkstreamImages(renderSanitizedHtml(chunkSource, mode))),
		);
		sanitizedMarkdownHtmlCache.set(cacheKey, sanitized);
		return sanitized;
	}

	const CODE_BLOCK_TARGET_ATTRIBUTE = 'data-streaming-code-block-target';
	const STREAM_TOKEN_CLASS = 'markdown-stream-token';

	type PendingCodeBlock = ManagedCodeBlockProps & { target: HTMLElement };

	type MountedCodeBlock = { block: ManagedCodeBlock; host: HTMLElement; code: string };

	type RenderedSegment = {
		source: string;
		nodes: ChildNode[];
		blocks: MountedCodeBlock[];
		decorated: boolean;
	};

	/**
	 * Strips the reveal spans from a block that has stopped being the growing
	 * tail. Without this every word of a long answer keeps a `will-change:
	 * opacity` span forever — thousands of permanently promoted elements for an
	 * animation that ran once, hundreds of lines ago.
	 */
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
			for (const token of [...node.querySelectorAll(`.${STREAM_TOKEN_CLASS}`)]) {
				token.replaceWith(...token.childNodes);
			}
			nodes.push(node);
		}
		segment.nodes = nodes;
	}

	function buildSegmentContent(html: string): {
		fragment: DocumentFragment;
		pending: PendingCodeBlock[];
	} {
		const template = document.createElement('template');
		template.innerHTML = html;
		const pending: PendingCodeBlock[] = [];
		for (const codeElement of template.content.querySelectorAll('pre > code')) {
			const pre = codeElement.parentElement;
			if (!(pre instanceof HTMLPreElement)) continue;
			const target = document.createElement('div');
			target.setAttribute(CODE_BLOCK_TARGET_ATTRIBUTE, '');
			pre.replaceWith(target);
			pending.push({
				target,
				code: codeElement.textContent ?? '',
				safeHtml: codeElement.innerHTML,
			});
		}
		return { fragment: template.content, pending };
	}

	type PatchContext = { hosts: readonly HTMLElement[]; aborted: boolean };

	function syncAttributes(existing: Element, incoming: Element): void {
		for (const attribute of [...existing.attributes]) {
			if (!incoming.hasAttribute(attribute.name)) existing.removeAttribute(attribute.name);
		}
		for (const attribute of incoming.attributes) {
			if (existing.getAttribute(attribute.name) !== attribute.value) {
				existing.setAttribute(attribute.name, attribute.value);
			}
		}
	}

	function patchNode(existing: ChildNode, incoming: ChildNode, context: PatchContext): boolean {
		if (context.hosts.includes(existing as HTMLElement)) {
			return incoming instanceof Element && incoming.hasAttribute(CODE_BLOCK_TARGET_ATTRIBUTE);
		}
		if (existing.nodeType !== incoming.nodeType) return false;
		if (existing.nodeType === Node.TEXT_NODE || existing.nodeType === Node.COMMENT_NODE) {
			if (existing.nodeValue !== incoming.nodeValue) existing.nodeValue = incoming.nodeValue;
			return true;
		}
		if (!(existing instanceof Element) || !(incoming instanceof Element)) return false;
		if (existing.tagName !== incoming.tagName) return false;
		if (existing.namespaceURI !== incoming.namespaceURI) return false;
		if (incoming.hasAttribute(CODE_BLOCK_TARGET_ATTRIBUTE)) return false;

		syncAttributes(existing, incoming);
		reconcileChildren(existing, [...existing.childNodes], [...incoming.childNodes], context);
		return true;
	}

	/**
	 * Reconciles one contiguous run of siblings in place. Nodes that survive keep
	 * their identity — which is the whole point: a CSS keyframe restarts whenever
	 * its element is recreated, so rebuilding the growing block every reveal tick
	 * is what makes settled text visibly blink.
	 */
	function reconcileChildren(
		parent: Node,
		existingNodes: readonly ChildNode[],
		incomingNodes: readonly ChildNode[],
		context: PatchContext,
	): ChildNode[] {
		const result: ChildNode[] = [];
		const shared = Math.min(existingNodes.length, incomingNodes.length);
		for (let index = 0; index < shared; index += 1) {
			if (context.aborted) return result;
			const existing = existingNodes[index];
			const incoming = incomingNodes[index];
			if (existing === undefined || incoming === undefined) break;
			if (patchNode(existing, incoming, context)) {
				result.push(existing);
				continue;
			}
			if (context.hosts.some((host) => existing.contains(host))) {
				context.aborted = true;
				return result;
			}
			parent.replaceChild(incoming, existing);
			result.push(incoming);
		}
		if (context.aborted) return result;
		for (let index = shared; index < existingNodes.length; index += 1) {
			const stale = existingNodes[index];
			if (stale === undefined) continue;
			if (context.hosts.some((host) => stale === host || stale.contains(host))) {
				context.aborted = true;
				return result;
			}
			stale.remove();
		}
		for (let index = shared; index < incomingNodes.length; index += 1) {
			const incoming = incomingNodes[index];
			if (incoming === undefined) continue;
			parent.appendChild(incoming);
			result.push(incoming);
		}
		return result;
	}

	/**
	 * Renders a growing markdown source block by block. Settled blocks are never
	 * reparsed or touched again, so their code-block components keep identity and
	 * state, and per-delta cost follows the block being written, not the message.
	 * The one block that is still growing is patched in place rather than rebuilt.
	 */
	export function createStreamingMarkdownRenderer(options: {
		container: HTMLElement;
		mountCodeBlock: ManagedCodeBlockMounter;
	}): StreamingMarkdownRenderer {
		const segments: RenderedSegment[] = [];

		function dropSegmentsFrom(index: number): void {
			for (const segment of segments.splice(index)) {
				for (const mounted of segment.blocks) mounted.block.destroy();
				for (const node of segment.nodes) node.remove();
			}
		}

		function renderSegment(
			chunkSource: string,
			mode: MarkdownRenderMode,
			tailCharacters: number,
		): RenderedSegment {
			const { fragment, pending } = buildSegmentContent(
				segmentHtml(chunkSource, mode, tailCharacters),
			);
			const nodes = [...fragment.childNodes];
			options.container.append(fragment);
			return {
				source: chunkSource,
				nodes,
				decorated: tailCharacters > 0,
				blocks: pending.map(({ target, code, safeHtml }) => ({
					block: options.mountCodeBlock(target, { code, safeHtml }),
					host: target,
					code,
				})),
			};
		}

		/**
		 * Patches the one still-growing trailing block in place. Returns false when
		 * the incoming tree cannot be reconciled onto the live one, in which case
		 * the caller falls back to a full rebuild of that block. A partially applied
		 * patch stays safe because the segment's node list is re-read from the live
		 * container on every exit, so the fallback still removes exactly what it
		 * rendered.
		 */
		function patchTailSegment(
			segment: RenderedSegment,
			precedingNodeCount: number,
			chunkSource: string,
			mode: MarkdownRenderMode,
			tailCharacters: number,
		): boolean {
			const { fragment, pending } = buildSegmentContent(
				segmentHtml(chunkSource, mode, tailCharacters),
			);
			if (pending.length !== segment.blocks.length) return false;
			for (let index = 0; index < pending.length; index += 1) {
				const mounted = segment.blocks[index];
				const incoming = pending[index];
				if (mounted === undefined || incoming === undefined) return false;
				if (typeof mounted.block.update !== 'function') return false;
				if (!incoming.code.trimEnd().startsWith(mounted.code.trimEnd())) return false;
			}

			const context: PatchContext = {
				hosts: segment.blocks.map((mounted) => mounted.host),
				aborted: false,
			};
			reconcileChildren(options.container, segment.nodes, [...fragment.childNodes], context);
			segment.nodes = [...options.container.childNodes].slice(precedingNodeCount);
			if (context.aborted) return false;
			if (pending.some((entry) => options.container.contains(entry.target))) return false;
			if (segment.blocks.some((mounted) => !options.container.contains(mounted.host))) {
				return false;
			}

			for (let index = 0; index < pending.length; index += 1) {
				const mounted = segment.blocks[index];
				const incoming = pending[index];
				if (mounted === undefined || incoming === undefined) continue;
				const { code, safeHtml } = incoming;
				if (code === mounted.code) continue;
				mounted.block.update?.({ code, safeHtml });
				mounted.code = code;
			}
			segment.source = chunkSource;
			segment.decorated = tailCharacters > 0;
			return true;
		}

		return {
			update({ text, mode, streamingTailCharacters }) {
				const source = mode === 'plain' ? text : closeUnclosedFence(text);
				const chunks = splitMarkdownChunks(source);
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

				if (settled === chunks.length - 1 && settled === segments.length - 1) {
					let precedingNodeCount = 0;
					for (let index = 0; index < settled; index += 1) {
						precedingNodeCount += segments[index]?.nodes.length ?? 0;
					}
					const tailSegment = segments[settled];
					const tailChunk = chunks[settled];
					if (
						tailSegment !== undefined &&
						tailChunk !== undefined &&
						patchTailSegment(
							tailSegment,
							precedingNodeCount,
							tailChunk,
							mode,
							streamingTailCharacters,
						)
					) {
						return;
					}
				}

				dropSegmentsFrom(settled);
				for (let index = settled; index < chunks.length; index += 1) {
					const isTail = index === chunks.length - 1;
					segments.push(
						renderSegment(chunks[index] ?? '', mode, isTail ? streamingTailCharacters : 0),
					);
				}
			},
			destroy: () => dropSegmentsFrom(0),
		};
	}
</script>

<script lang="ts">
	import { mount, unmount } from 'svelte';
	import { openExternalUrlCommand } from '$lib/chat/application/commands/open-external-url.command';
	import {
		markOpenableFileMentions,
		readFileMentionTarget,
		type FileMentionTarget,
	} from './file-mention-links';
	import MarkdownCodeBlock from './MarkdownCodeBlock.svelte';
	import {
		GALLERY_IMAGE_ATTRIBUTE,
		offerGalleryImages,
		showWorkstreamImages,
	} from './workstream-images';

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
	}: Props = $props();

	type MarkdownTextUpdate = StreamingMarkdownUpdate & {
		canOpenFile: ((path: string) => boolean) | undefined;
		imageSource: ((path: string) => string | null) | undefined;
		galleryImages: boolean;
	};

	function mountManagedCodeBlock(
		target: HTMLElement,
		props: ManagedCodeBlockProps,
	): ManagedCodeBlock {
		const live = $state({ code: props.code, safeHtml: props.safeHtml });
		let instance: ReturnType<typeof mount> | null = null;
		let cancelled = false;
		queueMicrotask(() => {
			if (cancelled) return;
			instance = mount(MarkdownCodeBlock, { target, props: live });
		});
		return {
			update: (next) => {
				live.code = next.code;
				live.safeHtml = next.safeHtml;
			},
			destroy: () => {
				cancelled = true;
				if (instance) void unmount(instance);
				instance = null;
			},
		};
	}

	function streamingMarkdown(
		node: HTMLElement,
		initial: MarkdownTextUpdate,
	): { update: (next: MarkdownTextUpdate) => void; destroy: () => void } {
		const renderer = createStreamingMarkdownRenderer({
			container: node,
			mountCodeBlock: mountManagedCodeBlock,
		});
		const render = ({
			canOpenFile,
			imageSource,
			galleryImages,
			...update
		}: MarkdownTextUpdate): void => {
			renderer.update(update);
			markOpenableFileMentions(node, canOpenFile);
			showWorkstreamImages(node, imageSource);
			if (galleryImages) offerGalleryImages(node);
		};
		render(initial);
		return {
			update: render,
			destroy: () => renderer.destroy(),
		};
	}

	function onLinkClick(event: MouseEvent): void {
		if (revealSensitiveTarget(event)) return;
		if (!(event.target instanceof Element)) return;
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

	/**
	 * Enter and Space on a file mention. A real `<a href>` is activated by the
	 * browser itself and arrives as a click, so only the href-less mentions need
	 * their own key handling.
	 */
	function onLinkKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		if (revealSensitiveTarget(event)) return;
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

	function markdownLinks(node: HTMLElement): { destroy: () => void } {
		node.addEventListener('click', onLinkClick);
		node.addEventListener('keydown', onLinkKeydown);
		return {
			destroy: () => {
				node.removeEventListener('click', onLinkClick);
				node.removeEventListener('keydown', onLinkKeydown);
			},
		};
	}
</script>

<!--
	One root element for both the growing and the settled document. Splitting them
	across an {#if}/{:else} pair made Svelte destroy one <div> and build the other
	at the exact moment a message finished, remounting every code block and
	replaying the whole intro animation across an already-read answer. The renderer
	handles `streamingTailCharacters === 0` by committing the final sanitized
	document, so the same node simply stops animating.
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
		canOpenFile: canopenfile,
		imageSource: imagesrc,
		galleryImages: onopenimage !== undefined,
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

	.markdown-text :global(> *:first-child) {
		margin-top: 0;
	}

	.markdown-text :global(.markdown-stream-token) {
		display: inline-block;
		animation: markdown-token-reveal 190ms cubic-bezier(0.16, 1, 0.3, 1) both;
		animation-delay: calc(var(--stream-order, 0) * 4ms);
		will-change: opacity, transform;
	}

	@keyframes markdown-token-reveal {
		from {
			opacity: 0;
			transform: translateY(0.32em);
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

	.markdown-text :global(img[data-gallery-image]) {
		cursor: zoom-in;
		border-radius: 0.375em;
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
