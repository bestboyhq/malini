import { installAppFake } from './app.fake';
import { installChatFake, setFakeAgentScript } from './chat.fake';
import { installExtensionsFake } from './extensions.fake';
import { FakeBridge } from './fake-bridge';
import { installProvidersFake } from './providers.fake';
import { installPullRequestsFake } from './pull-requests.fake';
import { installRepositoriesFake } from './repositories.fake';
import { installRoutinesFake } from './routines.fake';
import type { FakeAgentScriptStep, FakeProject, FakeWorkstream, PlatformSeed } from './seed';
import { cloneProjects, cloneWorkstreams, createFakeState } from './state';

export type FakePlatformSnapshot = {
	projects: FakeProject[];
	workstreams: FakeWorkstream[];
	settings: Record<string, string>;
	secrets: Record<string, string>;
};

export class FakePlatform extends FakeBridge {
	readonly kind = 'fake';

	#state: ReturnType<typeof createFakeState>;

	constructor(seed: PlatformSeed = {}) {
		super();
		this.#state = createFakeState(seed);
		installAppFake(this, this.#state);
		installChatFake(this, this.#state);
		installExtensionsFake(this, this.#state);
		installProvidersFake(this, this.#state);
		installRepositoriesFake(this, this.#state);
		installPullRequestsFake(this);
		installRoutinesFake(this);
	}

	script(steps: readonly FakeAgentScriptStep[]): void {
		setFakeAgentScript(this.#state, steps);
	}

	seed(seed: PlatformSeed): void {
		Object.assign(this.#state, createFakeState(seed));
		this.reset();
	}

	snapshot(): FakePlatformSnapshot {
		return {
			projects: cloneProjects(this.#state.projects),
			workstreams: cloneWorkstreams(this.#state.workstreams),
			settings: { ...this.#state.settings },
			secrets: Object.fromEntries(this.#state.secrets),
		};
	}
}

export function createFakePlatform(seed: PlatformSeed = {}): FakePlatform {
	return new FakePlatform(seed);
}
