import {
	bindEvent,
	fileIconIdFor,
	fileIconUrl,
	folderIconIdFor,
	formatCount,
	installExtensionPanelStyles,
	reconcileChildren,
	type ExtensionAPI,
	type ExtensionPanelComponent,
	type ExtensionPanelInstance,
	type ExtensionWorkstream,
} from '@malini/extension-api';
import { highlightLine, tokenSpans } from './code-tokens.js';
import type { RepositoryPanelController, RepositoryViewState } from './controller.js';
import { repositoryFileTabs } from './file-tab.js';
import {
	REPOSITORY_NO_LINE_CHANGE_LABEL,
	REPOSITORY_NO_LINE_CHANGE_STATEMENT,
	repositoryGithubSession,
	type RepositoryDiff,
	type RepositoryDiffNoLineChange,
} from './domain.js';
import { decodeTreeIcons, treeIconsDecoded } from './tree-icons.js';
import { upstreamPositionGlyphs, upstreamPositionSentence } from './upstream-position.js';

export type RepositoryPanelHost = {
	manifest: Pick<ExtensionAPI['manifest'], 'id'>;
	notifications: Pick<ExtensionAPI['notifications'], 'show'>;
	workstream: Pick<ExtensionAPI['workstream'], 'readFile'>;
	panels: Pick<ExtensionAPI['panels'], 'register' | 'open'>;
};

type RepositoryPanelAction = 'file' | 'diff';
type PanelIconName = 'arrow-left' | 'chevron-right' | 'git-branch' | 'x';
type RepositoryTreeNode = {
	name: string;
	path: string;
	type: 'directory' | 'file' | 'untracked-directory';
	children: readonly RepositoryTreeNode[];
	fileCount: number;
	modifiedCount: number;
	additions: number;
	deletions: number;
};
export type RepositoryLineChange = Readonly<{ additions: number; deletions: number }>;
type MutableRepositoryTreeNode = Omit<RepositoryTreeNode, 'children'> & {
	children: Map<string, MutableRepositoryTreeNode>;
};
export type RepositoryTreeRow = { node: RepositoryTreeNode; depth: number };
export type RepositoryTreeKeyCommand = Readonly<
	| { kind: 'focus'; path: string }
	| { kind: 'expand'; path: string }
	| { kind: 'collapse'; path: string }
	| { kind: 'activate'; path: string }
>;
type RepositoryPanelProjection = Readonly<{
	key: string;
	changed: readonly RepositoryChangeFileRow[];
	uncommittedChanged: readonly RepositoryChangeFileRow[];
	untrackedFileCounts: ReadonlyMap<string, number>;
	modifiedFiles: readonly string[];
	changedTree: readonly RepositoryTreeNode[];
	files: readonly string[];
	tree: readonly RepositoryTreeNode[];
}>;
export type RepositoryPanelMode = 'files' | 'changes';

const REPOSITORY_PANEL_LABELS: Record<RepositoryPanelMode, string> = {
	files: 'Repository files',
	changes: 'Repository changes',
};

export function createRepositoryPanel(
	api: RepositoryPanelHost,
	controller: RepositoryPanelController,
	mode: RepositoryPanelMode = 'files',
): ExtensionPanelComponent {
	return {
		workstreamScope: 'context',
		mount(target, context): ExtensionPanelInstance {
			const root = document.createElement('section');
			root.dataset.maliniExtension = api.manifest.id;
			root.dataset.repositoryPanel = mode;
			root.className = 'repository-panel malini-panel-column';
			root.setAttribute('aria-label', REPOSITORY_PANEL_LABELS[mode]);
			target.append(root);

			const styles = installExtensionPanelStyles('malini.repository', REPOSITORY_PANEL_STYLES);
			const view = new RepositoryPanelView(api, controller, root, mode, context.workstream);
			const subscription = controller.subscribe((state) => view.receive(state));
			const previews = controller.subscribeWorkstreamPreviews(() => view.refreshPreview());
			return {
				update: (next) => view.bind(next.workstream),
				async dispose() {
					previews.dispose();
					await subscription.dispose();
					await styles.dispose();
					root.remove();
				},
			};
		},
	};
}

class RepositoryPanelView {
	readonly #api: RepositoryPanelHost;
	readonly #controller: RepositoryPanelController;
	readonly #root: HTMLElement;
	readonly #mode: RepositoryPanelMode;
	#state!: RepositoryViewState;
	#rendered = false;
	#workstream: ExtensionWorkstream | null;
	#controllerWorkstreamId: string | null = null;
	readonly #expandedDirectories = new Set<string>();
	#treeExpanded = true;
	#changedOnly = false;
	#diffOpen = false;
	#busy: RepositoryPanelAction | null = null;
	#actionError: string | null = null;
	#activeWorkstreamId: string | null;
	#activeInteractionScope: string;
	#operationSequence = 0;
	#activeTreePath: string | null = null;
	#revealedPath: string | null = null;
	#treeRows: readonly RepositoryTreeRow[] = [];
	#projection: RepositoryPanelProjection | null = null;
	#renderIdentity: string | null = null;
	#indexedFiles: RepositoryViewState['files'] | null = null;

	constructor(
		api: RepositoryPanelHost,
		controller: RepositoryPanelController,
		root: HTMLElement,
		mode: RepositoryPanelMode,
		workstream: ExtensionWorkstream | null,
	) {
		this.#api = api;
		this.#controller = controller;
		this.#root = root;
		this.#mode = mode;
		this.#workstream = workstream;
		this.#activeWorkstreamId = null;
		this.#activeInteractionScope = '';
	}

