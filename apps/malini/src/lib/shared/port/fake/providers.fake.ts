import type { FakeBridge } from './fake-bridge';
import type { FakeState } from './state';

export function installProvidersFake(bridge: FakeBridge, state: FakeState): void {
	bridge.define('providers.run-claude-setup', async (input) => {
		state.claudeSetupSteps.push(input.step);
		state.providerCapabilities = state.providerCapabilities.map((capability) =>
			input.step === 'install'
				? {
						...capability,
						state: 'needs_auth',
						installed: true,
						authenticated: false,
						account: null,
					}
				: {
						...capability,
						state: 'ready',
						installed: true,
						authenticated: true,
						account: { email: 'dev@example.com', plan: 'Claude Max' },
					},
		);
	});
}
