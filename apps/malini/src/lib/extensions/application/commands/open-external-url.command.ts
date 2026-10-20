import { externalUrlService } from '$shared/system/external-url.service';

const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

export function openExternalUrlCommand(href: string): void {
	const url = new URL(href);
	if (!WEB_PROTOCOLS.has(url.protocol)) return;
	void externalUrlService.open(url.href).catch(() => undefined);
}