	receive(state: RepositoryViewState): void {
		const workstreamId = state.context?.workstreamId ?? null;
		this.#controllerWorkstreamId = workstreamId;
		const workstream = this.#workstream;
		if (!workstream || workstreamId === workstream.id) {
			this.update(state);
			return;
		}
		if (!this.#rendered) this.update(this.#controller.workstreamState(workstream));
	}

	refreshPreview(): void {
		const workstream = this.#workstream;
		if (!workstream || workstream.id === this.#controllerWorkstreamId) return;
		this.update(this.#controller.workstreamState(workstream));
	}

	bind(workstream: ExtensionWorkstream | null): void {
		const unchanged = (workstream?.id ?? null) === (this.#workstream?.id ?? null);
		this.#workstream = workstream;
		if (unchanged) return;
		this.update(
			workstream ? this.#controller.workstreamState(workstream) : this.#controller.snapshot(),
		);
	}

	update(state: RepositoryViewState): void {
		this.#rendered = true;
		const workstreamId = state.context?.workstreamId ?? null;
		const interactionScope = repositoryInteractionScope(state);
		if (workstreamId !== this.#activeWorkstreamId) {
			this.#activeWorkstreamId = workstreamId;
			this.#operationSequence += 1;
			this.#busy = null;
			this.#actionError = null;
			this.#expandedDirectories.clear();
			this.#activeTreePath = null;
			this.#revealedPath = null;
		} else if (interactionScope !== this.#activeInteractionScope) {
			this.#actionError = null;
		}
		this.#activeInteractionScope = interactionScope;
		this.#state = state;
		if (this.#indexedFiles !== state.files) {
			this.#indexedFiles = state.files;
		}
		const projection = repositoryPanelProjection(this.#projection, state);
		const renderIdentity = repositoryPanelRenderIdentity(state, projection);
		if (!state.diff) this.#diffOpen = false;
		this.#projection = projection;
		if (renderIdentity === this.#renderIdentity) return;
		this.#renderIdentity = renderIdentity;
		this.#render();
		this.#revealSelectedFile(state.selectedPath);
	}

	#revealSelectedFile(path: string | null): void {
		if (path === this.#revealedPath) return;
		this.#revealedPath = path;
		const projection = this.#projection;
		if (path === null || this.#mode !== 'files' || !projection) return;
		const ancestors = ancestorDirectoryPaths(path);
		const expanded = new Set([...this.#expandedDirectories, ...ancestors]);
		const rows = flattenRepositoryTree(this.#treeNodes(projection), expanded);
		if (!rows.some(({ node }) => node.path === path)) return;
		this.#afterTreeIcons(treeRowIconIds(rows, expanded), () => {
			if (this.#revealedPath !== path) return;
			const opening = ancestors.filter((ancestor) => !this.#expandedDirectories.has(ancestor));
			for (const ancestor of opening) this.#expandedDirectories.add(ancestor);
			this.#activeTreePath = path;
			if (opening.length > 0) this.#renderTree();
			this.#markActiveTreeRow(path)?.scrollIntoView({ block: 'nearest' });
		});
	}

	#renderHeader(): HTMLElement {
		const header = document.createElement('div');
		header.className = 'repository-panel__header malini-panel-header';
		header.dataset.reconcileKey = 'header';
		const context = this.#state.context;
		const uncommitted = this.#state.diffScope === 'uncommitted';

		const identity = document.createElement('div');
		identity.className = 'repository-panel__identity';
		const name = document.createElement('span');
		name.className = 'repository-panel__repository-name repository-panel__repository-name--stat';
		const title = document.createElement('span');
		title.className = 'repository-panel__stat-label';

		title.textContent = uncommitted ? 'Uncommitted' : 'This branch';
		name.append(
			title,
			uncommitted
				? diffStat(this.#state.uncommitted.additions, this.#state.uncommitted.deletions)
				: diffStat(this.#state.additions, this.#state.deletions),
		);
		const branch = document.createElement('span');
		branch.className = 'repository-panel__branch';
		if (context) {
			const head = document.createElement('span');
			head.className = 'repository-panel__branch-head';
			head.textContent = context.branch;
			const base = document.createElement('span');
			base.className = 'repository-panel__branch-base';
			base.textContent = `→ ${context.baseBranch}`;
			branch.append(head, base);
			branch.title = `${context.branch} → ${context.baseBranch}`;
			const glyphs = upstreamPositionGlyphs(context);
			if (glyphs) {
				const sync = document.createElement('span');
				sync.className = 'repository-panel__branch-sync';
				sync.textContent = glyphs;
				sync.title = upstreamPositionSentence(context);
				branch.append(sync);
			}
		} else {
			branch.textContent = 'Workstream context unavailable';
		}
		identity.append(name, branch);
		const controls = document.createElement('div');
		controls.className = 'repository-panel__header-controls';
		controls.append(this.#scopeFilterChip());
		header.append(identity, controls);
		return header;
	}

	#scopeFilterChip(): HTMLButtonElement {
		const uncommitted = this.#state.diffScope === 'uncommitted';
		const chip = actionButton(
			'Uncommitted',
			`repository-panel__scope-chip${uncommitted ? ' repository-panel__scope-chip--active' : ''}`,
			() => {
				if (!this.#controlsRepository()) return;
				this.#controller.setDiffScope(uncommitted ? 'branch' : 'uncommitted');
			},
		);
		chip.dataset.command = 'diff-scope';
		chip.dataset.reconcileKey = 'diff-scope';
		chip.dataset.diffScope = this.#state.diffScope;
		chip.setAttribute('aria-pressed', uncommitted ? 'true' : 'false');
		chip.title = uncommitted
			? 'Showing uncommitted changes only. Remove the filter to see everything on this branch'
			: 'Showing everything this branch changed. Filter to uncommitted changes only';
		chip.setAttribute(
			'aria-label',
			uncommitted ? 'Remove the uncommitted changes filter' : 'Filter to uncommitted changes only',
		);
		const label = document.createElement('span');
		label.textContent = 'Uncommitted';
		if (uncommitted) chip.replaceChildren(svgIcon('x'), label);
		else chip.replaceChildren(label);
		return chip;
	}

	#render(): void {
		const header = this.#mode === 'changes' ? this.#renderHeader() : null;

		const content = document.createElement('div');
		content.className = 'repository-panel__content';
		content.dataset.reconcileKey = 'content';
		if (this.#state.error || this.#actionError) {
			const alert = document.createElement('p');
			alert.className = 'repository-panel__alert';
			alert.dataset.reconcileKey = 'panel-alert';
			alert.setAttribute('role', 'alert');
			alert.textContent = panelAlertText(this.#actionError ?? this.#state.error ?? '');
			content.append(alert);
		}
		this.#renderFiles(content);
		reconcileChildren(this.#root, header ? [header, content] : [content]);
	}

	#renderFiles(content: HTMLElement): void {
		if (this.#state.agentSessionDiff) {
			content.append(this.#renderAgentSessionDiff(this.#state.agentSessionDiff));
			return;
		}
		if (this.#diffOpen && this.#state.diff) {
			content.append(
				renderDiffView(this.#state.diff, () => {
					this.#diffOpen = false;
					this.#render();
				}),
			);
			return;
		}

		const projection = this.#projection ?? repositoryPanelProjection(null, this.#state);
		if (this.#mode === 'changes') {
			content.append(
				this.#renderChangedFilesSection(
					this.#scopedRows(projection),
					projection.untrackedFileCounts,
				),
			);
			return;
		}
		content.append(this.#renderTreeSection(projection));
	}

	#treeNodes(projection: RepositoryPanelProjection): readonly RepositoryTreeNode[] {
		return this.#changedOnly ? projection.changedTree : projection.tree;
	}

	#setChangedOnly(on: boolean): void {
		const changedTree = this.#projection?.changedTree ?? [];
		this.#afterTreeIcons(on ? expandedTreeIconIds(changedTree) : [], () => {
			this.#changedOnly = on;
			if (on) {
				for (const path of directoryPaths(changedTree)) this.#expandedDirectories.add(path);
			}
			this.#render();
		});
	}

	#expandDirectory(node: RepositoryTreeNode): void {
		this.#afterTreeIcons(expandedTreeIconIds([node], 1), () => {
			this.#expandedDirectories.add(node.path);
			this.#renderTree();
			this.#focusTreeRow(node.path);
		});
	}

	#afterTreeIcons(iconIds: readonly string[], show: () => void): void {
		if (treeIconsDecoded(iconIds)) {
			show();
			return;
		}
		void (async () => {
			await decodeTreeIcons(iconIds);
			show();
		})();
	}

	#renderAgentSessionDiff(diff: NonNullable<RepositoryViewState['agentSessionDiff']>): HTMLElement {
		const view = document.createElement('section');
		view.className = 'repository-panel__agent-session-diff';
		view.setAttribute('aria-label', `Agent chat changes in ${diff.path}`);
		view.dataset.sessionId = diff.sessionId;
		view.dataset.path = diff.path;

		const header = document.createElement('div');
		header.className = 'repository-panel__preview-header';
		const back = actionButton(
			'Back to files',
			'repository-panel__preview-back malini-panel-icon-button malini-panel-quiet-button',
			() => {
				if (!this.#controlsRepository()) return;
				this.#controller.closeAgentSessionDiff();
			},
		);
		back.setAttribute('aria-label', 'Back to repository files');
		back.title = 'Back to files';
		back.replaceChildren(svgIcon('arrow-left'));
		const path = document.createElement('p');
		path.className = 'repository-panel__section-label';
		path.textContent = diff.path;
		path.title = diff.path;
		header.append(
			back,
			fileIcon(diff.path),
			path,
			diffStat(
				diff.additions,
				diff.deletions,
				diff.additions === 0 && diff.deletions === 0 ? (diff.isBinary ? 'binary' : 'empty') : null,
			),
		);

		const body = document.createElement('div');
		body.className = 'repository-panel__agent-session-runs styled-scrollbar';
		body.dataset.contributingRunCount = String(diff.contributingRunIds.length);
		if (diff.turns.length === 0) {
			body.append(
				agentSessionSection(
					'Net chat change',
					diff.net.beforeCommit,
					diff.net.afterCommit,
					diff.isBinary ? null : diff.net.diff,
					diff.isBinary
						? 'Binary file changed; no textual diff is available.'
						: 'No net textual lines changed in this chat.',
				),
			);
		}
		for (const turn of diff.turns) {
			body.append(
				agentSessionSection(
					turn.title === null ? `Turn ${turn.turn}` : `Turn ${turn.turn} · ${turn.title}`,
					turn.beforeCommit,
					turn.afterCommit,
					turn.diff,
					turn.diff === null
						? 'Binary file changed; no textual diff is available.'
						: 'No textual lines changed in this turn.',
				),
			);
		}
		view.append(header, body);
		return view;
	}

	#scopedRows(projection: RepositoryPanelProjection): readonly RepositoryChangeFileRow[] {
		return this.#state.diffScope === 'uncommitted'
			? projection.uncommittedChanged
			: projection.changed;
	}

	#renderChangedFilesSection(
		rows: readonly RepositoryChangeFileRow[],
		untrackedFileCounts: ReadonlyMap<string, number>,
	): HTMLElement {
		const uncommitted = this.#state.diffScope === 'uncommitted';
		const section = document.createElement('section');
		section.className = 'repository-panel__files-section repository-panel__files-section--changed';
		section.dataset.reconcileKey = 'changed-files';
		section.dataset.diffScope = this.#state.diffScope;
		section.setAttribute('aria-label', `Changed files (${formatCount(rows.length)})`);

		if (rows.length === 0) {
			if (this.#state.refreshedAt === null) {
				section.append(statusMessage('No changes read from this workstream yet.'));
				return section;
			}
			section.append(
				emptyState(
					uncommitted ? 'No uncommitted changes yet' : 'No changes on this branch yet',
					uncommitted && this.#state.changedFiles > 0
						? `${changeCountLabel(this.#state.changedFiles)} already committed on this branch. Remove the Uncommitted filter to see ${this.#state.changedFiles === 1 ? 'it' : 'them'}.`
						: null,
				),
			);
			return section;
		}
		section.append(this.#renderChangeFileList(rows, untrackedFileCounts));
		return section;
	}

	#renderTreeSection(projection: RepositoryPanelProjection): HTMLElement {
		const treeNodes = this.#treeNodes(projection);
		const fileCount = this.#changedOnly
			? projection.uncommittedChanged.length
			: projection.files.length;
		const section = document.createElement('section');
		section.className = 'repository-panel__files-section repository-panel__files-section--all';
		section.dataset.reconcileKey = 'repository-tree';
		section.dataset.changedOnly = String(this.#changedOnly);
		section.setAttribute('aria-label', `Files (${formatCount(fileCount)})`);
		const summary = document.createElement('span');
		summary.className = 'repository-panel__section-summary';
		summary.textContent = formatCount(fileCount);
		const band = document.createElement('div');
		band.className = 'repository-panel__section-band';
		band.dataset.reconcileKey = 'repository-tree-band';
		band.append(
			this.#sectionToggle({
				title: 'Files',
				controls: 'repository-file-tree',
				expanded: this.#treeExpanded,
				summary,
				key: 'repository-tree-toggle',
				toggle: () => {
					this.#treeExpanded = !this.#treeExpanded;
					this.#render();
				},
			}),
			this.#changedFilterChip(projection.uncommittedChanged.length),
		);
		section.append(band);
		if (!this.#treeExpanded) {
			this.#treeRows = [];
			return section;
		}

		if (fileCount === 0) {
			this.#treeRows = [];
			if (this.#changedOnly) {
				section.append(emptyState('No uncommitted changes.'));
			} else if (this.#state.status === 'error') {
				section.append(emptyState('Repository files are unavailable.'));
			} else if (this.#state.refreshedAt === null) {
				section.append(statusMessage('Repository snapshot is not ready yet.'));
			} else {
				section.append(emptyState('No files in this repository.'));
			}
			return section;
		}

		const tree = document.createElement('div');
		tree.id = 'repository-file-tree';
		tree.className = 'repository-panel__tree styled-scrollbar';
		tree.setAttribute('role', 'tree');
		tree.setAttribute('aria-label', `${formatCount(fileCount)} repository files`);
		bindEvent(tree, 'keydown', (event) => this.#handleTreeKeydown(event));
		this.#fillTree(tree, treeNodes);
		section.append(tree);
		return section;
	}

	#changedFilterChip(modifiedCount: number): HTMLButtonElement {
		const on = this.#changedOnly;
		const chip = actionButton(
			'Changed',
			`repository-panel__scope-chip${on ? ' repository-panel__scope-chip--active' : ''}`,
			() => this.#setChangedOnly(!on),
		);
		chip.dataset.command = 'changed-only';
		chip.dataset.reconcileKey = 'changed-only';
		chip.dataset.changedOnly = String(on);
		chip.setAttribute('aria-pressed', on ? 'true' : 'false');
		chip.title = on
			? 'Showing uncommitted changes only. Remove the filter to see every file'
			: 'Filter to files with uncommitted changes';
		chip.setAttribute(
			'aria-label',
			on ? 'Remove the changed files filter' : 'Filter to files with uncommitted changes',
		);
		const label = document.createElement('span');
		label.textContent = 'Changed';
		const count = document.createElement('span');
		count.className = 'repository-panel__scope-chip-count';
		count.textContent = formatCount(modifiedCount);
		if (on) chip.replaceChildren(svgIcon('x'), label, count);
		else chip.replaceChildren(label, count);
		return chip;
	}

	#sectionToggle(options: {
		title: string;
		controls: string;
		expanded: boolean;
		summary: HTMLElement;
		key: string;
		toggle: () => void;
	}): HTMLButtonElement {
		const toggle = actionButton(options.title, 'repository-panel__section-toggle', options.toggle);
		toggle.setAttribute('aria-expanded', String(options.expanded));
		toggle.setAttribute('aria-controls', options.controls);
		toggle.dataset.reconcileKey = options.key;
		const label = document.createElement('span');
		label.className = 'repository-panel__section-toggle-label';
		const chevron = svgIcon('chevron-right');
		chevron.classList.add('repository-panel__section-chevron');
		const title = document.createElement('span');
		title.textContent = options.title;
		label.append(chevron, title);
		toggle.replaceChildren(label, options.summary);
		return toggle;
	}

	#fillTree(tree: HTMLElement, treeNodes: readonly RepositoryTreeNode[]): void {
		const rows = flattenRepositoryTree(treeNodes, this.#expandedDirectories);
		this.#treeRows = rows;
		const active = this.#resolveActiveTreePath(rows);
		tree.dataset.renderedRows = String(rows.length);
		tree.dataset.totalRows = String(rows.length);
		reconcileChildren(
			tree,
			rows.map((row) => this.#renderTreeRow(row, active)),
		);
	}

	#renderTree(): void {
		const tree = this.#root.querySelector<HTMLElement>('.repository-panel__tree');
		const projection = this.#projection;
		if (!tree || !projection) {
			this.#render();
			return;
		}
		this.#fillTree(tree, this.#treeNodes(projection));
	}

	#resolveActiveTreePath(rows: readonly RepositoryTreeRow[]): string | null {
		const current = this.#activeTreePath;
		if (current !== null && rows.some((row) => row.node.path === current)) return current;
		return rows[0]?.node.path ?? null;
	}

	#handleTreeKeydown(event: KeyboardEvent): void {
		if (event.altKey || event.ctrlKey || event.metaKey) return;
		const rows = this.#treeRows;
		const command = repositoryTreeKeyCommand(
			event.key,
			rows,
			this.#expandedDirectories,
			this.#resolveActiveTreePath(rows),
		);
		if (!command) return;
		event.preventDefault();
		switch (command.kind) {
			case 'focus':
				this.#focusTreeRow(command.path);
				return;
			case 'expand': {
				this.#activeTreePath = command.path;
				const row = rows.find(({ node }) => node.path === command.path);
				if (row) this.#expandDirectory(row.node);
				return;
			}
			case 'collapse':
				this.#expandedDirectories.delete(command.path);
				this.#activeTreePath = command.path;
				this.#renderTree();
				this.#focusTreeRow(command.path);
				return;
			case 'activate': {
				const row = rows.find(({ node }) => node.path === command.path);
				if (row) this.#activateTreeNode(row.node);
			}
		}
	}

	#focusTreeRow(path: string): void {
		this.#markActiveTreeRow(path)?.focus();
	}

	#markActiveTreeRow(path: string): HTMLElement | null {
		const tree = this.#root.querySelector<HTMLElement>('.repository-panel__tree');
		if (!tree) return null;
		this.#activeTreePath = path;
		let target: HTMLElement | null = null;
		for (let node = tree.firstElementChild; node !== null; node = node.nextElementSibling) {
			if (!(node instanceof HTMLElement)) continue;
			const row = node;
			const isTarget = row.getAttribute('data-path') === path;
			if (isTarget) target = row;
			if (row.getAttribute('data-tree-active') === String(isTarget)) continue;
			row.setAttribute('data-tree-active', String(isTarget));
			row.tabIndex = isTarget ? 0 : -1;
		}
		return target;
	}

	#activateTreeNode(node: RepositoryTreeNode): void {
		this.#activeTreePath = node.path;
		if (node.type === 'untracked-directory') return;
		if (node.type === 'directory') {
			if (!this.#expandedDirectories.has(node.path)) {
				this.#expandDirectory(node);
				return;
			}
			this.#expandedDirectories.delete(node.path);
			this.#renderTree();
			this.#focusTreeRow(node.path);
			return;
		}
		void this.#perform(
			'file',
			() => this.#controller.selectFile(node.path),
			() => {
				repositoryFileTabs(this.#api, this.#controller).open({ path: node.path, line: null });
			},
		);
	}

	#renderTreeRow({ node, depth }: RepositoryTreeRow, activePath: string | null): HTMLButtonElement {
		const directory = node.type === 'directory';
		const expanded = directory && this.#expandedDirectories.has(node.path);
		const selected = !directory && node.path === this.#state.selectedPath;
		const button = actionButton(
			node.name,
			`repository-panel__tree-row ${directory ? 'repository-panel__directory' : 'repository-panel__file'}`,
			() => this.#activateTreeNode(node),
		);
		button.style.setProperty('--tree-depth', String(depth));
		button.dataset.path = node.path;
		button.dataset.reconcileKey = `${node.type}:${node.path}`;
		button.dataset.treeActive = String(node.path === activePath);
		button.tabIndex = node.path === activePath ? 0 : -1;
		button.title = node.path;
		button.setAttribute('role', 'treeitem');
		button.setAttribute('aria-level', String(depth + 1));
		button.disabled = this.#busy !== null;

		const twisty = document.createElement('span');
		twisty.className = 'repository-panel__twisty';
		if (directory) twisty.append(svgIcon('chevron-right'));

		const name = document.createElement('span');
		name.className = 'repository-panel__tree-name';
		name.textContent = node.name;

		const modified = node.modifiedCount > 0;
		button.dataset.modified = String(modified);

		if (node.type === 'untracked-directory') {
			name.textContent = `${node.name}/`;
			button.setAttribute(
				'aria-label',
				`${node.path}, untracked directory of ${fileCountLabel(node.fileCount)}, too large to show changes`,
			);
			const count = document.createElement('span');
			count.className = 'repository-panel__tree-count';
			count.textContent = fileCountLabel(node.fileCount);
			button.replaceChildren(twisty, folderIcon(node.path, false), name, count);
			return button;
		}

		if (directory) {
			button.setAttribute('aria-expanded', String(expanded));
			button.setAttribute(
				'aria-label',
				`${expanded ? 'Collapse' : 'Expand'} directory ${node.path}${
					modified ? `, ${modifiedCountLabel(node.modifiedCount)}` : ''
				}`,
			);
			button.replaceChildren(twisty, folderIcon(node.path, expanded), name);
			if (modified && node.additions + node.deletions > 0) {
				button.append(treeLineStat(node.additions, node.deletions));
			} else if (modified) {
				const badge = document.createElement('span');
				badge.className = 'repository-panel__tree-badge';
				badge.dataset.modifiedCount = String(node.modifiedCount);
				badge.textContent = formatCount(node.modifiedCount);
				button.append(badge);
			} else if (!expanded) {
				const count = document.createElement('span');
				count.className = 'repository-panel__tree-count';
				count.textContent = formatCount(node.fileCount);
				button.append(count);
			}
			return button;
		}

		button.dataset.selected = String(selected);
		button.setAttribute('aria-selected', String(selected));
		button.setAttribute('aria-label', `Open ${node.path}${modified ? ', modified' : ''}`);
		button.replaceChildren(twisty, fileIcon(node.path), name);
		if (modified && node.additions + node.deletions > 0) {
			button.append(treeLineStat(node.additions, node.deletions));
		} else if (modified) {
			const marker = document.createElement('span');
			marker.className = 'repository-panel__tree-marker';
			marker.setAttribute('aria-hidden', 'true');
			marker.textContent = 'M';
			button.append(marker);
		}
		return button;
	}

	#renderChangeFileList(
		rows: readonly RepositoryChangeFileRow[],
		untrackedFileCounts: ReadonlyMap<string, number>,
	): HTMLUListElement {
		const list = document.createElement('ul');
		list.className = 'repository-panel__change-list';
		list.setAttribute('aria-label', 'Changed files');
		list.dataset.renderedRows = String(rows.length);
		list.dataset.totalRows = String(rows.length);
		for (const row of rows) {
			const item = document.createElement('li');
			item.dataset.reconcileKey = `changed:${row.path}`;
			if (isUntrackedDirectoryEntry(row.path)) {
				item.append(untrackedDirectoryChange(row.path, untrackedFileCounts.get(row.path) ?? 0));
				list.append(item);
				continue;
			}
			const selected = row.path === this.#state.diff?.path;
			const button = actionButton(row.path, 'repository-panel__change', () => {
				void this.#perform(
					'diff',
					() => this.#controller.loadDiff(row.path),
					() => {
						this.#diffOpen = true;
					},
				);
			});
			button.dataset.selected = String(selected);
			button.dataset.path = row.path;
			button.dataset.changeKind = this.#state.diffScope;
			button.setAttribute('aria-pressed', String(selected));
			button.setAttribute(
				'aria-label',
				this.#state.diffScope === 'uncommitted'
					? `Review uncommitted changes in ${row.path}`
					: `Review changes on this branch in ${row.path}`,
			);
			button.title = row.path;
			button.disabled = this.#busy !== null;

			const icon = fileIcon(row.path);
			const path = document.createElement('span');
			path.className = 'repository-panel__change-path';
			path.textContent = `⁦${row.path}⁩`;
			const stat = row.diffAvailable
				? diffStat(row.additions, row.deletions, row.noLineChange)
				: quietLabel('Modified');
			button.replaceChildren(icon, path, stat);
			item.append(button);
			list.append(item);
		}
		return list;
	}

	async #perform(
		kind: RepositoryPanelAction,
		action: () => Promise<RepositoryViewState>,
		onSuccess?: (state: RepositoryViewState) => void,
	): Promise<void> {
		if (this.#busy || !this.#controlsRepository()) return;
		const operation = ++this.#operationSequence;
		const workstreamId = this.#activeWorkstreamId;
		this.#busy = kind;
		this.#actionError = null;
		this.#render();
		try {
			const state = await action();
			if (!this.#isCurrentOperation(operation, workstreamId)) return;
			onSuccess?.(state);
		} catch (error) {
			if (!this.#isCurrentOperation(operation, workstreamId)) return;
			this.#actionError = errorMessage(error);
			await this.#api.notifications.show({
				title: 'Repository action failed',
				body: this.#actionError,
				level: 'error',
			});
		} finally {
			if (this.#isCurrentOperation(operation, workstreamId)) {
				this.#busy = null;
				this.#render();
			}
		}
	}

	#isCurrentOperation(operation: number, workstreamId: string | null): boolean {
		return operation === this.#operationSequence && workstreamId === this.#activeWorkstreamId;
	}

	#controlsRepository(): boolean {
		return this.#workstream === null || this.#workstream.id === this.#controllerWorkstreamId;
	}
}

