import type { CommandArgs, CommandName, CommandResult } from '$contract/commands';
import type { ContractEvents, EventChannel } from '$contract/events';
import type { PlatformBridge } from '../bridge';

export type FakeCall = Readonly<{
	command: string;
	args: unknown;
}>;

type FakeCommandHandler = { bivarianceHack(args: unknown): unknown }['bivarianceHack'];

type FakeListener = (payload: unknown) => void;

export class FakeBridge implements PlatformBridge {
	readonly calls: FakeCall[] = [];

	readonly #handlers = new Map<string, FakeCommandHandler>();
	readonly #redactions = new Map<string, FakeCommandHandler>();
	readonly #listeners = new Map<string, Set<FakeListener>>();
	readonly #resets = new Set<() => void>();

	define<Name extends CommandName>(
		command: Name,
		handler: (args: CommandArgs<Name>) => CommandResult<Name> | Promise<CommandResult<Name>>,
	): void;
	define(command: string, handler: FakeCommandHandler): void {
		this.#handlers.set(command, handler);
	}

	redactCalls<Name extends CommandName>(
		command: Name,
		redact: (args: CommandArgs<Name>) => unknown,
	): void;
	redactCalls(command: string, redact: FakeCommandHandler): void {
		this.#redactions.set(command, redact);
	}

	invoke<Name extends CommandName>(
		command: Name,
		args: CommandArgs<Name>,
	): Promise<CommandResult<Name>>;
	invoke(command: string, args: unknown): Promise<unknown> {
		let sent: unknown;
		try {
			sent = structuredClone(args);
		} catch (error) {
			return Promise.reject(error instanceof Error ? error : new Error(String(error)));
		}
		const redact = this.#redactions.get(command);
		this.calls.push({ command, args: redact ? redact(sent) : sent });
		const handler = this.#handlers.get(command);
		if (!handler) {
			return Promise.reject(new Error(`the fake platform does not define \`${command}\``));
		}
		return new Promise((resolve) => resolve(handler(sent)));
	}

	on<Channel extends EventChannel>(
		channel: Channel,
		listener: (payload: ContractEvents[Channel]) => void,
	): () => void;
	on(channel: string, listener: FakeListener): () => void {
		const listeners = this.#listeners.get(channel) ?? new Set<FakeListener>();
		this.#listeners.set(channel, listeners);
		const subscriber: FakeListener = (payload) => listener(payload);
		listeners.add(subscriber);
		return () => {
			listeners.delete(subscriber);
		};
	}

	emit(channel: string, payload: unknown): void {
		const listeners = this.#listeners.get(channel);
		if (!listeners) return;
		for (const listener of [...listeners]) listener(payload);
	}

	listenerCount(channel: string): number {
		return this.#listeners.get(channel)?.size ?? 0;
	}

	names(): string[] {
		return [...this.#handlers.keys()].sort();
	}

	onReset(callback: () => void): void {
		this.#resets.add(callback);
	}

	reset(): void {
		this.calls.length = 0;
		this.#listeners.clear();
		for (const callback of this.#resets) callback();
	}
}
