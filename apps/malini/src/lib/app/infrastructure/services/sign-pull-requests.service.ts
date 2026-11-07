import { SIGN_PULL_REQUESTS_SETTING, signsPullRequests } from '$contract/pull-requests';
import { invoke } from '$shared/port/invoke';

class SignPullRequestsService {
	async read(): Promise<boolean> {
		const settings = await invoke('app.list-settings', undefined);
		return signsPullRequests(settings[SIGN_PULL_REQUESTS_SETTING]);
	}

	write(signed: boolean): Promise<void> {
		return invoke('app.set-setting', {
			key: SIGN_PULL_REQUESTS_SETTING,
			value: signed ? 'on' : 'off',
		});
	}
}

export const signPullRequestsService = new SignPullRequestsService();
