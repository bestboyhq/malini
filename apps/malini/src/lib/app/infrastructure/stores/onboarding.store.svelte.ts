import type { HeardAbout } from '$lib/app/domain/heard-about';

const FIRST_CHAT_KEY = 'malini.app.first-chat:v1';

class OnboardingStore {
	finished = $state<boolean | null>(null);
	step = $state(0);
	direction = $state<1 | -1>(1);
	shown = $state(false);
	heardAbout = $state<HeardAbout | null>(null);
	firstChatId = $state<string | null>(storedFirstChat());
	finishing = false;

	waitInFirstChat(workstreamId: string | null): void {
		this.firstChatId = workstreamId;
		try {
			if (workstreamId === null) globalThis.localStorage?.removeItem(FIRST_CHAT_KEY);
			else globalThis.localStorage?.setItem(FIRST_CHAT_KEY, workstreamId);
		} catch {}
	}
}

function storedFirstChat(): string | null {
	try {
		return globalThis.localStorage?.getItem(FIRST_CHAT_KEY) || null;
	} catch {
		return null;
	}
}

export const onboardingStore = new OnboardingStore();
