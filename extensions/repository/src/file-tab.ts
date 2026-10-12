import {
	basename,
	extensionPanelInstanceId,
	formatCount,
	highlightCodeLines,
	installExtensionPanelStyles,
	languageForPath,
	resolveLanguage,
	type CodeToken,
	type ExtensionDisposable,
	type ExtensionPanelComponent,
	type ExtensionPanelContext,
	type ExtensionPanelInstance,
} from '@malini/extension-api';
import { diffLineTokens, tokenSpans } from './code-tokens.js';
import type { RepositoryPanelController, RepositoryViewState } from './controller.js';
import type { RepositoryDiff } from './domain.js';
import type { RepositoryPanelHost } from './panel.js';

export const REPOSITORY_FILE_PANEL_TEMPLATE_ID = 'malini.repository.file';

const MAX_RENDERED_LINES = 20_000;

const GUTTER_CHARACTERS = String(MAX_RENDERED_LINES).length;

export type RepositoryFileTabTarget = Readonly<{
	path: string;
	line: number | null;
}>;

export type RepositoryFileTabRow = Readonly<
	{ kind: 'line'; line: number; added: boolean } | { kind: 'removed'; line: number; text: string }
>;

export class RepositoryFileTabs {
	readonly #api: RepositoryPanelHost;
	readonly #controller: RepositoryPanelController;
	readonly #views = new Map<string, RepositoryFileTabView>();
	readonly #pendingLines = new Map<string, number>();
	readonly #registration: ExtensionDisposable;

	constructor(api: RepositoryPanelHost, controller: RepositoryPanelController) {
		this.#api = api;
		this.#controller = controller;
		this.#registration = api.panels.register({
			id: REPOSITORY_FILE_PANEL_TEMPLATE_ID,
			label: 'File',
			icon: 'file',
			component: this.#component(),
		});
	}

	open(target: RepositoryFileTabTarget): void {
		const path = target.path;
		const view = this.#views.get(path);
		if (target.line === null) this.#pendingLines.delete(path);
		else if (view) view.revealLine(target.line);
		else this.#pendingLines.set(path, target.line);

		this.#api.panels.open(extensionPanelInstanceId(REPOSITORY_FILE_PANEL_TEMPLATE_ID, path), {
			label: basename(path),
			icon: `path:${path}`,
			tooltip: path,
		});
	}

	async dispose(): Promise<void> {
		this.#views.clear();
		this.#pendingLines.clear();
		await this.#registration.dispose();
	}

	#component(): ExtensionPanelComponent {
		return {
			workstreamScope: 'context',
			mount: async (target, context): Promise<ExtensionPanelInstance> => {
				const path = context.instanceKey;
				if (!path) throw new Error('A file tab needs the path of the file it shows');

				const root = document.createElement('section');
				root.dataset.maliniExtension = this.#api.manifest.id;
				root.dataset.repositoryFileTab = path;
				root.className = 'repository-file-tab malini-panel-column';
				root.setAttribute('aria-label', `Contents of ${path}`);
				target.append(root);

				const styles = installExtensionPanelStyles(
					REPOSITORY_FILE_PANEL_TEMPLATE_ID,
					REPOSITORY_FILE_TAB_STYLES,
				);
				const view = new RepositoryFileTabView(this.#api, this.#controller, path, root);
				this.#views.set(path, view);
				const pendingLine = this.#pendingLines.get(path);
				if (pendingLine !== undefined) {
					this.#pendingLines.delete(path);
					view.revealLine(pendingLine);
				}
				await view.load(context);
				if (this.#views.get(path) === view) this.#controller.showFile(path);
				const following = this.#controller.subscribe((state) => view.follow(state));

				return {
					update: (next) => view.load(next),
					dispose: async () => {
						following.dispose();
						if (this.#views.get(path) === view) {
							this.#views.delete(path);
							this.#controller.hideFile(path);
						}
						await styles.dispose();
						root.remove();
					},
				};
			},
		};
	}
}

