export function currentDiagnosticRoute(): string {
	try {
		const location = globalThis.location;
		if (!location) return '/';
		return location.hash.startsWith('#/') ? location.hash.slice(1) : location.href;
	} catch {
		return '/';
	}
}
