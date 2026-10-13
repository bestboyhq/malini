import type { ClaudeSignInOutcome } from '$contract/agent';
import type { FakeBridge } from './fake-bridge';
import type { FakeState } from './state';

export function installProvidersFake(bridge: FakeBridge, state: FakeState): void {
	bridge.define('providers.install-claude-code', async () => {
		state.providerCapabilities = state.providerCapabilities.map((capability) => ({
			...capability,
			state: 'needs_auth',
			installed: true,
			authenticated: false,
			account: null,
		}));
	});
	bridge.define('providers.sign-in-to-claude', async (input): Promise<ClaudeSignInOutcome> => {
		state.providerCapabilities = state.providerCapabilities.map((capability) => ({
			...capability,
			state: 'ready',
			installed: true,
			authenticated: true,
			account: { email: input.email ?? 'dev@example.com', plan: 'Claude Max' },
		}));
		return 'signed-in';
	});
	bridge.define('providers.cancel-claude-sign-in', async () => {});
}
