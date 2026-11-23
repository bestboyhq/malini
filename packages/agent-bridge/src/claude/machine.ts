export function machineWord(platform: NodeJS.Platform): string {
	return platform === 'darwin' ? 'Mac' : platform === 'win32' ? 'PC' : 'computer';
}

export const MACHINE = machineWord(process.platform);