function repositoryInteractionScope(state: RepositoryViewState): string {
	const context = state.context;
	if (!context) return '';
	return JSON.stringify([
		context.workstreamId,
		context.repositoryPath,
		context.repositoryFullName ?? null,
		context.branch,
		context.baseBranch,
		context.dirtyPaths,
		context.ahead,
		context.behind,
		state.status,
		state.localError,
	]);
}

export function repositoryTreeKeyCommand(
	key: string,
	rows: readonly RepositoryTreeRow[],
	expanded: ReadonlySet<string>,
	activePath: string | null,
): RepositoryTreeKeyCommand | null {
	const first = rows[0];
	const last = rows.at(-1);
	if (!first || !last) return null;
	const index = activePath === null ? -1 : rows.findIndex(({ node }) => node.path === activePath);
	const current = index < 0 ? null : rows[index];
	switch (key) {
		case 'ArrowDown': {
			const next = rows[index + 1];
			return next ? { kind: 'focus', path: next.node.path } : null;
		}
		case 'ArrowUp': {
			if (!current) return { kind: 'focus', path: last.node.path };
			const previous = index === 0 ? undefined : rows[index - 1];
			return previous ? { kind: 'focus', path: previous.node.path } : null;
		}
		case 'Home':
			return { kind: 'focus', path: first.node.path };
		case 'End':
			return { kind: 'focus', path: last.node.path };
		case 'ArrowRight': {
			if (!current) return { kind: 'focus', path: first.node.path };
			if (current.node.type !== 'directory') return null;
			if (!expanded.has(current.node.path)) return { kind: 'expand', path: current.node.path };
			const child = rows[index + 1];
			return child && child.depth > current.depth ? { kind: 'focus', path: child.node.path } : null;
		}
		case 'ArrowLeft': {
			if (!current) return { kind: 'focus', path: first.node.path };
			if (current.node.type === 'directory' && expanded.has(current.node.path)) {
				return { kind: 'collapse', path: current.node.path };
			}
			for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
				const candidate = rows[cursor];
				if (candidate && candidate.depth < current.depth) {
					return { kind: 'focus', path: candidate.node.path };
				}
			}
			return null;
		}
		case 'Enter':
			return current
				? { kind: 'activate', path: current.node.path }
				: { kind: 'focus', path: first.node.path };
		default:
			return null;
	}
}

