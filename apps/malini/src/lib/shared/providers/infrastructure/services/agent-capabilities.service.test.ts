import { afterEach, describe, expect, it } from 'vitest';
import { createFakePlatform } from '$shared/port/fake/create-fake-platform';
import { setPlatformForTest } from '$shared/port/platform';

import { agentCapabilitiesService } from './agent-capabilities.service';

afterEach(() => {
	setPlatformForTest(null);
});

describe('agentCapabilitiesService', () => {
	it('asks the agent for fresh capabilities only when a refresh is requested', async () => {
		const fake = createFakePlatform();
		setPlatformForTest(fake);

		await agentCapabilitiesService.list(false);
		await agentCapabilitiesService.list(true);

		expect(fake.calls).toEqual([
			{ command: 'chat.agent-capabilities', args: {} },
			{ command: 'chat.agent-capabilities', args: { refresh: true } },
		]);
	});
});
