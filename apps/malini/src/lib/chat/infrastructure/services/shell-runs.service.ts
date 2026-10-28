import { CHAT_SHELL_RUN_CHANGED_CHANNEL } from '$contract/events';
import type { RunShellCommandArgs, ShellRun } from '$contract/shell-runs';
import { onPlatformEvent } from '$shared/port/events';
import { invoke } from '$shared/port/invoke';

class ShellRunsService {
	run(args: RunShellCommandArgs): Promise<ShellRun> {
		return invoke('chat.run-shell-command', args);
	}

	list(): Promise<ShellRun[]> {
		return invoke('chat.shell-runs', undefined);
	}

	write(runId: string, text: string): Promise<void> {
		return invoke('chat.write-shell-input', { runId, text });
	}

	stop(runId: string): Promise<void> {
		return invoke('chat.stop-shell-run', { runId });
	}

	dismiss(runId: string): Promise<void> {
		return invoke('chat.dismiss-shell-run', { runId });
	}

	onChanged(listener: (run: ShellRun) => void): () => void {
		return onPlatformEvent(CHAT_SHELL_RUN_CHANGED_CHANNEL, listener);
	}
}

export const shellRuns = new ShellRunsService();
