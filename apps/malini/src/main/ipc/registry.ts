import { ipcMain } from 'electron';
import type { CommandName, CommandResult } from '../../contract/commands';
import {
	INVOKE_CHANNEL,
	type CommandFailure,
	type InvokeReply,
	type InvokeRequest,
	type InvokeResponse,
} from '../../contract/ipc';
import { toCommandFailure } from './command-failure';

export type CommandHandler<Args = unknown, Result = unknown> = {
	bivarianceHack(args: Args): Result | Promise<Result>;
}['bivarianceHack'];

export interface FailedCommand {
	readonly ok: false;
	readonly command: string;
	readonly args: unknown;
	readonly error: unknown;
	readonly failure: CommandFailure;
	readonly durationMs: number;
}

export interface CompletedCommand {
	readonly ok: true;
	readonly command: string;
	readonly args: unknown;
	readonly durationMs: number;
}

export type CommandOutcome = CompletedCommand | FailedCommand;

export type CommandObserver = (outcome: CommandOutcome) => void;

export type CommandFailureObserver = (failed: FailedCommand) => void;

export class CommandRegistry {
	private readonly handlers = new Map<CommandName, CommandHandler>();
	private readonly observers = new Set<CommandObserver>();

	define<Name extends CommandName>(
		name: Name,
		handler: CommandHandler<unknown, CommandResult<Name>>,
	): void {
		if (this.handlers.has(name)) {
			throw new Error(`command "${name}" is already registered`);
		}
		this.handlers.set(name, handler);
	}

	has(name: string): boolean {
		return this.lookup(name) !== undefined;
	}

	names(): CommandName[] {
		return [...this.handlers.keys()].sort();
	}

	observe(observer: CommandObserver): () => void {
		this.observers.add(observer);
		return () => {
			this.observers.delete(observer);
		};
	}

	observeFailures(observer: CommandFailureObserver): () => void {
		return this.observe((outcome) => {
			if (!outcome.ok) observer(outcome);
		});
	}

	async invoke(request: InvokeRequest): Promise<InvokeResponse> {
		const reply = await this.handle(request);
		return reply.ok ? reply : { ok: false, error: reply.failure.message };
	}

	async handle(request: InvokeRequest): Promise<InvokeReply> {
		const startedAt = performance.now();
		try {
			const handler = this.lookup(request.command);
			if (!handler) throw new Error(`unknown command "${request.command}"`);
			const value = await handler(request.args);
			this.report({
				ok: true,
				command: request.command,
				args: request.args,
				durationMs: Math.round(performance.now() - startedAt),
			});
			return { ok: true, value: value ?? null };
		} catch (error) {
			const failure = toCommandFailure(error, request.command);
			this.report({
				ok: false,
				command: request.command,
				args: request.args,
				error,
				failure,
				durationMs: Math.round(performance.now() - startedAt),
			});
			return { ok: false, failure };
		}
	}

	install(): void {
		ipcMain.handle(INVOKE_CHANNEL, (_event, request: InvokeRequest) => this.handle(request));
	}

	private report(outcome: CommandOutcome): void {
		for (const observer of [...this.observers]) {
			try {
				observer(outcome);
			} catch {
				continue;
			}
		}
	}

	private lookup(name: string): CommandHandler | undefined {
		const handlers: ReadonlyMap<string, CommandHandler> = this.handlers;
		return handlers.get(name);
	}
}
