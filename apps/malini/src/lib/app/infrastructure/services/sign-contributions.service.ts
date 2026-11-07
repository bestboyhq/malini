import { SIGN_CONTRIBUTIONS_SETTING, signsContributions } from '$contract/pull-requests';
import { invoke } from '$shared/port/invoke';

class SignContributionsService {
	async read(): Promise<boolean> {
		const settings = await invoke('app.list-settings', undefined);
		return signsContributions(settings[SIGN_CONTRIBUTIONS_SETTING]);
	}

	write(signed: boolean): Promise<void> {
		return invoke('app.set-setting', {
			key: SIGN_CONTRIBUTIONS_SETTING,
			value: signed ? 'on' : 'off',
		});
	}
}

export const signContributionsService = new SignContributionsService();
