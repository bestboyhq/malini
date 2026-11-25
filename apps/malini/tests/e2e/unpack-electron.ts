export default async function unpackElectronBeforeAnyWorkerLaunchesIt(): Promise<void> {
	await import('electron');
}
