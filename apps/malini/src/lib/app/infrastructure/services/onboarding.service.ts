import { invoke } from '$shared/port/invoke';
import {
	HEARD_ABOUT_SETTING,
	heardAboutSetting,
	type HeardAbout,
} from '$lib/app/domain/heard-about';

class OnboardingService {
	async heardAboutSetting(): Promise<string | null> {
		const settings = await invoke('app.list-settings', undefined);
		return settings[HEARD_ABOUT_SETTING] ?? null;
	}

	answerHeardAbout(answer: HeardAbout | null): Promise<void> {
		return invoke('app.set-setting', {
			key: HEARD_ABOUT_SETTING,
			value: heardAboutSetting(answer),
		});
	}
}

export const onboardingService = new OnboardingService();
