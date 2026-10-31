import { describe, expect, it } from 'vitest';
import { extensionsView } from './extensions-view';

describe('extensionsView', () => {
	it('opens Installed, Published and an extension on their routes and Discover everywhere else', () => {
		expect(extensionsView('/extensions/installed')).toBe('installed');
		expect(extensionsView('/extensions/published')).toBe('published');
		expect(extensionsView('/extensions/[publisher]/[name]')).toBe('detail');
		expect(extensionsView('/extensions')).toBe('discover');
		expect(extensionsView(null)).toBe('discover');
	});
});
