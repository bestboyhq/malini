import { invoke } from '$shared/port/invoke';
import { holdsLid, LID_HOLD_SETTING } from '$lib/app/domain/lid-hold';

class LidHoldService {
	async read(): Promise<boolean> {
		const settings = await invoke('app.list-settings', undefined);
		return holdsLid(settings[LID_HOLD_SETTING]);
	}

	write(on: boolean): Promise<boolean> {
		return invoke('app.hold-lid', { on });
	}
}

export const lidHoldService = new LidHoldService();
