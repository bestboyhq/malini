import type { ExtensionDisposable } from './types.js';

const PANEL_SCOPE = ':where([data-malini-extension], [data-malini-extension] *)';
const PANEL_ROOT = ':where([data-malini-extension])';
const PANEL_CONTROLS = ':where(button, input, select, textarea, summary)';

export const EXTENSION_PANEL_BASE_STYLE_ID = 'malini.panel-kit';

export const EXTENSION_PANEL_BASE_STYLES = `
${PANEL_SCOPE},
${PANEL_SCOPE}::before,
${PANEL_SCOPE}::after {
	box-sizing: border-box;
}

${PANEL_ROOT} ${PANEL_CONTROLS} {
	font: inherit;
	color: inherit;
}

${PANEL_ROOT} :where(button, input, select, textarea, summary, [tabindex]):focus-visible {
	outline: 2px solid var(--color-brand);
	outline-offset: 1px;
}

${PANEL_ROOT} :where(button, input, select, textarea):disabled {
	cursor: default;
	opacity: 0.5;
}

${PANEL_SCOPE}.malini-panel-column {
	display: flex;
	min-height: 0;
	height: 100%;
	flex-direction: column;
	color: var(--color-fg-default);
	font: inherit;
}

${PANEL_SCOPE}.malini-panel-row {
	display: flex;
	align-items: center;
}

${PANEL_SCOPE}.malini-panel-row-split {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.75rem;
}

/*
   The bar a panel puts its summary and its controls on. Two first-party panels
   had already written this block character for character, which is how it got
   here: a shape every panel needs belongs to the kit, not to whichever panel
   invented it first.
*/
${PANEL_SCOPE}.malini-panel-header {
	display: flex;
	min-height: 2.75rem;
	align-items: center;
	gap: 0.5rem;
	border-bottom: 1px solid var(--color-border-subtle);
	padding: 0.375rem 0.75rem 0.375rem 1rem;
}

/*
   A panel with nothing in it, centered in the space it owns rather than parked
   under the header. This is one of the most-seen frames in the product - every
   panel is empty before it has anything to say - so it is drawn as a state with
   a figure, and it is one state so that two panels cannot answer the same
   nothing in two different shapes.

   A zero min-height with flex: 1 is what lets it claim the leftover space
   inside a malini-panel-column without pushing the panel taller than its drawer.
*/
${PANEL_SCOPE}.malini-panel-empty {
	display: flex;
	min-height: 0;
	flex: 1;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 0.75rem;
	padding: 2rem 1.5rem;
	text-align: center;
}

/*
   Large and quiet. The figure makes the frame legible at a glance, it is not
   there to be read - so it takes the tertiary rung. The stroke stays at the
   set's single width: every icon in the app is drawn at 2.
*/
${PANEL_SCOPE}.malini-panel-empty-figure {
	width: 2.5rem;
	height: 2.5rem;
	color: var(--color-fg-tertiary);
	stroke-width: 2;
}

${PANEL_SCOPE}.malini-panel-empty-heading {
	margin: 0;
	max-width: 22rem;
	color: var(--color-fg-secondary);
	font-size: var(--text-sm);
	line-height: var(--text-sm--line-height);
}

${PANEL_SCOPE}.malini-panel-caption {
	color: var(--color-fg-secondary);
	font-size: var(--text-xs);
}

${PANEL_SCOPE}.malini-panel-meta {
	color: var(--color-fg-tertiary);
	font-size: var(--text-2xs);
}

${PANEL_SCOPE}.malini-panel-tint {
	background: var(--color-surface-100);
	box-shadow: inset 0 0 0 1px var(--color-surface-100-border);
	color: var(--color-fg-secondary);
}

${PANEL_SCOPE}.malini-panel-quiet-button:hover:not(:disabled),
${PANEL_SCOPE}.malini-panel-quiet-button:focus-visible {
	background: var(--color-surface-150-hover);
	color: var(--color-fg-default);
}

${PANEL_SCOPE}.malini-panel-icon-button svg {
	width: 0.875rem;
	height: 0.875rem;
}
`;

type InstalledStyle = { element: HTMLStyleElement; references: number };

const documents = new WeakMap<Document, Map<string, InstalledStyle>>();

function registry(target: Document): Map<string, InstalledStyle> {
	const existing = documents.get(target);
	if (existing) return existing;
	const created = new Map<string, InstalledStyle>();
	documents.set(target, created);
	return created;
}

function ownerDocument(target?: Document): Document | null {
	if (target) return target;
	return typeof document === 'undefined' ? null : document;
}

function install(
	id: string,
	css: string,
	position: 'prepend' | 'append',
	target?: Document,
): ExtensionDisposable {
	const owner = ownerDocument(target);
	if (!owner) return { dispose: () => undefined };
	const styles = registry(owner);
	const existing = styles.get(id);
	if (existing) {
		existing.references += 1;
		return release(styles, id);
	}
	const element = owner.createElement('style');
	element.dataset.maliniPanelStyles = id;
	element.textContent = css;
	const head = owner.head ?? owner.documentElement;
	if (position === 'prepend') head.prepend(element);
	else head.append(element);
	styles.set(id, { element, references: 1 });
	return release(styles, id);
}

function release(styles: Map<string, InstalledStyle>, id: string): ExtensionDisposable {
	let released = false;
	return {
		dispose: () => {
			if (released) return;
			released = true;
			const installed = styles.get(id);
			if (!installed) return;
			installed.references -= 1;
			if (installed.references > 0) return;
			styles.delete(id);
			installed.element.remove();
		},
	};
}

export function installExtensionPanelBaseStyles(target?: Document): ExtensionDisposable {
	return install(EXTENSION_PANEL_BASE_STYLE_ID, EXTENSION_PANEL_BASE_STYLES, 'prepend', target);
}

export function installExtensionPanelStyles(
	id: string,
	css: string,
	target?: Document,
): ExtensionDisposable {
	const base = installExtensionPanelBaseStyles(target);
	const delta = install(id, css, 'append', target);
	let released = false;
	return {
		dispose: async () => {
			if (released) return;
			released = true;
			await delta.dispose();
			await base.dispose();
		},
	};
}