export function buildRepositoryFileTree(
	paths: readonly string[],
	modifiedPaths: ReadonlySet<string> = new Set(),
	lineChanges: ReadonlyMap<string, RepositoryLineChange> = new Map(),
	untrackedFileCounts: ReadonlyMap<string, number> = new Map(),
): readonly RepositoryTreeNode[] {
	const root: MutableRepositoryTreeNode = {
		name: '',
		path: '',
		type: 'directory',
		children: new Map(),
		fileCount: 0,
		modifiedCount: 0,
		additions: 0,
		deletions: 0,
	};
	for (const path of paths) {
		const parts = path.split('/').filter(Boolean);
		let cursor = root;
		for (let index = 0; index < parts.length; index += 1) {
			const name = parts[index];
			if (!name) continue;
			const leaf = index === parts.length - 1;
			const untracked = leaf && isUntrackedDirectoryEntry(path);
			const nodePath = `${parts.slice(0, index + 1).join('/')}${untracked ? '/' : ''}`;
			const type = untracked ? 'untracked-directory' : leaf ? 'file' : 'directory';
			let node = cursor.children.get(name);
			if (!node) {
				node = {
					name,
					path: nodePath,
					type,
					children: new Map(),
					fileCount: 0,
					modifiedCount: 0,
					additions: 0,
					deletions: 0,
				};
				cursor.children.set(name, node);
			} else if (type === 'directory') {
				node.type = 'directory';
			}
			cursor = node;
		}
	}
	return finalizeRepositoryTree(root.children, modifiedPaths, lineChanges, untrackedFileCounts);
}

