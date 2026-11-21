import type { CheckoutActionKind } from '$shared/repositories/domain/checkout-finding-copy';
import { repairCheckoutCommand } from './repair-checkout.command';
import { revealWorkstreamInFinderCommand } from './reveal-workstream-in-finder.command';
import { signInToGithubCommand } from './sign-in-to-github.command';

export { runCheckoutActionCommand, type CheckoutAgentHandlers };

type CheckoutAgentHandlers = Readonly<{ onAskAgent: () => void; onReport: () => void }>;

function runCheckoutActionCommand(
	workstreamId: string,
	kind: CheckoutActionKind,
	agent: CheckoutAgentHandlers,
): void {
	switch (kind) {
		case 'repair':
			return repairCheckoutCommand(workstreamId);
		case 'sign-in':
			return signInToGithubCommand();
		case 'reveal':
			return revealWorkstreamInFinderCommand(workstreamId);
		case 'ask-agent':
			return agent.onAskAgent();
		case 'report':
			return agent.onReport();
	}
}
