import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
	Annotation,
	EditorState,
	RangeSet,
	RangeSetBuilder,
	StateEffect,
	StateField,
	Transaction,
	type Extension,
	type Range,
	type Text,
} from '@codemirror/state';
import {
	Decoration,
	EditorView,
	GutterMarker,
	ViewPlugin,
	WidgetType,
	drawSelection,
	gutterLineClass,
	highlightActiveLine,
	highlightActiveLineGutter,
	highlightSpecialChars,
	keymap,
	lineNumberWidgetMarker,
	lineNumbers,
	placeholder,
	type DecorationSet,
	type ViewUpdate,
} from '@codemirror/view';
import {
	basename,
	extensionPanelInstanceId,
	highlightCodeLines,
	installExtensionPanelStyles,
	languageForPath,
	markLineChanges,
	resolveLanguage,
	type CodeToken,
	type ExtensionDisposable,
	type ExtensionPanelComponent,
	type ExtensionPanelContext,
	type ExtensionPanelInstance,
	type ExtensionPanelOpenOptions,
} from '@malini/extension-api';
import {
	changeTag,
	diffLineSides,
	diffLineTokens,
	tokenSpans,
	type ChangeTag,
} from './code-tokens.js';
import type { RepositoryPanelController, RepositoryViewState } from './controller.js';
import type { RepositoryDiff } from './domain.js';
import type { RepositoryPanelHost } from './panel.js';

export const REPOSITORY_FILE_PANEL_TEMPLATE_ID = 'malini.repository.file';

const SAVE_DELAY_MS = 400;

