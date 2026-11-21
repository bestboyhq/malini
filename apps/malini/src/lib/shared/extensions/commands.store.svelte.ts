export type ExtensionCommandExecutor = Readonly<{
	workstreamId(): string | null;
	execute(commandId: string, ...args: readonly unknown[]): Promise<unknown>;
	emit(channel: string, payload: unknown): Promise<void>;
	onEvent(channel: string, listener: (payload: unknown) => void): () => void;
}>;

const READY_WAIT_MS = 15_000;
const READY_POLL_MS = 100;

class ExtensionCommands {
	#executor = $state.raw<ExtensionCommandExecutor | null>(null);

	connect(executor: ExtensionCommandExecutor): () => void {
		this.#executor = executor;
		return () => {
			if (this.#executor === executor) this.#executor = null;
		};
	}

	isReadyFor(workstreamId: string): boolean {
		const executor = this.#executor;
		return executor !== null && executor.workstreamId() === workstreamId;
	}

	async whenReadyFor(workstreamId: string, signal?: AbortSignal): Promise<boolean> {
		const deadline = Date.now() + READY_WAIT_MS;
		while (!this.isReadyFor(workstreamId)) {
			if (signal?.aborted || Date.now() >= deadline) return false;
			await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
		}
		return true;
	}

	async execute<TResult>(
		workstreamId: string,
		commandId: string,
		...args: readonly unknown[]
	): Promise<TResult> {
		const executor = this.#executor;
		if (!executor) throw new ExtensionCommandUnavailableError('Extensions are not ready yet');
		if (executor.workstreamId() !== workstreamId) {
			throw new ExtensionCommandUnavailableError('Extensions are not active for this workstream');
		}
		return declared<TResult>(await executor.execute(commandId, ...args));
	}

	onEvent<TPayload>(channel: string, listener: (payload: TPayload) => void): () => void {
		const executor = this.#executor;
		if (!executor) return () => {};
		return executor.onEvent(channel, (payload) => listener(declared<TPayload>(payload)));
	}

	async emit(workstreamId: string, channel: string, payload: unknown): Promise<void> {
		const executor = this.#executor;
		if (!executor || executor.workstreamId() !== workstreamId) return;
		await executor.emit(channel, payload);
	}
}

export class ExtensionCommandUnavailableError extends Error {}

export const extensionCommands = new ExtensionCommands();

function declared<T>(value: unknown): T;
function declared(value: unknown): unknown {
	return value;
}
