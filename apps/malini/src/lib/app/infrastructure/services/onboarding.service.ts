import { invoke } from '$shared/port/invoke';
import {
	HEARD_ABOUT_SETTING,
	heardAboutAsked,
	heardAboutSetting,
	type HeardAbout,
} from '$lib/app/domain/heard-about';

class OnboardingService {
	async askedHeardAbout(): Promise<boolean> {
		return heardAboutAsked(await invoke('app.list-settings', undefined));
	}

	answerHeardAbout(answer: HeardAbout | null): Promise<void> {
		return invoke('app.set-setting', {
			key: HEARD_ABOUT_SETTING,
			value: heardAboutSetting(answer),
		});
	}
}

export const onboardingService = new OnboardingService();
