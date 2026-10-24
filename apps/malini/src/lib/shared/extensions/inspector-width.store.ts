export type InspectorWidthSource = Readonly<{
	workstreamId: () => string;
	grow: (by: number) => void;
}>;

class InspectorWidth {
	#source: InspectorWidthSource | null = null;

	connect(source: InspectorWidthSource): () => void {
		this.#source = source;
		return () => {
			if (this.#source === source) this.#source = null;
		};
	}

	grow(workstreamId: string, by: number): void {
		const source = this.#source;
		if (source?.workstreamId() === workstreamId) source.grow(by);
	}
}

export const inspectorWidth = new InspectorWidth();
