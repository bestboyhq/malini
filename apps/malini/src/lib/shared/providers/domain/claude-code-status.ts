import type { AgentAccount, ClaudeCodeFailedUpdate, ProviderCapability } from '$contract/agent';
import type { InstallProgressPayload } from '$contract/events';

export type ClaudeSetupStep = 'install' | 'sign-in';

export type ClaudeCodeInstall =
	| Readonly<{ kind: 'idle' }>
	| Readonly<{ kind: 'installing'; progress: InstallProgressPayload | null }>
	| Readonly<{ kind: 'failed'; message: string }>;

export type ClaudeCodeUpdate = Readonly<{
	failed: ClaudeCodeFailedUpdate | null;
	retrying: boolean;
}>;

export type ClaudeCodeStatus =
	| { readonly kind: 'checking' }
	| { readonly kind: 'missing' }
	| { readonly kind: 'signed-out'; readonly version: string | null }
	| {
			readonly kind: 'ready';
			readonly version: string | null;
			readonly account: AgentAccount | null;
	  }
	| { readonly kind: 'unknown'; readonly message: string };

export function claudeCodeStatus(
	capability: ProviderCapability | null,
	error: string | null,
): ClaudeCodeStatus {
	if (!capability) return error ? { kind: 'unknown', message: error } : { kind: 'checking' };
	switch (capability.state) {
		case 'missing':
			return { kind: 'missing' };
		case 'needs_auth':
			return { kind: 'signed-out', version: capability.version };
		case 'ready':
			return { kind: 'ready', version: capability.version, account: capability.account };
		case 'unknown':
			return { kind: 'unknown', message: capability.message };
	}
}

export function setupStepFor(status: ClaudeCodeStatus): ClaudeSetupStep | null {
	if (status.kind === 'missing') return 'install';
	if (status.kind === 'signed-out') return 'sign-in';
	return null;
}

export function usesSubscription(status: ClaudeCodeStatus): boolean {
	return status.kind === 'ready' && Boolean(status.account?.plan);
}
