import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./TopBar.svelte', import.meta.url), 'utf8');

const markup = source.slice(source.indexOf('</script>'), source.indexOf('<style>'));

const restingState = (() => {
	const start = markup.indexOf('<Popover');
	const end = markup.indexOf('</Popover>');
	expect(start).toBeGreaterThan(-1);
	expect(end).toBeGreaterThan(start);
	return `${markup.slice(0, start)}${markup.slice(end)}`;
})();

function occurrences(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

describe('the resting global top bar', () => {
	it('draws one git control and one way to open the detail', () => {
		expect(occurrences(restingState, 'data-testid="global-topbar-github-action"')).toBe(1);
		expect(occurrences(restingState, 'data-testid="global-topbar-github-status"')).toBe(1);
		expect(restingState).toContain('aria-haspopup="dialog"');
	});

	it.each([
		'github-pill',
		'githubStatus.summary',
		'githubStatus.tone',
		'blockingCount',
		'githubPillLabel',
	])('never renders %s anywhere', (banned) => {
		expect(source).not.toContain(banned);
	});

	it('names the pull request in the resting bar and opens it on GitHub', () => {
		expect(restingState).toContain('data-testid="global-topbar-github-reference"');
		expect(restingState).toContain('onclick={() => openPullRequestUrl(url)}');
	});

	it.each([
		'githubPanelHeadline',
		'githubStatus.branch',
		'githubStatus.checks',
		'githubStatus.checksSummary',
		'githubStatus.review',
		'githubStatus.todos',
		'githubStatus.changes',
		'tone-dot',
	])('keeps %s behind the disclosure', (detail) => {
		expect(markup).toContain(detail);
		expect(restingState).not.toContain(detail);
	});

	it('offers the pull request on GitHub from the disclosure', () => {
		expect(markup).toContain('data-testid="global-topbar-github-open"');
		expect(restingState).not.toContain('data-testid="global-topbar-github-open"');
		expect(source).toContain('openExternalUrlCommand(url)');
	});

	it('lists non-next actions in the disclosure only', () => {
		expect(markup).toContain('githubDetailActions');
		expect(restingState).not.toContain('githubDetailActions');
	});

	it.each(['Refreshing', 'githubStatus.refreshing', 'github-panel__refreshing'])(
		'never announces a background read with %s',
		(banned) => {
			expect(source).not.toContain(banned);
		},
	);
});

const actionRules = (() => {
	const styles = source.slice(source.indexOf('<style>'), source.lastIndexOf('</style>'));
	const declarations = styles.replace(/\/\*[\s\S]*?\*\//gu, '');
	return [...declarations.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
		.map(([, selector, body]) => ({ selector: selector?.trim() ?? '', body: body ?? '' }))
		.filter(({ selector }) => selector.includes('.topbar-action'));
})();

function actionRule(selector: string): string {
	const rule = actionRules.find((candidate) => candidate.selector === selector);
	expect(rule, `no rule for ${selector}`).toBeDefined();
	return rule?.body ?? '';
}

describe('the top bar action paint', () => {
	it('never spends the brand hue on a control that is always there', () => {
		expect(actionRules.length).toBeGreaterThan(0);
		for (const { selector, body } of actionRules) {
			expect(`${selector} ${body}`, selector).not.toContain('--color-brand');
		}
	});

	it('binds the committing verb to the button token triple', () => {
		const primary = actionRule(".topbar-action[data-tone='primary']");
		expect(primary).toContain('var(--color-button-primary)');
		expect(primary).toContain('var(--color-button-primary-content)');
		expect(actionRule(".topbar-action[data-tone='primary']:hover:not(:disabled)")).toContain(
			'var(--color-button-primary-hover)',
		);
	});

	it('separates a running control from one that is simply out', () => {
		expect(actionRule(".topbar-action[data-tone='primary'][aria-busy='true']")).toContain(
			'var(--color-button-primary-busy)',
		);
		const unavailable = actionRule('.topbar-action:disabled');
		expect(unavailable).toContain('var(--color-button-disabled)');
		expect(unavailable).toContain('var(--color-button-disabled-content)');
		expect(unavailable).not.toContain('opacity');
	});
});

describe('the published GitHub status', () => {
	const contract = readFileSync(
		new URL('../../shared/shell/global-topbar-actions.svelte.ts', import.meta.url),
		'utf8',
	);

	it('carries no in-flight flag for the shell to render', () => {
		expect(contract).not.toContain('refreshing: boolean');
	});
});
