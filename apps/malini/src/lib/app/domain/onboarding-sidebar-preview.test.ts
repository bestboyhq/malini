import { describe, expect, it } from 'vitest';
import { DEFAULT_ONBOARDING_SIDEBAR, onboardingSidebarArrangement } from './onboarding';
import { onboardingSidebarPreview } from './onboarding-sidebar-preview';
import { sidebarWorkstreamIds, type SidebarBlock } from './sidebar-tree';

const RECENT = ['szymeo/malini', 'bestboyhq/platform', 'bestboyhq/brand', 'szymeo/dotfiles'];

const preview = (
	change: Partial<typeof DEFAULT_ONBOARDING_SIDEBAR>,
	recent: readonly string[] = [],
) =>
	onboardingSidebarPreview(
		onboardingSidebarArrangement({ ...DEFAULT_ONBOARDING_SIDEBAR, ...change }),
		recent,
	);

function ownersOf(blocks: readonly SidebarBlock[]): string[] {
	return blocks.flatMap((block) => (block.kind === 'owner' ? [block.owner] : []));
}

describe('onboardingSidebarPreview', () => {
	it('groups the sample work by organization for many repositories', () => {
		const { tree } = preview({});
		expect(tree.sections).toEqual([]);
		expect(tree.blocks.map((block) => block.kind)).toEqual(['owner', 'owner']);
	});

	it('lists the sample work by status for one project', () => {
		const { tree } = preview({ where: 'one' });
		expect(tree.sections.map((section) => section.key)).toEqual([
			'needs-you',
			'in-progress',
			'in-review',
			'idle',
		]);
		expect(tree.hidden).toBe(0);
	});

	it('hides the work that does not need you', () => {
		const { tree } = preview({ show: 'attention' });
		expect(tree.sections.map((section) => section.key)).toEqual(['needs-you', 'in-review']);
		expect(tree.hidden).toBeGreaterThan(0);
		expect(sidebarWorkstreamIds(tree).length + tree.hidden).toBe(
			sidebarWorkstreamIds(preview({ where: 'one' }).tree).length,
		);
	});

	it('shows your recent repositories when it has them', () => {
		const { tree } = preview({}, RECENT);
		expect(ownersOf(tree.blocks).sort()).toEqual(['bestboyhq', 'szymeo']);
	});

	it('names the repository of each row after your repository', () => {
		const { tree, repositoryNames } = preview({ where: 'one' }, RECENT);
		const names = sidebarWorkstreamIds(tree).map((id) => repositoryNames.get(id));
		expect(new Set(names)).toEqual(new Set(['malini', 'platform', 'brand', 'dotfiles']));
	});

	it('spreads the work over fewer repositories than four', () => {
		const { tree, repositoryNames } = preview({ where: 'one' }, ['szymeo/malini', 'szymeo/malini']);
		expect(new Set(sidebarWorkstreamIds(tree).map((id) => repositoryNames.get(id)))).toEqual(
			new Set(['malini']),
		);
		expect(sidebarWorkstreamIds(tree)).toHaveLength(7);
	});

	it('names dotted and uppercase repositories', () => {
		const { tree } = preview({ where: 'one' }, ['Acme-Inc/site.v2']);
		expect(sidebarWorkstreamIds(tree)).toHaveLength(7);
	});
});
