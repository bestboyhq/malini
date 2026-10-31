import { invoke } from '$shared/port/invoke';
import {
	HEARD_ABOUT_SETTING,
	heardAboutSetting,
	type HeardAbout,
} from '$lib/app/domain/heard-about';
import { ONBOARDING_FINISHED_SETTING, onboardingFinished } from '$lib/app/domain/onboarding';

class OnboardingService {
	async finished(): Promise<boolean> {
		const settings = await invoke('app.list-settings', undefined);
		return onboardingFinished(settings[ONBOARDING_FINISHED_SETTING]);
	}

	finish(): Promise<void> {
		return invoke('app.set-setting', {
			key: ONBOARDING_FINISHED_SETTING,
			value: new Date().toISOString(),
		});
	}

	answerHeardAbout(answer: HeardAbout | null): Promise<void> {
		return invoke('app.set-setting', {
			key: HEARD_ABOUT_SETTING,
			value: heardAboutSetting(answer),
		});
	}
}

export const onboardingService = new OnboardingService();
