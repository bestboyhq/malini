import { browserService } from '../../infrastructure/services/browser.service';
import { closeBrowserTabCommand } from '../commands/close-browser-tab.command';

export { removeClosedBrowserHook };

function removeClosedBrowserHook(): () => void {
	return browserService.onTabClosed(closeBrowserTabCommand);
}
