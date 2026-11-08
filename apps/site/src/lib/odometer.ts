const BLUR = 14;

const carry = (below: number): number => {
	const t = Math.min(Math.max(below - 9, 0), 1);
	return t * t * (3 - 2 * t);
};

export function wheels(from: number, rate: number, elapsed: number): number[] {
	const steady = Math.max(0, Math.ceil(Math.log10(rate / BLUR)));
	const counted = from - (from % 10 ** steady) + rate * elapsed;
	const count = String(Math.floor(from + rate * elapsed)).length;
	const positions: number[] = [];
	for (let place = 0; place < count; place++) {
		const scale = 10 ** place;
		if (place < steady) {
			const spin = BLUR * (1 + (steady - place) / 4);
			positions.push(((Math.floor(from / scale) % 10) + elapsed * spin) % 10);
		} else if (place === steady) {
			positions.push((counted / scale) % 10);
		} else {
			positions.push(Math.floor((counted / scale) % 10) + carry(positions[place - 1] ?? 0));
		}
	}
	return positions.reverse();
}