function expandedTreeIconIds(
	nodes: readonly RepositoryTreeNode[],
	depth = Number.POSITIVE_INFINITY,
): string[] {
	const ids = new Set<string>();
	const walk = (list: readonly RepositoryTreeNode[], remaining: number): void => {
		for (const node of list) {
			if (node.type === 'file') {
				ids.add(fileIconIdFor(node.path));
				continue;
			}
			if (node.type === 'untracked-directory') {
				ids.add(folderIconIdFor(node.path));
				continue;
			}
			ids.add(folderIconIdFor(node.path, { expanded: remaining > 0 }));
			if (remaining > 0) walk(node.children, remaining - 1);
		}
	};
	walk(nodes, depth);
	return [...ids];
}

export function directoryPaths(nodes: readonly RepositoryTreeNode[]): readonly string[] {
	const paths: string[] = [];
	const walk = (list: readonly RepositoryTreeNode[]): void => {
		for (const node of list) {
			if (node.type !== 'directory') continue;
			paths.push(node.path);
			walk(node.children);
		}
	};
	walk(nodes);
	return paths;
}

function ancestorDirectoryPaths(path: string): readonly string[] {
	const segments = path.split('/').slice(0, -1);
	return segments.map((_, index) => segments.slice(0, index + 1).join('/'));
}

function treeRowIconIds(
	rows: readonly RepositoryTreeRow[],
	expanded: ReadonlySet<string>,
): readonly string[] {
	return rows.map(({ node }) =>
		node.type === 'file'
			? fileIconIdFor(node.path)
			: folderIconIdFor(node.path, { expanded: expanded.has(node.path) }),
	);
}

export function flattenRepositoryTree(
	nodes: readonly RepositoryTreeNode[],
	expanded: ReadonlySet<string>,
): readonly RepositoryTreeRow[] {
	const rows: RepositoryTreeRow[] = [];
	const visit = (node: RepositoryTreeNode, depth: number): void => {
		rows.push({ node, depth });
		if (node.type === 'directory' && expanded.has(node.path)) {
			for (const child of node.children) visit(child, depth + 1);
		}
	};
	for (const node of nodes) visit(node, 0);
	return rows;
}

const FILE_ICON_SIZE = 14;

function iconImage(icon: string, className: string): HTMLImageElement {
	const image = document.createElement('img');
	image.src = fileIconUrl(icon);
	image.className = className;
	image.alt = '';
	image.draggable = false;
	image.width = FILE_ICON_SIZE;
	image.height = FILE_ICON_SIZE;
	image.setAttribute('aria-hidden', 'true');
	image.dataset.fileIcon = icon;
	return image;
}

export function fileIcon(path: string): HTMLImageElement {
	return iconImage(fileIconIdFor(path), 'repository-panel__file-icon');
}

export function folderIcon(path: string, expanded: boolean): HTMLImageElement {
	return iconImage(folderIconIdFor(path, { expanded }), 'repository-panel__folder');
}

function finalizeRepositoryTree(
	children: ReadonlyMap<string, MutableRepositoryTreeNode>,
	modifiedPaths: ReadonlySet<string>,
	lineChanges: ReadonlyMap<string, RepositoryLineChange>,
	untrackedFileCounts: ReadonlyMap<string, number>,
): readonly RepositoryTreeNode[] {
	return [...children.values()]
		.map((node): RepositoryTreeNode => {
			const childNodes = finalizeRepositoryTree(
				node.children,
				modifiedPaths,
				lineChanges,
				untrackedFileCounts,
			);
			const file = node.type !== 'directory';
			const ownLines =
				file && modifiedPaths.has(node.path) ? lineChanges.get(node.path) : undefined;
			return {
				name: node.name,
				path: node.path,
				type: node.type,
				children: childNodes,
				fileCount:
					node.type === 'untracked-directory'
						? (untrackedFileCounts.get(node.path) ?? 0)
						: file
							? 1
							: childNodes.reduce((total, child) => total + child.fileCount, 0),
				modifiedCount: file
					? modifiedPaths.has(node.path)
						? 1
						: 0
					: childNodes.reduce((total, child) => total + child.modifiedCount, 0),
				additions: file
					? (ownLines?.additions ?? 0)
					: childNodes.reduce((total, child) => total + child.additions, 0),
				deletions: file
					? (ownLines?.deletions ?? 0)
					: childNodes.reduce((total, child) => total + child.deletions, 0),
			};
		})
		.sort((left, right) => {
			if (left.type !== right.type) return left.type === 'directory' ? -1 : 1;
			return left.name.localeCompare(right.name, undefined, {
				numeric: true,
				sensitivity: 'base',
			});
		});
}

