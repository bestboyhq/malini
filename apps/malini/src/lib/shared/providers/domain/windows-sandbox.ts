import type { SandboxProblem, SandboxSetupOutcome } from '$contract/agent';
import type { InstallProgressPayload } from '$contract/events';

export type WindowsSandboxAction = 'set-up' | 'remove';

export type WindowsSandboxSetup =
	| Readonly<{ kind: 'idle' }>
	| Readonly<{
			kind: 'working';
			action: WindowsSandboxAction;
			progress: InstallProgressPayload | null;
	  }>
	| Readonly<{
			kind: 'stopped';
			action: WindowsSandboxAction;
			outcome: SandboxSetupOutcome['outcome'];
			reason: string | null;
	  }>;

export const WINDOWS_SANDBOX_CHANGES = [
	'srt-sandbox, a hidden Windows account that runs the commands',
	'Firewall rules that keep that account off the internet unless a chat allows it',
	'Read access for it to the tool folders in your profile, never Documents, Desktop, Downloads or sign-ins',
	'Write access for it to each checkout a chat runs commands in',
] as const;

export const WINDOWS_SANDBOX_PROBLEM_LINES: Partial<Record<SandboxProblem, string>> = {
	'not-set-up':
		"Malini's sandbox is not set up on this PC yet, so every command asks first. Set it up in Settings, Agent access.",
	outdated:
		"Malini's sandbox setup is out of date, so every command asks first. Update it in Settings, Agent access.",
	blocked:
		'Windows does not let Malini open a sandbox, so every command asks first. Check that the Secondary Logon service is on, then restart Malini.',
	missing:
		'Malini cannot find Git Bash or its sandbox files, so every command asks first. Reinstall Malini.',
};

const READY = 'Set up on this PC. Commands run as srt-sandbox, a separate Windows account.';
const NOT_SET_UP = 'Not set up on this PC yet. Windows asks you to allow it once. Setup adds:';
const PROBLEM_DETAILS: Partial<Record<SandboxProblem, string>> = {
	outdated: 'Set up by an older Malini. Update it before chats use it.',
	blocked:
		'Windows does not let Malini open it. Check that the Secondary Logon service is on, then restart Malini.',
	missing: 'Git Bash or the sandbox files are missing. Reinstall Malini.',
};
const STOPPED: Record<Exclude<SandboxSetupOutcome['outcome'], 'failed'>, string> = {
	done: READY,
	cancelled: 'You did not allow it at the Windows prompt, so nothing changed.',
	conflict:
		'Another app set up this sandbox with other settings. Replace changes them for that app too.',
	busy: 'The sandbox is in use. Restart Malini, then try again.',
};

export function windowsSandboxDetail(
	setup: WindowsSandboxSetup,
	problem: SandboxProblem | null,
): string {
	if (setup.kind === 'working') {
		if (setup.action === 'remove') return 'Removing. Windows asks you to allow it.';
		return setup.progress
			? 'Making the tool folders in your profile readable.'
			: 'Setting up. Windows asks you to allow it.';
	}
	if (setup.kind === 'stopped') {
		if (setup.outcome !== 'failed') return STOPPED[setup.outcome];
		const what = setup.action === 'remove' ? 'remove' : 'set up';
		return `Could not ${what} the sandbox. ${setup.reason ?? ''}`.trim();
	}
	if (problem === null) return READY;
	return PROBLEM_DETAILS[problem] ?? NOT_SET_UP;
}
