import { describe, expect, it } from 'vitest';
import {
	BRIDGE_AGENT_ATTACHMENTS_PATH,
	BRIDGE_SANDBOX_SCRATCH_PATH,
} from '$contract/protocol-contract.generated';
import { AGENT_ATTACHMENTS_PATH, SANDBOX_SCRATCH_PATH } from '$main/git/paths';
import { ATTACHMENT_ROOT } from '../attachments/layout';

describe('checkout paths shared with the agent bridge', () => {
	it('stores attachments where the bridge tells the model to look for them', () => {
		expect(ATTACHMENT_ROOT).toBe(BRIDGE_AGENT_ATTACHMENTS_PATH);
		expect(AGENT_ATTACHMENTS_PATH).toBe(BRIDGE_AGENT_ATTACHMENTS_PATH);
	});

	it('excludes the sandbox scratch directory the bridge writes to', () => {
		expect(SANDBOX_SCRATCH_PATH).toBe(BRIDGE_SANDBOX_SCRATCH_PATH);
	});
});
