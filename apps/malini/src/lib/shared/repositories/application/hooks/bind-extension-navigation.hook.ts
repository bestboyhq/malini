import { extensionBindings } from '$shared/extensions/bindings';
import { extensionNavigationBindingService } from '$shared/repositories/infrastructure/services/extension-navigation-binding.service';

export function bindExtensionNavigationHook(): () => void {
	return extensionBindings.bindNavigation(extensionNavigationBindingService);
}
