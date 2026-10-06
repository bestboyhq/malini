import {
	basename,
	extensionPanelInstanceId,
	installExtensionPanelStyles,
	type CodeToken,
	type ExtensionDisposable,
	type ExtensionPanelComponent,
	type ExtensionPanelContext,
	type ExtensionPanelInstance,
} from '@malini/extension-api';
import { highlightFileLines, tokenSpans } from './code-tokens.js';
import type { RepositoryPanelController } from './controller.js';
import type { RepositoryPanelHost } from './panel.js';

export const REPOSITORY_FILE_PANEL_TEMPLATE_ID = 'malini.repository.file';

const MAX_HIGHLIGHT_CHARACTERS = 400_000;

const MAX_RENDERED_LINES = 20_000;

const GUTTER_CHARACTERS = String(MAX_RENDERED_LINES).length;

export type RepositoryFileTabTarget = Readonly<{
	path: string;
	line: number | null;
}>;

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
				const view = new RepositoryFileTabView(this.#api, path, root);
				this.#views.set(path, view);
				const pendingLine = this.#pendingLines.get(path);
				if (pendingLine !== undefined) {
					this.#pendingLines.delete(path);
					view.revealLine(pendingLine);
				}
				await view.load(context);
				if (this.#views.get(path) === view) this.#controller.showFile(path);

				return {
					update: (next) => view.load(next),
					dispose: async () => {
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
	readonly #path: string;
	readonly #body: HTMLElement;
	#loadedWorkstreamId: string | null = null;
	#reading = false;
	#lines: HTMLOListElement | null = null;
	#requestedLine: number | null = null;

	constructor(api: RepositoryPanelHost, path: string, root: HTMLElement) {
		this.#api = api;
		this.#path = path;
		this.#body = document.createElement('div');
		this.#body.className = 'repository-file-tab__body malini-panel-column';
		root.append(filePathHeader(path), this.#body);
	}

	async load(context: ExtensionPanelContext): Promise<void> {
		const workstreamId = context.workstream?.id ?? null;
		if (this.#reading || (workstreamId !== null && workstreamId === this.#loadedWorkstreamId))
			return;
		this.#reading = true;
		this.#renderStatus('Loading…');
		try {
			const contents = await this.#api.workstream.readFile(this.#path, workstreamId ?? undefined);
			this.#loadedWorkstreamId = workstreamId;
			this.#renderContents(contents);
		} catch (error) {
			this.#loadedWorkstreamId = null;
			this.#renderStatus(error instanceof Error ? error.message : 'This file is not readable.');
		} finally {
			this.#reading = false;
		}
	}

	revealLine(line: number): void {
		this.#requestedLine = line;
		const lines = this.#lines;
		if (!lines) return;
		for (const marked of lines.querySelectorAll('[data-current-line="true"]')) {
			marked.removeAttribute('data-current-line');
		}
		const row = lines.querySelector<HTMLElement>(`[data-line="${line}"]`);
		if (!row) return;
		row.dataset.currentLine = 'true';
		row.scrollIntoView({ block: 'center' });
	}

	#renderStatus(message: string): void {
		this.#lines = null;
		const status = document.createElement('p');
		status.className = 'malini-panel-empty malini-panel-empty-heading';
		status.textContent = message;
		this.#body.replaceChildren(status);
	}

	#renderContents(contents: string): void {
		if (contents.length === 0) {
			this.#renderStatus('This file is empty.');
			return;
		}

		const plain = contents.split('\n');
		const source: (readonly CodeToken[] | string)[] =
			contents.length <= MAX_HIGHLIGHT_CHARACTERS
				? highlightFileLines(this.#path, contents)
				: plain;
		const truncated = source.length > MAX_RENDERED_LINES;
		const rendered = truncated ? source.slice(0, MAX_RENDERED_LINES) : source;

		const lines = document.createElement('ol');
		lines.className = 'repository-file-tab__lines styled-scrollbar';
		lines.tabIndex = 0;

		for (const [index, line] of rendered.entries()) {
			lines.append(this.#renderLine(index + 1, line));
		}
		this.#lines = lines;

		const frame: HTMLElement[] = [lines];
		if (truncated) {
			const notice = document.createElement('p');
			notice.className = 'repository-file-tab__notice malini-panel-meta';
			notice.textContent = `Showing the first ${MAX_RENDERED_LINES.toLocaleString()} of ${source.length.toLocaleString()} lines.`;
			frame.push(notice);
		}
		this.#body.replaceChildren(...frame);
		if (this.#requestedLine !== null) this.revealLine(this.#requestedLine);
	}

	#renderLine(number: number, line: readonly CodeToken[] | string): HTMLLIElement {
		const row = document.createElement('li');
		row.className = 'repository-file-tab__line';
		row.dataset.line = String(number);

		const gutter = document.createElement('span');
		gutter.className = 'repository-file-tab__gutter';
		gutter.setAttribute('aria-hidden', 'true');
		gutter.textContent = String(number);

		const code = document.createElement('code');
		code.className = 'repository-file-tab__code code-tokens';
		if (typeof line === 'string' || line.length === 0) {
			const text = typeof line === 'string' ? line : '';
			code.textContent = text.length === 0 ? ' ' : text;
			row.append(gutter, code);
			return row;
		}

		code.append(...tokenSpans(line));
		row.append(gutter, code);
		return row;
	}
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

[data-malini-extension] .repository-file-tab__path {
	flex: none;
	border-bottom: 1px solid var(--color-border-subtle);
	padding: 0.5rem 1rem;
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
	display: flex;
	min-width: max-content;
	width: 100%;
	align-items: flex-start;
	gap: 0.75rem;
	padding-right: 1rem;
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
	background: var(--color-surface-50);
	color: var(--color-fg-tertiary);
	text-align: right;
	font-variant-numeric: tabular-nums;
	user-select: none;
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
