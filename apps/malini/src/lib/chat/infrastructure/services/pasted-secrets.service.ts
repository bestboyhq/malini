import type { KeepSecretArgs, KeptSecret } from '$contract/secrets';
import { invoke } from '$shared/port/invoke';

class PastedSecretsService {
	keep(args: KeepSecretArgs): Promise<KeptSecret> {
		return invoke('secrets.keep', args);
	}

	async forget(name: string, repository: string | null): Promise<void> {
		await invoke('secrets.delete', { name, repository });
	}
}

export const pastedSecretsService = new PastedSecretsService();
