export type ShellRunState = 'running' | 'exited' | 'stopped' | 'failed';

export type ShellRun = Readonly<{
	id: string;
	workstreamId: string;
	sessionId: string;
	command: string;
	state: ShellRunState;
	exitCode: number | null;
	output: string;
	startedAt: string;
	finishedAt: string | null;
}>;

export type RunShellCommandArgs = Readonly<{
	workstreamId: string;
	sessionId: string;
	command: string;
}>;

export type ShellRunArgs = Readonly<{ runId: string }>;

export type ShellInputArgs = Readonly<{ runId: string; text: string }>;