export type RepositoryFileTabTarget = Readonly<{
	path: string;
	line: number | null;
	pinned: boolean;
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

		this.#api.panels.open(fileTabId(path), fileTabOptions(path, target.pinned));
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
				view.mask(context.maskPrivateData === true);
				await view.load(context);
				if (this.#views.get(path) === view) this.#controller.showFile(path);
				const following = this.#controller.subscribe((state) => view.follow(state));

				return {
					update: (next) => {
						view.mask(next.maskPrivateData === true);
						return view.load(next);
					},
					dispose: async () => {
						following.dispose();
						if (this.#views.get(path) === view) {
							this.#views.delete(path);
							this.#controller.hideFile(path);
						}
						await view.dispose();
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

function fileTabId(path: string): string {
	return extensionPanelInstanceId(REPOSITORY_FILE_PANEL_TEMPLATE_ID, path);
}

function fileTabOptions(path: string, pinned: boolean): ExtensionPanelOpenOptions {
	return {
		label: basename(path),
		icon: `path:${path}`,
		tooltip: path,
		...(pinned ? { pinned: true } : {}),
	};
}

const fromDisk = Annotation.define<true>();

class RepositoryFileTabView {
	readonly #api: RepositoryPanelHost;
	readonly #controller: RepositoryPanelController;
	readonly #path: string;
	readonly #root: HTMLElement;
	readonly #body: HTMLElement;
	readonly #status: HTMLElement;
	readonly #veil: HTMLElement;
	#workstreamId: string | null = null;
	#loadedWorkstreamId: string | null = null;
	#treeDiffKey: string | null = null;
	#reads = 0;
	#editor: EditorView | null = null;
	#language = 'text';
	#saved = '';
	#requestedLine: number | null = null;
	#pinned = false;
	#revealed = false;
	#closing = false;
	#saveTimer: ReturnType<typeof setTimeout> | null = null;
	#saving: Promise<void> = Promise.resolve();

	constructor(
		api: RepositoryPanelHost,
		controller: RepositoryPanelController,
		path: string,
		root: HTMLElement,
	) {
		this.#api = api;
		this.#controller = controller;
		this.#path = path;
		this.#root = root;
		this.#body = document.createElement('div');
		this.#body.className = 'repository-file-tab__body malini-panel-column';
		this.#veil = privacyVeil(path, () => {
			this.#revealed = true;
			this.mask(false);
		});
		this.#status = document.createElement('p');
		this.#status.className = 'repository-file-tab__status malini-panel-meta';
		this.#status.setAttribute('role', 'status');
		this.#status.hidden = true;
		root.append(this.#body, this.#veil, this.#status);
	}

	async load(context: ExtensionPanelContext): Promise<void> {
		const workstreamId = context.workstream?.id ?? null;
		if (workstreamId !== null && workstreamId === this.#loadedWorkstreamId) return;
		this.#workstreamId = workstreamId;
		this.#loadedWorkstreamId = workstreamId;
		const state = this.#controller.snapshot();
		this.#treeDiffKey = treeDiffKey(state, this.#path, workstreamId);
		const contents = selectedContents(state, this.#path, workstreamId);
		if (contents !== null) {
			this.#reads += 1;
			this.#show(contents, branchDiff(state, this.#path, workstreamId));
			return;
		}
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
		const editor = this.#editor;
		if (!editor) return;
		const target = editor.state.doc.line(Math.min(line, editor.state.doc.lines));
		editor.dispatch({
			selection: { anchor: target.from },
			effects: EditorView.scrollIntoView(target.from, { y: 'center' }),
		});
	}

	mask(masked: boolean): void {
		const hidden = masked && !this.#revealed && isPrivateFile(this.#path);
		this.#root.toggleAttribute('data-masked', hidden);
		this.#veil.hidden = !hidden;
		this.#body.inert = hidden;
	}

	async dispose(): Promise<void> {
		this.#closing = true;
		await this.#saveNow();
		this.#editor?.destroy();
		this.#editor = null;
	}

	async #read(): Promise<void> {
		const read = ++this.#reads;
		try {
			const contents = await this.#api.workstream.readFile(
				this.#path,
				this.#workstreamId ?? undefined,
			);
			if (read !== this.#reads) return;
			this.#show(contents, branchDiff(this.#controller.snapshot(), this.#path, this.#workstreamId));
		} catch (error) {
			if (read !== this.#reads) return;
			this.#loadedWorkstreamId = null;
			this.#showProblem(error instanceof Error ? error.message : 'This file is not readable.');
		}
	}

	#show(contents: string, diff: RepositoryDiff | null): void {
		const editor = this.#editor;
		if (!editor) {
			this.#mount(contents, diff);
			return;
		}
		const shown = editor.state.doc.toString();
		if (shown !== this.#saved) return;
		if (contents !== shown) editor.dispatch(replacementFromDisk(shown, contents));
		this.#saved = contents;
		editor.dispatch({ effects: showBranchChanges.of({ diff, language: this.#language }) });
	}

	#mount(contents: string, diff: RepositoryDiff | null): void {
		this.#language = resolveLanguage(languageForPath(this.#path), contents);
		this.#saved = contents;
		const editor = new EditorView({
			state: EditorState.create({
				doc: contents,
				extensions: [
					lineNumbers(),
					highlightActiveLineGutter(),
					highlightSpecialChars(),
					history(),
					drawSelection(),
					highlightActiveLine(),
					EditorState.tabSize.of(2),
					keymap.of([
						{ key: 'Mod-s', run: () => (void this.#saveNow(), true), preventDefault: true },
						...defaultKeymap,
						...historyKeymap,
						indentWithTab,
					]),
					placeholder('This file is empty.'),
					codeTokens(this.#language),
					branchChanges,
					lineNumberWidgetMarker.of((_view, widget) =>
						widget instanceof RemovedLine ? new LineNumber(widget.line) : null,
					),
					EditorView.contentAttributes.of({ 'aria-label': `Edit ${this.#path}` }),
					EditorView.updateListener.of((update) => this.#changed(update)),
					EditorView.domEventHandlers({ blur: () => void this.#saveNow() }),
					FILE_TAB_THEME,
				],
			}),
		});
		editor.scrollDOM.classList.add('styled-scrollbar');
		this.#body.replaceChildren(editor.dom);
		this.#editor = editor;
		editor.dispatch({ effects: showBranchChanges.of({ diff, language: this.#language }) });
		if (this.#requestedLine !== null) {
			this.revealLine(this.#requestedLine);
			return;
		}
		const firstChange = firstChangePosition(editor.state);
		if (firstChange !== null) {
			editor.dispatch({ effects: EditorView.scrollIntoView(firstChange, { y: 'center' }) });
		}
	}

	#showProblem(message: string): void {
		this.#editor?.destroy();
		this.#editor = null;
		const problem = document.createElement('p');
		problem.className = 'malini-panel-empty malini-panel-empty-heading';
		problem.textContent = message;
		this.#body.replaceChildren(problem);
	}

	#changed(update: ViewUpdate): void {
		if (!update.docChanged) return;
		if (update.transactions.every((transaction) => transaction.annotation(fromDisk))) return;
		this.#pin();
		if (this.#saveTimer !== null) clearTimeout(this.#saveTimer);
		this.#saveTimer = setTimeout(() => void this.#saveNow(), SAVE_DELAY_MS);
	}

	#pin(): void {
		if (this.#pinned) return;
		this.#pinned = true;
		this.#api.panels.open(fileTabId(this.#path), fileTabOptions(this.#path, true));
	}

	#saveNow(): Promise<void> {
		if (this.#saveTimer !== null) clearTimeout(this.#saveTimer);
		this.#saveTimer = null;
		const editor = this.#editor;
		if (editor) this.#saving = this.#saveAfter(this.#saving, editor);
		return this.#saving;
	}

	async #saveAfter(previous: Promise<void>, editor: EditorView): Promise<void> {
		await previous;
		const contents = editor.state.doc.toString();
		if (contents === this.#saved) return;
		try {
			await this.#api.workstream.writeFile(this.#path, contents, this.#workstreamId ?? undefined);
			this.#saved = contents;
			this.#announce('Saved');
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			const title = `Could not save ${basename(this.#path)}`;
			this.#announce(`${title}: ${reason}`);
			if (this.#closing) void this.#api.notifications.show({ title, body: reason, level: 'error' });
		}
	}

	#announce(message: string): void {
		this.#status.textContent = message;
		this.#status.hidden = false;
	}
}

function replacementFromDisk(shown: string, contents: string) {
	let start = 0;
	while (start < shown.length && start < contents.length && shown[start] === contents[start]) {
		start += 1;
	}
	let end = 0;
	while (
		end < shown.length - start &&
		end < contents.length - start &&
		shown[shown.length - 1 - end] === contents[contents.length - 1 - end]
	) {
		end += 1;
	}
	return {
		changes: {
			from: start,
			to: shown.length - end,
			insert: contents.slice(start, contents.length - end),
		},
		annotations: [fromDisk.of(true), Transaction.addToHistory.of(false)],
	};
}

const PRIVATE_FILE_NAME = /^(?:\.env(?:\..+)?|.+\.env|\.envrc|.+\.(?:pem|key|p12|pfx))$/u;

export function isPrivateFile(path: string): boolean {
	return (
		path.startsWith('/') ||
		path.split('/').includes('.secrets') ||
		PRIVATE_FILE_NAME.test(basename(path))
	);
}

function privacyVeil(path: string, reveal: () => void): HTMLElement {
	const veil = document.createElement('div');
	veil.className = 'repository-file-tab__veil';
	veil.hidden = true;
	const notice = document.createElement('p');
	notice.className = 'malini-panel-empty-heading';
	notice.textContent = 'Hidden while your screen is shared';
	const show = document.createElement('button');
	show.type = 'button';
	show.className = 'repository-file-tab__reveal';
	show.textContent = `Show ${basename(path)}`;
	show.addEventListener('click', reveal);
	veil.append(notice, show);
	return veil;
}

type BranchChanges = Readonly<{ diff: RepositoryDiff | null; language: string }>;

type BranchChangeMarks = Readonly<{ lines: DecorationSet; gutter: RangeSet<GutterMarker> }>;

const showBranchChanges = StateEffect.define<BranchChanges>();

const branchChanges = StateField.define<BranchChangeMarks>({
	create: () => ({ lines: Decoration.none, gutter: RangeSet.empty }),
	update(marks, transaction) {
		for (const effect of transaction.effects) {
			if (effect.is(showBranchChanges))
				return branchChangeMarks(transaction.state.doc, effect.value);
		}
		if (!transaction.docChanged) return marks;
		return {
			lines: marks.lines.map(transaction.changes),
			gutter: marks.gutter.map(transaction.changes),
		};
	},
	provide: (field) => [
		EditorView.decorations.from(field, (marks) => marks.lines),
		gutterLineClass.from(field, (marks) => marks.gutter),
	],
});

function branchChangeMarks(doc: Text, { diff, language }: BranchChanges): BranchChangeMarks {
	if (diff === null || diff.lines.length === 0) {
		return { lines: Decoration.none, gutter: RangeSet.empty };
	}
	const changed = changedLineTokens(diff, language, highlightCodeLines(doc.toString(), language));
	const lines: Range<Decoration>[] = [];
	const gutter: Range<GutterMarker>[] = [];
	let removals: RemovedLine[] = [];
	const placeRemovals = (position: number, side: -1 | 1): void => {
		for (const widget of removals) {
			lines.push(Decoration.widget({ widget, block: true, side }).range(position));
		}
		removals = [];
	};
	for (const row of repositoryFileTabRows(doc.lines, diff)) {
		if (row.kind === 'removed') {
			removals.push(
				new RemovedLine(row.line, changed.removed.get(row.line) ?? plainToken(row.text)),
			);
			continue;
		}
		const line = doc.line(row.line);
		placeRemovals(line.from, -1);
		if (!row.added) continue;
		lines.push(ADDED_LINE.range(line.from), ADDED_LABEL.range(line.from));
		gutter.push(ADDED_GUTTER.range(line.from));
		let offset = line.from;
		let changedFrom: number | null = null;
		for (const token of changed.added.get(row.line) ?? []) {
			if (token.changed) changedFrom ??= offset;
			else if (changedFrom !== null) {
				lines.push(CHANGED_WORD.range(changedFrom, offset));
				changedFrom = null;
			}
			offset = Math.min(offset + token.text.length, line.to);
		}
		if (changedFrom !== null && offset > changedFrom) {
			lines.push(CHANGED_WORD.range(changedFrom, offset));
		}
	}
	placeRemovals(doc.length, 1);
	return { lines: Decoration.set(lines, true), gutter: RangeSet.of(gutter, true) };
}

function firstChangePosition(state: EditorState): number | null {
	const cursor = state.field(branchChanges).lines.iter();
	return cursor.value ? cursor.from : null;
}

class RemovedLine extends WidgetType {
	constructor(
		readonly line: number,
		readonly tokens: readonly CodeToken[],
	) {
		super();
	}

	override eq(other: RemovedLine): boolean {
		return (
			other.line === this.line &&
			other.tokens.length === this.tokens.length &&
			other.tokens.every(
				(token, index) =>
					token.text === this.tokens[index]?.text && token.changed === this.tokens[index]?.changed,
			)
		);
	}

	override toDOM(): HTMLElement {
		const row = document.createElement('div');
		row.className = 'repository-file-tab__removed';
		row.dataset.change = 'deletion';
		row.append(changeLabel('Removed'));
		const code = document.createElement('span');
		fillCode(code, this.tokens, 'del');
		row.append(code);
		return row;
	}
}

class LineNumber extends GutterMarker {
	override readonly elementClass = 'repository-file-tab__removed-number';

	constructor(readonly line: number) {
		super();
	}

	override eq(other: LineNumber): boolean {
		return other.line === this.line;
	}

	override toDOM(): Node {
		return document.createTextNode(String(this.line));
	}
}

class ChangeLabel extends WidgetType {
	override eq(): boolean {
		return true;
	}

	override toDOM(): HTMLElement {
		return changeLabel('Added');
	}
}

class AddedGutter extends GutterMarker {
	override readonly elementClass = 'repository-file-tab__added-number';
}

const ADDED_LINE = Decoration.line({ attributes: { 'data-change': 'addition' } });
const ADDED_LABEL = Decoration.widget({ widget: new ChangeLabel(), side: -1 });
const ADDED_GUTTER = new AddedGutter();
const CHANGED_WORD = Decoration.mark({ tagName: 'ins' });

function plainToken(text: string): readonly CodeToken[] {
	return [{ kind: 'plain', text }];
}

function codeTokens(language: string): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			lines: readonly (readonly CodeToken[])[];

			constructor(view: EditorView) {
				this.lines = highlightCodeLines(view.state.doc.toString(), language);
				this.decorations = tokenMarks(view, this.lines);
			}

			update(update: ViewUpdate): void {
				// ponytail: re-tokenizes the whole file per edit (~18 ms at 20k lines); tokenize from the edited line if huge files lag
				if (update.docChanged) {
					this.lines = highlightCodeLines(update.state.doc.toString(), language);
				}
				if (update.docChanged || update.viewportChanged) {
					this.decorations = tokenMarks(update.view, this.lines);
				}
			}
		},
		{ decorations: (plugin) => plugin.decorations },
	);
}

const TOKEN_MARKS = new Map<string, Decoration>();

function tokenMark(kind: string): Decoration {
	let mark = TOKEN_MARKS.get(kind);
	if (!mark) {
		mark = Decoration.mark({ class: `tok-${kind}` });
		TOKEN_MARKS.set(kind, mark);
	}
	return mark;
}

function tokenMarks(view: EditorView, lines: readonly (readonly CodeToken[])[]): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const { doc } = view.state;
	let next = 1;
	for (const { from, to } of view.visibleRanges) {
		const last = doc.lineAt(to).number;
		for (let number = Math.max(next, doc.lineAt(from).number); number <= last; number += 1) {
			const line = doc.line(number);
			let offset = line.from;
			for (const token of lines[number - 1] ?? []) {
				const end = Math.min(offset + token.text.length, line.to);
				if (token.kind !== 'plain' && end > offset) builder.add(offset, end, tokenMark(token.kind));
				offset = end;
			}
		}
		next = last + 1;
	}
	return builder.finish();
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

function isWorkstreamState(state: RepositoryViewState, workstreamId: string | null): boolean {
	return workstreamId === null || state.context?.workstreamId === workstreamId;
}

function branchDiff(
	state: RepositoryViewState,
	path: string,
	workstreamId: string | null,
): RepositoryDiff | null {
	if (!isWorkstreamState(state, workstreamId)) return null;
	return state.diffs.find((entry) => entry.path === path) ?? null;
}

function selectedContents(
	state: RepositoryViewState,
	path: string,
	workstreamId: string | null,
): string | null {
	if (!isWorkstreamState(state, workstreamId) || state.selectedPath !== path) return null;
	return state.selectedContents;
}

function treeDiffKey(
	state: RepositoryViewState,
	path: string,
	workstreamId: string | null,
): string | null {
	if (!isWorkstreamState(state, workstreamId)) return null;
	return JSON.stringify(branchDiff(state, path, workstreamId)?.lines ?? []);
}

function changedLineTokens(
	diff: Pick<RepositoryDiff, 'lines'>,
	language: string,
	source: readonly (readonly CodeToken[])[],
): Readonly<{
	added: ReadonlyMap<number, readonly CodeToken[]>;
	removed: ReadonlyMap<number, readonly CodeToken[]>;
}> {
	const lines = diff.lines;
	const diffTokens = diffLineTokens(lines, language);
	const tokens = markLineChanges(
		diffLineSides(lines),
		lines.map((line, index) => {
			const fileTokens = line.newLine === null ? undefined : source[line.newLine - 1];
			const current = fileTokens?.map((token) => token.text).join('') === line.text;
			return (line.kind === 'addition' && current ? fileTokens : diffTokens[index]) ?? [];
		}),
	);
	const added = new Map<number, readonly CodeToken[]>();
	const removed = new Map<number, readonly CodeToken[]>();
	for (const [index, line] of lines.entries()) {
		const lineTokens = tokens[index] ?? [];
		if (changeTag(line.kind) === 'ins' && line.newLine !== null)
			added.set(line.newLine, lineTokens);
		if (changeTag(line.kind) === 'del' && line.oldLine !== null)
			removed.set(line.oldLine, lineTokens);
	}
	return { added, removed };
}

function fillCode(code: HTMLElement, tokens: readonly CodeToken[], change: ChangeTag | null): void {
	if (tokens.length === 0) code.textContent = ' ';
	else code.append(...tokenSpans(tokens, change));
}

function changeLabel(text: string): HTMLElement {
	const label = document.createElement('span');
	label.className = 'repository-file-tab__change-label';
	label.textContent = `${text}: `;
	return label;
}

const added = (percent: number): string =>
	`color-mix(in srgb, var(--code-added) ${String(percent)}%, var(--color-surface-50))`;
const removed = (percent: number): string =>
	`color-mix(in srgb, var(--code-removed) ${String(percent)}%, var(--color-surface-50))`;

const FILE_TAB_THEME = EditorView.theme({
	'&': {
		minHeight: '0',
		flex: '1',
		color: 'var(--code-plain)',
		backgroundColor: 'var(--color-surface-50)',
		fontSize: 'var(--text-xs)',
	},
	'&.cm-focused': { outline: 'none' },
	'.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
	'.cm-content': { padding: '0.75rem 0', caretColor: 'var(--color-fg-default)' },
	'.cm-line': { padding: '0 1rem 0 0.75rem' },
	'.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-fg-default)' },
	'&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
		{ backgroundColor: 'color-mix(in srgb, var(--color-fg-default) 18%, transparent)' },
	'.cm-activeLine': { backgroundColor: 'transparent' },
	'&.cm-focused .cm-activeLine': { backgroundColor: 'var(--color-surface-100)' },
	'.cm-gutters': {
		border: 'none',
		backgroundColor: 'var(--color-surface-50)',
		color: 'var(--color-fg-tertiary)',
	},
	'.cm-lineNumbers .cm-gutterElement': {
		position: 'relative',
		minWidth: '5ch',
		padding: '0 0.5rem 0 1rem',
		fontVariantNumeric: 'tabular-nums',
	},
	'.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--color-fg-secondary)' },
	'.cm-placeholder': { color: 'var(--color-fg-tertiary)' },
	'.cm-line[data-change="addition"]': { backgroundColor: added(10) },
	'.cm-gutterElement.repository-file-tab__added-number': {
		backgroundColor: added(10),
		color: 'var(--color-success-content)',
	},
	'.cm-gutterElement.repository-file-tab__removed-number': {
		backgroundColor: removed(10),
		color: 'var(--color-error-content)',
	},
	'.cm-gutterElement.repository-file-tab__added-number::before, .cm-gutterElement.repository-file-tab__removed-number::before':
		{
			position: 'absolute',
			insetBlock: '0',
			left: '0',
			width: '0.25rem',
			content: '""',
		},
	'.cm-gutterElement.repository-file-tab__added-number::before': {
		background: 'var(--code-added)',
	},
	'.cm-gutterElement.repository-file-tab__removed-number::before': {
		background:
			'repeating-linear-gradient(to bottom, var(--code-removed) 0 1px, transparent 1px 2px)',
	},
	'.repository-file-tab__removed': {
		padding: '0 1rem 0 0.75rem',
		backgroundColor: removed(10),
		whiteSpace: 'pre',
		userSelect: 'none',
	},
	'ins, del': { textDecoration: 'none' },
	ins: { backgroundColor: 'color-mix(in srgb, var(--code-added) 28%, transparent)' },
	del: { backgroundColor: 'color-mix(in srgb, var(--code-removed) 28%, transparent)' },
	'.repository-file-tab__change-label': {
		position: 'absolute',
		width: '1px',
		height: '1px',
		overflow: 'hidden',
		clipPath: 'inset(50%)',
		whiteSpace: 'nowrap',
		userSelect: 'none',
	},
});

const REPOSITORY_FILE_TAB_STYLES = `
[data-malini-extension].repository-file-tab {
	position: relative;
	overflow: hidden;
	background: var(--color-surface-50);
}

[data-malini-extension] .repository-file-tab__body {
	display: flex;
	min-height: 0;
	flex: 1;
	flex-direction: column;
}

[data-malini-extension][data-masked] .repository-file-tab__body {
	visibility: hidden;
}

[data-malini-extension] .repository-file-tab__veil {
	position: absolute;
	inset: 0;
	display: grid;
	place-content: center;
	justify-items: center;
	gap: 0.75rem;
	padding: 1.5rem;
	text-align: center;
}

[data-malini-extension] .repository-file-tab__veil[hidden] {
	display: none;
}

[data-malini-extension] .repository-file-tab__reveal {
	border: 0.5px solid var(--color-border-subtle);
	border-radius: var(--radius-field, 0.5rem);
	background: var(--color-surface-elevated);
	padding: 0.25rem 0.75rem;
	color: var(--color-fg-default);
	font: inherit;
	font-size: var(--text-xs);
	cursor: pointer;
}

[data-malini-extension] .repository-file-tab__reveal:hover {
	background: var(--color-surface-100);
}

[data-malini-extension] .repository-file-tab__status {
	flex: none;
	border-top: 1px solid var(--color-border-subtle);
	padding: 0.375rem 1rem;
}

[data-malini-extension] .repository-file-tab__status[hidden] {
	display: none;
}
`;
