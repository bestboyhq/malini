import type { LidHoldState } from '$contract/commands';
import { invoke } from '$shared/port/invoke';

class LidHoldService {
	read(): Promise<LidHoldState> {
		return invoke('app.lid-hold', undefined);
	}

	write(on: boolean): Promise<boolean> {
		return invoke('app.hold-lid', { on });
	}
}

export const lidHoldService = new LidHoldService();
