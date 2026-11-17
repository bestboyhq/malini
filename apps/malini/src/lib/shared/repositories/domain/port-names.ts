export const MAX_PORT_NAMES = 32;
export const PORT_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export function parsePortNames(input: unknown, path: string): readonly string[] {
	if (!Array.isArray(input)) throw new Error(`${path} must be an array of port names`);
	if (input.length > MAX_PORT_NAMES) {
		throw new Error(`${path} lists more than ${MAX_PORT_NAMES} port names`);
	}
	const names = input.map((name, index) => {
		if (typeof name !== 'string' || !PORT_NAME.test(name)) {
			throw new Error(
				`${path}[${index}] must be a port name of lowercase letters, digits and single dashes, such as web or admin-api`,
			);
		}
		return name;
	});
	const repeated = names.find((name, index) => names.indexOf(name) !== index);
	if (repeated !== undefined) throw new Error(`${path} lists ${repeated} twice`);
	return Object.freeze(names);
}

export function portVariable(name: string): string {
	return `MALINI_PORT_${name.toUpperCase().replaceAll('-', '_')}`;
}