function renderDiffView(diff: RepositoryViewState['diff'] & {}, close: () => void): HTMLElement {
	const view = document.createElement('section');
	view.className = 'repository-panel__diff-view';
	view.dataset.path = diff.path;
	view.setAttribute('aria-label', `Changes in ${diff.path}`);

	const header = document.createElement('div');
	header.className = 'repository-panel__preview-header';
	const back = actionButton(
		'Back to files',
		'repository-panel__preview-back malini-panel-icon-button malini-panel-quiet-button',
		close,
	);
	back.setAttribute('aria-label', 'Back to repository files');
	back.title = 'Back to files';
	back.dataset.command = 'close-diff';
	back.replaceChildren(svgIcon('arrow-left'));
	const label = document.createElement('p');
	label.className = 'repository-panel__section-label';
	label.textContent = diff.path;
	label.title = diff.path;
	header.append(
		back,
		fileIcon(diff.path),
		label,
		diffStat(diff.additions, diff.deletions, diff.noLineChange),
	);

	view.append(header, renderUnifiedDiff(diff));
	return view;
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const PANEL_ICON_PATHS: Record<PanelIconName, readonly string[]> = {
	'arrow-left': ['m15 18-6-6 6-6'],
	'chevron-right': ['m9 18 6-6-6-6'],
	'git-branch': [
		'M6 3v12',
		'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
		'M21 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
		'M18 9a9 9 0 0 1-9 9',
	],
	x: ['M18 6 6 18', 'm6 6 12 12'],
};

const iconTemplates = new WeakMap<Document, Map<PanelIconName, SVGSVGElement>>();

function svgIcon(name: PanelIconName): SVGSVGElement {
	let templates = iconTemplates.get(document);
	if (!templates) {
		templates = new Map();
		iconTemplates.set(document, templates);
	}
	const cached = templates.get(name);
	if (cached) return cloneSvgRoot(cached);
	const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('fill', 'none');
	svg.setAttribute('stroke', 'currentColor');
	svg.setAttribute('stroke-width', '2');
	svg.setAttribute('stroke-linecap', 'round');
	svg.setAttribute('stroke-linejoin', 'round');
	svg.setAttribute('aria-hidden', 'true');
	for (const data of PANEL_ICON_PATHS[name]) {
		const path = document.createElementNS(SVG_NAMESPACE, 'path');
		path.setAttribute('d', data);
		svg.append(path);
	}
	templates.set(name, svg);
	return cloneSvgRoot(svg);
}

function isSvgRoot(node: Node): node is SVGSVGElement {
	return node.nodeType === node.ELEMENT_NODE && node.nodeName === 'svg';
}

function cloneSvgRoot(svg: SVGSVGElement): SVGSVGElement {
	const clone = svg.cloneNode(true);
	if (!isSvgRoot(clone)) throw new Error('SVG clone is missing its root element');
	return clone;
}

export function changeSummary(
	state: Pick<RepositoryViewState, 'changedFiles' | 'additions' | 'deletions'>,
): string {
	if (state.changedFiles === 0) return 'No changed files';
	return `${state.changedFiles} changed file${state.changedFiles === 1 ? '' : 's'} · +${state.additions} −${state.deletions}`;
}

export type RepositoryChangeFileRow = Readonly<{
	path: string;
	changed: boolean;
	diffAvailable: boolean;
	additions: number;
	deletions: number;
	noLineChange: RepositoryDiffNoLineChange | null;
}>;

export function repositoryScopedChangeRows(
	diffs: readonly RepositoryViewState['diffs'][number][],
	dirtyPaths: readonly string[],
): readonly RepositoryChangeFileRow[] {
	const diffByPath = new Map(diffs.map((diff) => [diff.path, diff]));
	const changedPaths = new Set([...dirtyPaths, ...diffs.map(({ path }) => path)]);
	return [...changedPaths]
		.sort((left, right) => left.localeCompare(right))
		.map((path) => {
			const diff = diffByPath.get(path);
			return {
				path,
				changed: true,
				diffAvailable: Boolean(diff),
				additions: diff?.additions ?? 0,
				deletions: diff?.deletions ?? 0,
				noLineChange: diff?.noLineChange ?? null,
			};
		});
}

export function repositoryChangeFileRows(
	state: Pick<RepositoryViewState, 'files' | 'diffs' | 'context'>,
): readonly RepositoryChangeFileRow[] {
	const changed = repositoryScopedChangeRows(state.diffs, state.context?.dirtyPaths ?? []);
	const changedPaths = new Set(changed.map(({ path }) => path));
	const unchanged = state.files
		.filter(({ path }) => !changedPaths.has(path))
		.map(({ path }) => ({
			path,
			changed: false,
			diffAvailable: false,
			additions: 0,
			deletions: 0,
			noLineChange: null,
		}));
	return [...changed, ...unchanged];
}

function repositoryPanelProjection(
	previous: RepositoryPanelProjection | null,
	state: RepositoryViewState,
): RepositoryPanelProjection {
	const key = JSON.stringify([
		state.context?.workstreamId ?? '',
		state.files.map(({ path }) => path),
		state.context?.dirtyPaths ?? [],
		state.diffs.map(({ path, additions, deletions }) => [path, additions, deletions]),
		state.uncommitted.diffs.map(({ path, additions, deletions }) => [path, additions, deletions]),
	]);
	if (previous?.key === key) return previous;

	const changed = repositoryChangeFileRows(state).filter((row) => row.changed);
	const files = state.files.map(({ path }) => path);
	const dirtyPaths = state.context?.dirtyPaths ?? [];
	const uncommittedChanged = repositoryScopedChangeRows(state.uncommitted.diffs, dirtyPaths);
	const untrackedDirectories = dirtyPaths.filter(isUntrackedDirectoryEntry);
	const insideUntrackedDirectory = (path: string): boolean =>
		untrackedDirectories.some((directory) => path.startsWith(directory));
	const modified = new Set(uncommittedChanged.map(({ path }) => path));
	const lineChanges = new Map(
		uncommittedChanged.map(({ path, additions, deletions }) => [path, { additions, deletions }]),
	);
	const modifiedFiles = files.filter((path) => modified.has(path));
	const untrackedFileCounts = new Map(
		untrackedDirectories.map((directory) => [
			directory,
			files.filter((path) => path.startsWith(directory)).length,
		]),
	);
	const projection: RepositoryPanelProjection = {
		key,
		changed,
		uncommittedChanged,
		untrackedFileCounts,
		modifiedFiles,
		files,
		tree: buildRepositoryFileTree(
			files,
			new Set([...modified, ...files.filter(insideUntrackedDirectory)]),
			lineChanges,
		),
		changedTree: buildRepositoryFileTree(
			[...modifiedFiles, ...untrackedDirectories],
			modified,
			lineChanges,
			untrackedFileCounts,
		),
	};
	return projection;
}

function isUntrackedDirectoryEntry(path: string): boolean {
	return path.endsWith('/');
}

function untrackedDirectoryChange(path: string, fileCount: number): HTMLElement {
	const row = document.createElement('div');
	row.className = 'repository-panel__change repository-panel__change--untracked';
	row.dataset.path = path;
	row.title = 'Untracked directory, too large to show changes';
	const label = document.createElement('span');
	label.className = 'repository-panel__change-path';
	label.textContent = `⁦${path}⁩`;
	row.append(folderIcon(path, false), label, quietLabel(fileCountLabel(fileCount)));
	return row;
}

function fileCountLabel(count: number): string {
	return `${formatCount(count)} file${count === 1 ? '' : 's'}`;
}

function repositoryPanelRenderIdentity(
	state: RepositoryViewState,
	projection: RepositoryPanelProjection,
): string {
	const populated = projection.changed.length > 0 || projection.files.length > 0;
	const diff = state.diff;
	const scope = [state.diffScope, state.uncommitted.additions, state.uncommitted.deletions];
	const agentSessionDiff = state.agentSessionDiff;
	const context = state.context;
	return [
		projection.key,
		...scope,
		populated ? 'populated' : state.status,
		context?.repositoryFullName ?? context?.repositoryPath ?? '',
		context?.branch ?? '',
		context?.baseBranch ?? '',
		context?.ahead ?? '',
		context?.behind ?? '',
		state.additions,
		state.deletions,
		state.error ?? '',
		state.localError ?? '',
		state.selectedPath ?? '',
		state.selectedContents ?? '',
		diff?.path ?? '',
		diff?.additions ?? '',
		diff?.deletions ?? '',
		...(diff?.lines.map(
			(line) => `${line.kind}:${line.oldLine ?? ''}:${line.newLine ?? ''}:${line.text}`,
		) ?? []),
		agentSessionDiff?.sessionId ?? '',
		agentSessionDiff?.path ?? '',
		agentSessionDiff?.additions ?? '',
		agentSessionDiff?.deletions ?? '',
		...(agentSessionDiff
			? [
					...agentSessionDiff.contributingRunIds,
					agentSessionDiff.net.beforeCommit,
					agentSessionDiff.net.afterCommit,
					agentSessionDiff.net.capturedAt,
					...(agentSessionDiff.net.diff?.lines.map(
						(line) => `${line.kind}:${line.oldLine ?? ''}:${line.newLine ?? ''}:${line.text}`,
					) ?? []),
					...agentSessionDiff.turns.flatMap((turn) => [
						turn.runId,
						turn.turn,
						turn.title ?? '',
						turn.beforeCommit,
						turn.afterCommit,
						...(turn.diff?.lines.map(
							(line) => `${line.kind}:${line.oldLine ?? ''}:${line.newLine ?? ''}:${line.text}`,
						) ?? []),
					]),
				]
			: []),
	].join('\u001f');
}

function agentSessionSection(
	label: string,
	beforeCommit: string,
	afterCommit: string,
	diff: RepositoryDiff | null,
	emptyText: string,
): HTMLElement {
	const article = document.createElement('article');
	article.className = 'repository-panel__agent-session-run';
	const header = document.createElement('div');
	header.className = 'repository-panel__agent-session-run-header';
	const heading = document.createElement('h3');
	heading.textContent = label;
	heading.title = label;
	const commits = document.createElement('code');
	commits.textContent = `${shortRevision(beforeCommit)} → ${shortRevision(afterCommit)}`;
	commits.title = `${beforeCommit} → ${afterCommit}`;
	header.append(heading, commits);
	article.append(header);
	if (!diff || diff.lines.length === 0) {
		const empty = document.createElement('p');
		empty.className = 'repository-panel__agent-session-empty';
		empty.textContent = emptyText;
		article.append(empty);
	} else {
		article.append(renderUnifiedDiff(diff));
	}
	return article;
}

function shortRevision(revision: string): string {
	return revision.slice(0, 7);
}

function renderUnifiedDiff(diff: RepositoryViewState['diff'] & {}): HTMLElement {
	const section = document.createElement('section');
	section.className = 'repository-panel__diff';
	section.setAttribute('aria-label', `Changes in ${diff.path}`);
	if (diff.lines.length === 0) {
		const statement = document.createElement('p');
		statement.className = 'repository-panel__diff-statement';
		statement.textContent = REPOSITORY_NO_LINE_CHANGE_STATEMENT[diff.noLineChange ?? 'empty'];
		section.append(statement);
		return section;
	}
	const table = document.createElement('table');
	table.className = 'repository-panel__diff-table';
	const caption = document.createElement('caption');
	caption.className = 'repository-panel__sr-only';
	caption.textContent = `Unified diff for ${diff.path}`;
	const body = document.createElement('tbody');
	for (const line of diff.lines) {
		const row = document.createElement('tr');
		row.dataset.kind = line.kind;
		for (const number of [line.oldLine, line.newLine]) {
			const cell = document.createElement('td');
			cell.className = 'repository-panel__line-number';
			cell.textContent = number === null ? '' : String(number);
			cell.setAttribute('aria-hidden', 'true');
			row.append(cell);
		}
		const source = document.createElement('td');
		source.className = 'repository-panel__line';
		const code = document.createElement('code');
		code.className = 'code-tokens';
		const prefix = document.createElement('span');
		prefix.className = 'repository-panel__diff-prefix';
		prefix.textContent = `${line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '−' : ' '} `;
		code.append(prefix, ...tokenSpans(highlightLine(diff.path, line.text)));
		source.append(code);
		row.append(source);
		body.append(row);
	}
	table.append(caption, body);
	section.append(table);
	return section;
}

function actionButton(label: string, className: string, action: () => void): HTMLButtonElement {
	const button = document.createElement('button');
	button.type = 'button';
	button.className = className;
	button.textContent = label;
	bindEvent(button, 'click', action);
	return button;
}

function treeLineStat(additions: number, deletions: number): HTMLElement {
	const stat = document.createElement('span');
	stat.className = 'repository-panel__tree-stat';
	stat.dataset.additions = String(additions);
	stat.dataset.deletions = String(deletions);
	stat.setAttribute(
		'aria-label',
		`${formatCount(additions)} additions, ${formatCount(deletions)} deletions`,
	);
	if (additions > 0) {
		const added = document.createElement('span');
		added.dataset.tone = 'addition';
		added.textContent = `+${compactCount(additions)}`;
		stat.append(added);
	}
	if (deletions > 0) {
		const removed = document.createElement('span');
		removed.dataset.tone = 'deletion';
		removed.textContent = `−${compactCount(deletions)}`;
		stat.append(removed);
	}
	return stat;
}

const COMPACT_COUNT_UNITS = [
	{ divisor: 1_000_000_000, suffix: 'b' },
	{ divisor: 1_000_000, suffix: 'm' },
	{ divisor: 1_000, suffix: 'k' },
] as const;

export function compactCount(total: number): string {
	const normalized = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
	let unitIndex = COMPACT_COUNT_UNITS.findIndex(({ divisor }) => normalized >= divisor);
	if (unitIndex < 0) return String(normalized);
	let unit = COMPACT_COUNT_UNITS[unitIndex]!;
	let compact = Math.round((normalized / unit.divisor) * 10) / 10;
	if (compact >= 1_000 && unitIndex > 0) {
		unitIndex -= 1;
		unit = COMPACT_COUNT_UNITS[unitIndex]!;
		compact = Math.round((normalized / unit.divisor) * 10) / 10;
	}
	return `${Number.isInteger(compact) ? compact : compact.toFixed(1)}${unit.suffix}`;
}

function diffStat(
	additions: number,
	deletions: number,
	noLineChange: RepositoryDiffNoLineChange | null = null,
): HTMLElement {
	if (noLineChange) return quietLabel(REPOSITORY_NO_LINE_CHANGE_LABEL[noLineChange]);
	const stat = document.createElement('span');
	stat.className = 'repository-panel__stat';
	if (additions > 0 || deletions === 0) {
		const added = document.createElement('span');
		added.dataset.tone = 'addition';
		added.textContent = `+${formatCount(additions)}`;
		stat.append(added);
	}
	if (deletions > 0 || additions === 0) {
		const removed = document.createElement('span');
		removed.dataset.tone = 'deletion';
		removed.textContent = `−${formatCount(deletions)}`;
		stat.append(removed);
	}
	return stat;
}

function quietLabel(text: string): HTMLElement {
	const label = document.createElement('span');
	label.className = 'repository-panel__stat';
	label.textContent = text;
	return label;
}

function statusMessage(message: string): HTMLElement {
	const status = document.createElement('p');
	status.className = 'repository-panel__status malini-panel-meta';
	status.setAttribute('role', 'status');
	status.textContent = message;
	return status;
}

function emptyState(message: string, detail: string | null = null): HTMLElement {
	const empty = document.createElement('div');
	empty.className = 'repository-panel__empty malini-panel-empty';
	const figure = svgIcon('git-branch');
	figure.classList.add('malini-panel-empty-figure');
	const heading = document.createElement('p');
	heading.className = 'malini-panel-empty-heading';
	heading.textContent = message;
	empty.append(figure, heading);
	if (detail) {
		const note = document.createElement('p');
		note.className = 'repository-panel__empty-detail malini-panel-meta';
		note.textContent = detail;
		empty.append(note);
	}
	return empty;
}

function panelAlertText(message: string): string {
	if (repositoryGithubSession(message) !== 'reconnect-required') return message;
	return 'The GitHub session for this repository has expired. Use Reconnect GitHub on the top bar to sign in again.';
}

function changeCountLabel(count: number): string {
	return `${formatCount(count)} changed file${count === 1 ? '' : 's'}`;
}

function modifiedCountLabel(count: number): string {
	return `${formatCount(count)} modified file${count === 1 ? '' : 's'}`;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

const REPOSITORY_PANEL_STYLES = `
		.repository-panel__identity {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		overflow: hidden;
	}
	.repository-panel__repository-name {
		overflow: hidden;
		color: var(--color-fg-default);
		font-size: var(--text-xs);
		font-weight: 500;
		line-height: var(--text-xs--line-height);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.repository-panel__repository-name--stat {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
	}
	.repository-panel__stat-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.repository-panel__branch {
		display: flex;
		min-width: 0;
		max-width: 100%;
		align-items: baseline;
		gap: 0.25rem;
		overflow: hidden;
		color: var(--color-fg-tertiary);
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		line-height: var(--text-2xs--line-height);
	}
	.repository-panel__branch-head,
	.repository-panel__branch-base {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.repository-panel__branch-head { flex: 0 1 auto; color: var(--color-fg-secondary); }
	.repository-panel__branch-base { flex: 0 2 auto; }
	.repository-panel__branch-sync {
		flex: none;
		margin-left: auto;
		padding-left: 0.5rem;
		color: var(--color-fg-secondary);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.repository-panel__content {
		display: flex;
		min-height: 0;
		flex: 1;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0 0.875rem 0.875rem;
		overflow: auto;
	}
	.repository-panel[data-repository-panel='files'] .repository-panel__content,
	.repository-panel[data-repository-panel='changes'] .repository-panel__content {
		gap: 0;
		padding: 0;
		overflow: hidden;
	}
	.repository-panel[data-repository-panel='files'] > .repository-panel__content > .repository-panel__alert,
	.repository-panel[data-repository-panel='changes'] > .repository-panel__content > .repository-panel__alert {
		margin: 0.5rem 0.625rem 0;
	}
	.repository-panel__files-section {
		display: flex;
		min-height: 0;
		flex-direction: column;
		background: transparent;
	}
	.repository-panel__files-section--changed {
		flex: 1;
		padding: 0.25rem 0.375rem;
		background: transparent;
		overflow-y: auto;
	}
	.repository-panel__files-section--all { flex: 1; }

	.repository-panel__section-band {
		display: flex;
		flex: none;
		align-items: center;
		gap: 0.25rem;
		padding-right: 0.625rem;
	}
	.repository-panel__section-band .repository-panel__section-toggle {
		min-width: 0;
		flex: 1;
		padding-right: 0.5rem;
	}
	.repository-panel__scope-chip-count {
		color: var(--color-fg-tertiary);
		font-variant-numeric: tabular-nums;
	}
	.repository-panel__section-toggle {
		display: flex;
		width: 100%;
		min-height: 2.25rem;
		flex: none;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		border: 0;
		padding: 0.25rem 1rem 0.25rem 0.75rem;
		background: transparent;
		color: var(--color-fg-tertiary);
		text-align: left;
	}
	.repository-panel__section-toggle:hover { background: var(--color-surface-50-hover); }
	.repository-panel__section-toggle-label {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.25rem;
		font-size: var(--text-xs);
		font-weight: 500;
	}
	.repository-panel__section-chevron {
		width: 0.75rem;
		height: 0.75rem;
		flex: none;
		color: var(--color-fg-tertiary);
		transition: transform 140ms ease;
	}
	.repository-panel__section-toggle[aria-expanded='true'] .repository-panel__section-chevron {
		transform: rotate(90deg);
	}
	.repository-panel__section-summary,
	.repository-panel__stat {
		display: flex;
		flex: none;
		align-items: baseline;
		gap: 0.375rem;
		color: var(--color-fg-tertiary);
		font-size: var(--text-2xs);
		font-variant-numeric: tabular-nums;
	}
	.repository-panel__stat { font-family: var(--font-mono); }
	.repository-panel__stat [data-tone='addition'] { color: var(--color-success-content); }
	.repository-panel__stat [data-tone='deletion'] { color: var(--color-error-content); }
	.repository-panel button:not(:disabled) { cursor: pointer; }

	.repository-panel__change-list {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.repository-panel__change {
		display: flex;
		width: 100%;
		min-height: 2rem;
		align-items: center;
		gap: 0.5rem;
		border: 0;
		border-radius: var(--radius-lg);
		padding: 0 0.5rem;
		background: transparent;
		font-size: var(--text-sm);
		text-align: left;
		transition: background-color 120ms ease;
	}
	.repository-panel__change:hover { background: var(--color-surface-50-hover); }
	.repository-panel__change--untracked:hover { background: transparent; }
	.repository-panel__change[data-selected='true'] { background: var(--color-surface-50-selected); }
	.repository-panel__change-path {
		min-width: 0;
		flex: 1 1 auto;
		overflow: hidden;
		direction: rtl;
		color: var(--color-fg-default);
		text-align: left;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.repository-panel__change .repository-panel__stat { margin-left: auto; padding-left: 0.375rem; }

	.repository-panel__tree {
		--tree-indent: 1rem;
		display: flex;
		min-height: 0;
		flex: 1;
		flex-direction: column;
		padding: 0.125rem 0.375rem 0.5rem;
		background: transparent;
		overflow-y: auto;
	}
	.repository-panel__tree-row {
		--tree-depth: 0;
		display: flex;
		width: 100%;
		height: 1.75rem;
		min-height: 1.75rem;
		align-items: center;
		gap: 0.5rem;
		border: 0;
		border-radius: var(--radius-lg);
		padding-right: 0.75rem;
		padding-left: calc(0.5rem + var(--tree-depth) * var(--tree-indent));
		background-color: transparent;
		background-image: repeating-linear-gradient(
			to right,
			color-mix(in srgb, var(--color-border-subtle) 80%, transparent) 0 1px,
			transparent 1px var(--tree-indent)
		);
		background-position: calc(1rem - 1px) 0;
		background-repeat: no-repeat;
		background-size: 0 100%;
		text-align: left;
	}
	.repository-panel__tree:hover .repository-panel__tree-row {
		background-size: calc(var(--tree-depth) * var(--tree-indent)) 100%;
	}
	.repository-panel__tree-row:hover,
	.repository-panel__tree-row:focus-visible { background-color: var(--color-surface-50-hover); }
	.repository-panel__tree-row[data-selected='true'] { background-color: var(--color-surface-50-selected); }
	.repository-panel__tree-row:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--color-brand) 55%, transparent);
		outline-offset: -2px;
	}
	.repository-panel__twisty {
		display: grid;
		width: 1rem;
		height: 1rem;
		flex: none;
		place-items: center;
		color: var(--color-fg-tertiary);
	}
	.repository-panel__twisty svg { width: 0.75rem; height: 0.75rem; transition: transform 140ms ease; }
	.repository-panel__directory[aria-expanded='true'] .repository-panel__twisty svg { transform: rotate(90deg); }
	.repository-panel__directory:hover .repository-panel__twisty { color: var(--color-fg-secondary); }
	.repository-panel__folder,
	.repository-panel__file-icon {
		width: 1rem;
		height: 1rem;
		flex: none;
		object-fit: contain;
		user-select: none;
	}
	.repository-panel__tree-name {
		min-width: 0;
		flex: 1;
		overflow: hidden;
		color: var(--color-fg-secondary);
		font-size: var(--text-sm);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.repository-panel__directory .repository-panel__tree-name { color: var(--color-fg-default); }
	.repository-panel__tree-row:hover .repository-panel__tree-name,
	.repository-panel__tree-row:focus-visible .repository-panel__tree-name,
	.repository-panel__tree-row[data-selected='true'] .repository-panel__tree-name { color: var(--color-fg-default); }
	.repository-panel__tree-row[data-modified='true'] .repository-panel__tree-name { color: var(--syntax-modified); }
	.repository-panel__tree-count {
		flex: none;
		color: var(--color-fg-tertiary);
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		font-variant-numeric: tabular-nums;
	}
	.repository-panel__tree-badge {
		flex: none;
		min-width: 1rem;
		padding: 0 0.3125rem;
		border-radius: 999px;
		background: color-mix(in srgb, var(--syntax-modified) 18%, transparent);
		color: var(--color-fg-secondary);
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		font-variant-numeric: tabular-nums;
		line-height: 1rem;
		text-align: center;
	}
	.repository-panel__tree-stat {
		display: flex;
		flex: none;
		gap: 0.25rem;
		font-family: var(--font-mono);
		font-size: var(--text-3xs);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
		line-height: 1rem;
	}
	.repository-panel__tree-stat [data-tone='addition'] { color: var(--color-success-content); }
	.repository-panel__tree-stat [data-tone='deletion'] { color: var(--color-error-content); }
	.repository-panel__tree-marker {
		flex: none;
		color: var(--syntax-modified);
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		line-height: 1rem;
	}
	.repository-panel__status,
	.repository-panel__alert { margin: 0; }
	.repository-panel__files-section--all > .repository-panel__status { padding: 0 1rem 0.5rem 0.75rem; }
	.repository-panel__empty-detail { margin: 0; max-width: 22rem; }
	.repository-panel__header-controls {
		display: flex;
		flex: none;
		align-items: center;
		gap: 0.25rem;
	}
	.repository-panel__scope-chip {
		display: inline-flex;
		height: 1.5rem;
		align-items: center;
		gap: 0.25rem;
		border: 0;
		border-radius: 0.375rem;
		padding: 0 0.5rem;
		background: transparent;
		color: var(--color-fg-tertiary);
		font: inherit;
		font-size: var(--text-2xs);
		cursor: pointer;
		white-space: nowrap;
	}
	.repository-panel__scope-chip:hover { color: var(--color-fg-secondary); }
	.repository-panel__scope-chip--active {
		background: var(--color-surface-200);
		color: var(--color-fg-default);
	}
	.repository-panel__scope-chip--active:hover { color: var(--color-fg-default); }
	.repository-panel__scope-chip svg { width: 0.75rem; height: 0.75rem; }
	.repository-panel__alert {
		flex: none;
		border-radius: 0.5rem;
		padding: 0.5rem 0.625rem;
		background: color-mix(in srgb, var(--color-accent-2-primary) 10%, transparent);
		color: var(--color-accent-2-primary);
		font-size: var(--text-2xs);
	}
	.repository-panel__diff-view,
	.repository-panel__agent-session-diff {
		display: flex;
		min-height: 0;
		flex: 1;
		flex-direction: column;
		background: transparent;
		overflow: hidden;
	}
	.repository-panel__agent-session-runs {
		display: flex;
		min-height: 0;
		flex: 1;
		flex-direction: column;
		gap: 0.625rem;
		padding: 0.625rem;
		overflow: auto;
	}
	.repository-panel__agent-session-run {
		display: flex;
		flex: none;
		flex-direction: column;
		gap: 0.375rem;
	}
	.repository-panel__agent-session-run-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		color: var(--color-fg-tertiary);
		font-size: var(--text-2xs);
	}
	.repository-panel__agent-session-run-header h3 {
		min-width: 0;
		margin: 0;
		overflow: hidden;
		color: var(--color-fg-secondary);
		font-size: inherit;
		font-weight: 500;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.repository-panel__agent-session-run-header code {
		flex: none;
	}
	.repository-panel__agent-session-run-header code {
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
	}
	.repository-panel__agent-session-run .repository-panel__diff {
		min-height: 0;
		flex: none;
	}
	.repository-panel__agent-session-empty {
		margin: 0;
		border: 1px solid var(--color-border-subtle);
		border-radius: 0.5rem;
		padding: 0.75rem;
		color: var(--color-fg-tertiary);
		font-size: var(--text-2xs);
	}
	.repository-panel__preview-header {
		display: flex;
		height: 2.25rem;
		min-height: 2.25rem;
		align-items: center;
		gap: 0.375rem;
		border-bottom: 1px solid var(--color-surface-50-border);
		background: transparent;
		padding-inline: 0.75rem;
	}
	.repository-panel__preview-back {
		display: grid;
		width: 1.75rem;
		height: 1.75rem;
		flex: none;
		place-items: center;
		border: 0;
		border-radius: 0.375rem;
		padding: 0;
		background: transparent;
		color: var(--color-fg-tertiary);
	}
	.repository-panel__section-label {
		min-width: 0;
		flex: 1;
		margin: 0;
		overflow: hidden;
		padding: 0;
		color: var(--color-fg-default);
		font-family: var(--font-mono);
		font-size: var(--text-2xs);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.repository-panel__diff { min-height: 0; flex: 1; overflow: auto; }
	.repository-panel__diff-statement { margin: 0; padding: 0.75rem; color: var(--color-fg-tertiary); font-size: var(--text-2xs); line-height: 1.55; }
	.repository-panel__diff-table { width: 100%; border-collapse: collapse; font-family: var(--font-mono); font-size: var(--text-2xs); line-height: 1.55; }
	.repository-panel__diff-table td { padding-block: 0.0625rem; vertical-align: top; }
	.repository-panel__line-number { width: 2.25rem; padding-inline: 0.375rem !important; color: var(--color-fg-tertiary); text-align: right; user-select: none; }
	.repository-panel__line { width: 100%; padding-inline: 0.5rem; white-space: pre-wrap; overflow-wrap: anywhere; }
	.repository-panel__diff-prefix { color: var(--color-fg-tertiary); user-select: none; }
	.repository-panel__diff-table tr[data-kind='addition'] { background: color-mix(in srgb, var(--code-added) 8%, transparent); }
	.repository-panel__diff-table tr[data-kind='deletion'] { background: color-mix(in srgb, var(--code-removed) 8%, transparent); }
	.repository-panel__sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
	@media (prefers-reduced-motion: reduce) {
		.repository-panel__tree-row,
		.repository-panel__change,
		.repository-panel__twisty svg,
		.repository-panel__section-chevron { transition: none; }
	}
`;
