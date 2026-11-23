import { osFor, type Os } from '$shared/os/domain/os';
import { osService } from '$shared/os/infrastructure/services/os.service';

class OsQuery {
	public readonly data: Os = $derived(osFor(osService.platform));
}

export const osQuery = new OsQuery();
