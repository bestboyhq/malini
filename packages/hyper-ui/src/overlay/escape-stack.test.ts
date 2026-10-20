import { afterEach, describe, expect, it } from 'vitest';
import { dismissInnermostOverlay, registerEscapeScope } from './stacking';

describe('escape dismisses only the innermost overlay', () => {
	const releases: (() => void)[] = [];

	function open(dismiss: () => void): () => void {
		const release = registerEscapeScope(dismiss);
		releases.push(release);
		return release;
	}

	afterEach(() => {
		while (releases.length > 0) releases.pop()?.();
	});

	it('hands the keystroke to the overlay that opened last, not to the one containing it', () => {
		const dismissed: string[] = [];
		open(() => dismissed.push('modal'));
		open(() => dismissed.push('dropdown'));

		expect(dismissInnermostOverlay()).toBe(true);

		expect(dismissed).toEqual(['dropdown']);
	});

	it('falls back to the containing overlay only once the inner one has closed', () => {
		const dismissed: string[] = [];
		open(() => dismissed.push('modal'));
		const closeDropdown = open(() => dismissed.push('dropdown'));

		dismissInnermostOverlay();
		closeDropdown();
		dismissInnermostOverlay();

		expect(dismissed).toEqual(['dropdown', 'modal']);
	});

	it('reports that nothing was dismissed when no overlay is open, so the keystroke stays free', () => {
		expect(dismissInnermostOverlay()).toBe(false);
	});

	it('lets an overlay close out of order without stranding the one under it', () => {
		const dismissed: string[] = [];
		const closeModal = open(() => dismissed.push('modal'));
		open(() => dismissed.push('dropdown'));

		closeModal();
		dismissInnermostOverlay();

		expect(dismissed).toEqual(['dropdown']);
	});
});
