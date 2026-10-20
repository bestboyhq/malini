import { ExtensionRuntimeCoordinator } from './extension-runtime-coordinator';

type ExtensionRuntimeLease = Readonly<{
	coordinator: ExtensionRuntimeCoordinator;
	release(): Promise<void>;
}>;

type ExtensionRuntimeLifetimeOptions = Readonly<{
	create?: (startupBarrier: Promise<void>) => ExtensionRuntimeCoordinator;
	deferRelease?: () => Promise<void>;
}>;

export class ExtensionRuntimeLifetime {
	readonly #create: (startupBarrier: Promise<void>) => ExtensionRuntimeCoordinator;
	readonly #deferRelease: () => Promise<void>;
	#coordinator: ExtensionRuntimeCoordinator | null = null;
	#owners = 0;
	#generation = 0;
	#stopping: Promise<void> | null = null;

	constructor(options: ExtensionRuntimeLifetimeOptions = {}) {
		this.#create =
			options.create ?? ((startupBarrier) => new ExtensionRuntimeCoordinator(startupBarrier));
		this.#deferRelease = options.deferRelease ?? deferToNextTask;
	}

	acquire(): ExtensionRuntimeLease {
		this.#generation += 1;
		const coordinator =
			this.#coordinator ?? (this.#coordinator = this.#create(settledBarrier(this.#stopping)));
		this.#owners += 1;
		let released = false;
		return {
			coordinator,
			release: () => {
				if (released) return Promise.resolve();
				released = true;
				return this.#release(coordinator);
			},
		};
	}

	async #release(coordinator: ExtensionRuntimeCoordinator): Promise<void> {
		this.#owners = Math.max(0, this.#owners - 1);
		if (this.#owners > 0) return;
		const generation = ++this.#generation;
		await this.#deferRelease();
		if (this.#owners > 0 || this.#generation !== generation || this.#coordinator !== coordinator) {
			return;
		}

		this.#coordinator = null;
		const stopping = coordinator.stop();
		this.#stopping = stopping;
		try {
			await stopping;
		} finally {
			if (this.#stopping === stopping) this.#stopping = null;
		}
	}
}

function deferToNextTask(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

async function settledBarrier(stopping: Promise<void> | null): Promise<void> {
	try {
		await stopping;
	} catch {
		return;
	}
}
