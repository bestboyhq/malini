import { describe, expect, it } from 'vitest';
import { isWorkstreamCheckoutUsable } from '$shared/repositories/domain/workstream';
import { WorkstreamMapper } from './workstream.mapper';

const created = {
	id: '01JCREATEDEVENTAA',
	projectId: 'project',
	name: 'Signal Voyage',
	path: '/tmp/checkout',
	branch: 'malini/signal-voyage',
	baseBranch: 'main',
	status: 'active',
};

describe('mapping a workstream from the platform', () => {
	it('treats a workstream whose checkout was not reported yet as usable until a refresh observes it', () => {
		const workstream = WorkstreamMapper.fromRaw(created);

		expect(workstream.checkoutState).toBe('unobserved');
		expect(isWorkstreamCheckoutUsable(workstream)).toBe(true);
	});

	it('treats a checkout state it does not recognise as unusable', () => {
		const workstream = WorkstreamMapper.fromRaw({ ...created, checkoutState: 'melted' });

		expect(isWorkstreamCheckoutUsable(workstream)).toBe(false);
	});
});
