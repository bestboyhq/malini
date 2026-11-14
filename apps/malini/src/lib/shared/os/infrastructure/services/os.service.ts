import { osPlatform } from '$shared/os/domain/os';
import { platformOs } from '$shared/port/events';

class OsService {
	readonly platform = osPlatform(platformOs() ?? 'darwin');
}

export const osService = new OsService();
