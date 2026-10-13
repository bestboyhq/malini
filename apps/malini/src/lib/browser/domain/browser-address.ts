export function browserAddressLabel(address: string): string {
	try {
		const url = new URL(address);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') return address;
		const path = url.pathname === '/' ? '' : url.pathname;
		return `${url.host}${path}${url.search}${url.hash}`;
	} catch {
		return address;
	}
}
