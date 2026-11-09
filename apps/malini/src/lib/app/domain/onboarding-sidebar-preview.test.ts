import { describe, expect, it } from 'vitest';
import { DEFAULT_ONBOARDING_SIDEBAR, onboardingSidebarArrangement } from './onboarding';
import { onboardingSidebarPreview } from './onboarding-sidebar-preview';
import { sidebarWorkstreamIds } from './sidebar-tree';

const preview = (change: Partial<typeof DEFAULT_ONBOARDING_SIDEBAR>) =>
	onboardingSidebarPreview(
		onboardingSidebarArrangement({ ...DEFAULT_ONBOARDING_SIDEBAR, ...change }),
	);

describe('onboardingSidebarPreview', () => {
	it('groups the sample work by organization for many repositories', () => {
		const sidebar = preview({});
		expect(sidebar.sections).toEqual([]);
		expect(sidebar.blocks.map((block) => block.kind)).toEqual(['owner', 'owner']);
	});

	it('lists the sample work by status for one project', () => {
		const sidebar = preview({ where: 'one' });
		expect(sidebar.sections.map((section) => section.key)).toEqual([
			'needs-you',
			'in-progress',
			'in-review',
			'idle',
		]);
		expect(sidebar.hidden).toBe(0);
	});

	it('hides the work that does not need you', () => {
		const sidebar = preview({ show: 'attention' });
		expect(sidebar.sections.map((section) => section.key)).toEqual(['needs-you', 'in-review']);
		expect(sidebar.hidden).toBeGreaterThan(0);
		expect(sidebarWorkstreamIds(sidebar).length + sidebar.hidden).toBe(
			sidebarWorkstreamIds(preview({ where: 'one' })).length,
		);
	});
});
