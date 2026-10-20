export class IdSequence {
	private counter = 0;

	next(prefix: string, now: number = Date.now()): string {
		const ordinal = this.counter;
		this.counter += 1;
		return `${prefix}-${now}-${ordinal}`;
	}
}