const fileTabsByController = new WeakMap<RepositoryPanelController, RepositoryFileTabs>();

export function repositoryFileTabs(
	api: RepositoryPanelHost,
	controller: RepositoryPanelController,
): RepositoryFileTabs {
	const existing = fileTabsByController.get(controller);
	if (existing) return existing;
	const created = new RepositoryFileTabs(api, controller);
	fileTabsByController.set(controller, created);
	return created;
}

class RepositoryFileTabView {
	readonly #api: RepositoryPanelHost;
	readonly #controller: RepositoryPanelController;
	readonly #path: string;
	readonly #lineChange: HTMLElement;
	readonly #body: HTMLElement;
	#workstreamId: string | null = null;
	#loadedWorkstreamId: string | null = null;
	#treeDiffKey: string | null = null;
	#reads = 0;
	#lines: HTMLOListElement | null = null;
	#requestedLine: number | null = null;

	constructor(
		api: RepositoryPanelHost,
		controller: RepositoryPanelController,
		path: string,
		root: HTMLElement,
	) {
		this.#api = api;
		this.#controller = controller;
		this.#path = path;
		this.#lineChange = document.createElement('span');
		this.#lineChange.className = 'repository-file-tab__stat';
		this.#body = document.createElement('div');
		this.#body.className = 'repository-file-tab__body malini-panel-column';
		const header = document.createElement('div');
		header.className = 'repository-file-tab__header';
		header.append(filePathHeader(path), this.#lineChange);
		root.append(header, this.#body);
	}

	async load(context: ExtensionPanelContext): Promise<void> {
		const workstreamId = context.workstream?.id ?? null;
		if (workstreamId !== null && workstreamId === this.#loadedWorkstreamId) return;
		this.#workstreamId = workstreamId;
		this.#loadedWorkstreamId = workstreamId;
		this.#treeDiffKey = treeDiffKey(this.#controller.snapshot(), this.#path, workstreamId);
		this.#renderStatus('Loading…');
		await this.#read();
	}

	follow(state: RepositoryViewState): void {
		const key = treeDiffKey(state, this.#path, this.#workstreamId);
		if (key === null || key === this.#treeDiffKey) return;
		this.#treeDiffKey = key;
		void this.#read();
	}

	revealLine(line: number): void {
		this.#requestedLine = line;
		this.#markLine(line)?.scrollIntoView({ block: 'center' });
	}

	async #read(): Promise<void> {
		const read = ++this.#reads;
		const workstreamId = this.#workstreamId ?? undefined;
		try {
			const [contents, diff] = await Promise.all([
				this.#api.workstream.readFile(this.#path, workstreamId),
				this.#controller.readUncommittedDiff(this.#path, workstreamId).catch(() => null),
			]);
			if (read === this.#reads) this.#renderContents(contents, diff);
		} catch (error) {
			if (read !== this.#reads) return;
			this.#loadedWorkstreamId = null;
			this.#renderStatus(error instanceof Error ? error.message : 'This file is not readable.');
		}
	}

	#markLine(line: number): HTMLElement | null {
		const lines = this.#lines;
		if (!lines) return null;
		for (const marked of lines.querySelectorAll('[data-current-line="true"]')) {
			marked.removeAttribute('data-current-line');
		}
		const row = lines.querySelector<HTMLElement>(`[data-line="${line}"]`);
		if (row) row.dataset.currentLine = 'true';
		return row;
	}

	#renderStatus(message: string): void {
		this.#lines = null;
		const status = document.createElement('p');
		status.className = 'malini-panel-empty malini-panel-empty-heading';
		status.textContent = message;
		this.#body.replaceChildren(status);
	}

	#renderLineChange(diff: RepositoryDiff | null): void {
		const additions = diff?.additions ?? 0;
		const deletions = diff?.deletions ?? 0;
		const counts: HTMLElement[] = [];
		if (additions > 0) counts.push(toneCount('addition', `+${formatCount(additions)}`));
		if (deletions > 0) counts.push(toneCount('deletion', `−${formatCount(deletions)}`));
		this.#lineChange.replaceChildren(...counts);
		if (counts.length === 0) {
			this.#lineChange.removeAttribute('aria-label');
			this.#lineChange.removeAttribute('title');
			return;
		}
		const summary = `${countLabel(additions, 'line added', 'lines added')}, ${countLabel(deletions, 'line removed', 'lines removed')} since the last commit`;
		this.#lineChange.setAttribute('aria-label', summary);
		this.#lineChange.title = summary;
	}

	#renderContents(contents: string, diff: RepositoryDiff | null): void {
		this.#renderLineChange(diff);
		if (contents.length === 0) {
			this.#renderStatus('This file is empty.');
			return;
		}

		const lineCount = contents.split('\n').length;
		const truncated = lineCount > MAX_RENDERED_LINES;
		const shown = truncated ? contents.split('\n', MAX_RENDERED_LINES).join('\n') : contents;
		const language = resolveLanguage(languageForPath(this.#path), shown);
		const source = highlightCodeLines(shown, language);
		const removed = removedLineTokens(diff, language);
		const rows = repositoryFileTabRows(lineCount, diff);

		const lines = document.createElement('ol');
		lines.className = 'repository-file-tab__lines styled-scrollbar';
		lines.tabIndex = 0;

		for (const row of rows) {
			if (row.kind === 'line' && row.line > MAX_RENDERED_LINES) break;
			lines.append(
				this.#renderRow(row, row.kind === 'line' ? source[row.line - 1] : removed.get(row.line)),
			);
		}
		const previous = this.#lines;
		this.#lines = lines;

		const frame: HTMLElement[] = [lines];
		if (truncated) {
			const notice = document.createElement('p');
			notice.className = 'repository-file-tab__notice malini-panel-meta';
			notice.textContent = `Showing the first ${MAX_RENDERED_LINES.toLocaleString()} of ${lineCount.toLocaleString()} lines.`;
			frame.push(notice);
		}
		const scroll = previous ? { top: previous.scrollTop, left: previous.scrollLeft } : null;
		this.#body.replaceChildren(...frame);
		if (scroll) {
			lines.scrollTop = scroll.top;
			lines.scrollLeft = scroll.left;
			if (this.#requestedLine !== null) this.#markLine(this.#requestedLine);
		} else if (this.#requestedLine !== null) {
			this.revealLine(this.#requestedLine);
		}
	}

	#renderRow(row: RepositoryFileTabRow, tokens: readonly CodeToken[] | undefined): HTMLLIElement {
		const item = document.createElement('li');
		item.className = 'repository-file-tab__line';

		const gutter = document.createElement('span');
		gutter.className = 'repository-file-tab__gutter';
		gutter.setAttribute('aria-hidden', 'true');
		gutter.textContent = String(row.line);
		item.append(gutter);

		const code = document.createElement('code');
		code.className = 'repository-file-tab__code code-tokens';
		if (row.kind === 'removed') {
			item.dataset.change = 'deletion';
			item.append(changeLabel('Removed'));
		} else {
			item.dataset.line = String(row.line);
			if (row.added) {
				item.dataset.change = 'addition';
				item.append(changeLabel('Added'));
			}
		}
		fillCode(code, tokens ?? (row.kind === 'removed' ? [{ kind: 'plain', text: row.text }] : []));
		item.append(code);
		return item;
	}
}

export function repositoryFileTabRows(
	lineCount: number,
	diff: Pick<RepositoryDiff, 'lines'> | null,
): readonly RepositoryFileTabRow[] {
	const added = new Set<number>();
	const removedBefore = new Map<number, Extract<RepositoryFileTabRow, { kind: 'removed' }>[]>();
	let shift = 0;
	for (const line of diff?.lines ?? []) {
		if (line.kind === 'addition' && line.newLine !== null) {
			added.add(line.newLine);
			shift += 1;
		} else if (line.kind === 'deletion' && line.oldLine !== null) {
			const before = Math.min(line.oldLine + shift, lineCount + 1);
			const removed = { kind: 'removed', line: line.oldLine, text: line.text } as const;
			removedBefore.set(before, [...(removedBefore.get(before) ?? []), removed]);
			shift -= 1;
		}
	}
	const rows: RepositoryFileTabRow[] = [];
	for (let line = 1; line <= lineCount + 1; line += 1) {
		rows.push(...(removedBefore.get(line) ?? []));
		if (line <= lineCount) rows.push({ kind: 'line', line, added: added.has(line) });
	}
	return rows;
}

function treeDiffKey(
	state: RepositoryViewState,
	path: string,
	workstreamId: string | null,
): string | null {
	if (workstreamId !== null && state.context?.workstreamId !== workstreamId) return null;
	const diff = state.uncommitted.diffs.find((entry) => entry.path === path);
	return JSON.stringify(diff?.lines ?? []);
}

function removedLineTokens(
	diff: Pick<RepositoryDiff, 'lines'> | null,
	language: string,
): ReadonlyMap<number, readonly CodeToken[]> {
	const lines = diff?.lines ?? [];
	const tokens = diffLineTokens(lines, language);
	const removed = new Map<number, readonly CodeToken[]>();
	for (const [index, line] of lines.entries()) {
		if (line.kind === 'deletion' && line.oldLine !== null)
			removed.set(line.oldLine, tokens[index] ?? []);
	}
	return removed;
}

function fillCode(code: HTMLElement, tokens: readonly CodeToken[]): void {
	if (tokens.length === 0) code.textContent = ' ';
	else code.append(...tokenSpans(tokens));
}

function changeLabel(text: string): HTMLElement {
	const label = document.createElement('span');
	label.className = 'repository-file-tab__change-label';
	label.textContent = `${text}: `;
	return label;
}

function toneCount(tone: 'addition' | 'deletion', text: string): HTMLElement {
	const count = document.createElement('span');
	count.dataset.tone = tone;
	count.textContent = text;
	return count;
}

function countLabel(count: number, one: string, many: string): string {
	return `${formatCount(count)} ${count === 1 ? one : many}`;
}

function filePathHeader(path: string): HTMLElement {
	const header = document.createElement('nav');
	header.className = 'repository-file-tab__path';
	header.setAttribute('aria-label', 'File path');
	const segments = document.createElement('ol');
	const names = path.split('/');
	for (const [index, name] of names.entries()) {
		const segment = document.createElement('li');
		segment.textContent = name;
		if (index === names.length - 1) segment.setAttribute('aria-current', 'page');
		segments.append(segment);
	}
	header.append(segments);
	return header;
}

const REPOSITORY_FILE_TAB_STYLES = `
[data-malini-extension] .repository-file-tab {
	overflow: hidden;
	background: var(--color-surface-50);
}

[data-malini-extension] .repository-file-tab__header {
	display: flex;
	flex: none;
	align-items: center;
	gap: 0.75rem;
	border-bottom: 1px solid var(--color-border-subtle);
	padding: 0.5rem 1rem;
}

[data-malini-extension] .repository-file-tab__path {
	min-width: 0;
	flex: 1;
}

[data-malini-extension] .repository-file-tab__stat {
	display: flex;
	flex: none;
	gap: 0.375rem;
	font-family: var(--font-mono);
	font-size: var(--text-2xs);
	font-variant-numeric: tabular-nums;
	line-height: 1rem;
}

[data-malini-extension] .repository-file-tab__stat [data-tone='addition'] {
	color: var(--color-success-content);
}

[data-malini-extension] .repository-file-tab__stat [data-tone='deletion'] {
	color: var(--color-error-content);
}

[data-malini-extension] .repository-file-tab__path ol {
	display: flex;
	min-width: 0;
	align-items: center;
	gap: 0.375rem;
	overflow: hidden;
	margin: 0;
	padding: 0;
	list-style: none;
	color: var(--color-fg-tertiary);
	font-size: var(--text-2xs);
	line-height: 1rem;
	white-space: nowrap;
}

[data-malini-extension] .repository-file-tab__path li {
	display: flex;
	flex: none;
	align-items: center;
	gap: 0.375rem;
}

[data-malini-extension] .repository-file-tab__path li + li::before {
	content: '/';
	color: var(--color-fg-tertiary);
}

[data-malini-extension] .repository-file-tab__path li[aria-current='page'] {
	min-width: 0;
	flex: 0 1 auto;
	overflow: hidden;
	color: var(--color-fg-secondary);
	text-overflow: ellipsis;
}

[data-malini-extension] .repository-file-tab__body {
	min-height: 0;
	flex: 1;
}

[data-malini-extension] .repository-file-tab__lines {
	display: flex;
	min-height: 0;
	flex: 1;
	flex-direction: column;
	overflow: auto;
	margin: 0;
	padding: 0.5rem 0;
	list-style: none;
	font-family: var(--font-mono);
	font-size: var(--text-xs);
	line-height: 1.6;
	tab-size: 2;
}

[data-malini-extension] .repository-file-tab__line {
	position: relative;
	display: flex;
	min-width: max-content;
	width: 100%;
	align-items: flex-start;
	gap: 0.75rem;
	padding-right: 1rem;
}

[data-malini-extension] .repository-file-tab__line[data-change] {
	background: var(--file-tab-change-background);
}

[data-malini-extension] .repository-file-tab__line[data-change='addition'] {
	--file-tab-change-background: color-mix(in srgb, var(--code-added) 10%, var(--color-surface-50));
	--file-tab-change-number: var(--color-success-content);
	--file-tab-change-stripe: var(--code-added);
}

[data-malini-extension] .repository-file-tab__line[data-change='deletion'] {
	--file-tab-change-background: color-mix(in srgb, var(--code-removed) 10%, var(--color-surface-50));
	--file-tab-change-number: var(--color-error-content);
	--file-tab-change-stripe: repeating-linear-gradient(
		to bottom,
		var(--code-removed) 0 1px,
		transparent 1px 2px
	) fixed;
	user-select: none;
}

[data-malini-extension] .repository-file-tab__change-label {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	clip-path: inset(50%);
	white-space: nowrap;
	user-select: none;
}

[data-malini-extension] .repository-file-tab__line[data-current-line='true'] {
	background: var(--color-surface-100);
}

[data-malini-extension] .repository-file-tab__gutter {
	position: sticky;
	left: 0;
	flex: none;
	width: calc(${String(GUTTER_CHARACTERS)}ch + 1.5rem);
	padding-right: 0.5rem;
	background: var(--file-tab-change-background, var(--color-surface-50));
	color: var(--color-fg-tertiary);
	text-align: right;
	font-variant-numeric: tabular-nums;
	user-select: none;
}

[data-malini-extension] .repository-file-tab__line[data-change] .repository-file-tab__gutter {
	color: var(--file-tab-change-number);
}

[data-malini-extension] .repository-file-tab__line[data-change] .repository-file-tab__gutter::before {
	position: absolute;
	inset-block: 0;
	left: 0;
	width: 0.25rem;
	background: var(--file-tab-change-stripe);
	content: '';
}

[data-malini-extension] .repository-file-tab__code {
	flex: 1;
	white-space: pre;
	font: inherit;
	color: var(--code-plain);
}

[data-malini-extension] .repository-file-tab__notice {
	flex: none;
	border-top: 1px solid var(--color-border-subtle);
	padding: 0.5rem 1rem;
}

`;
