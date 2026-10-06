import type { RuntimeInfo } from '$contract/runtime';
import { invoke } from '$shared/port/invoke';

class RuntimeInfoService {
	read(): Promise<RuntimeInfo> {
		return invoke('app.runtime-info', undefined);
	}
}

export const runtimeInfoService = new RuntimeInfoService();
