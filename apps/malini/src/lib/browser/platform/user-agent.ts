export function chromeUserAgent(electronUserAgent: string): string {
	return electronUserAgent
		.replace(/(?<=\(KHTML, like Gecko\) )\S+ (?=Chrome\/)/u, '')
		.replace(/ Electron\/\S+/u, '')
		.replace(/Chrome\/(\d+)\S*/u, 'Chrome/$1.0.0.0');
}
