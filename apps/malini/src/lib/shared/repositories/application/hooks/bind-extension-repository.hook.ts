import { extensionBindings } from '$shared/extensions/bindings';
import { extensionRepositoryBindingService } from '$shared/repositories/infrastructure/services/extension-repository-binding.service';

export function bindExtensionRepositoryHook(): () => void {
	return extensionBindings.bindRepository(extensionRepositoryBindingService);
}
