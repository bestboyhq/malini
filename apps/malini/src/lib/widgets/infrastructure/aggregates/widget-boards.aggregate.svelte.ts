import type { WidgetBoard, WidgetReading } from '$contract/widgets';

class WidgetBoardsAggregate {
	boards = $state.raw<Readonly<Record<string, WidgetBoard>>>({});
	errors = $state.raw<Readonly<Record<string, string>>>({});
	readonly #pending = new Map<string, number>();

	set(board: WidgetBoard): void {
		if ((this.#pending.get(board.workstreamId) ?? 0) > 0) return;
		this.#put(board);
	}

	arrange(workstreamId: string, change: (board: WidgetBoard) => WidgetBoard): void {
		this.#pending.set(workstreamId, (this.#pending.get(workstreamId) ?? 0) + 1);
		const board = this.boards[workstreamId];
		if (board) this.#put(change(board));
	}

	settle(workstreamId: string, board: WidgetBoard | null): boolean {
		const left = (this.#pending.get(workstreamId) ?? 1) - 1;
		if (left > 0) this.#pending.set(workstreamId, left);
		else this.#pending.delete(workstreamId);
		if (left === 0 && board !== null) this.#put(board);
		return left === 0;
	}

	fail(workstreamId: string, error: string): void {
		this.errors = { ...this.errors, [workstreamId]: error };
	}

	read(reading: WidgetReading): void {
		const next: Record<string, WidgetBoard> = {};
		for (const [workstreamId, board] of Object.entries(this.boards)) {
			next[workstreamId] =
				board.board === reading.board ? { ...board, readings: merged(board, reading) } : board;
		}
		this.boards = next;
	}

	workstreamsOn(board: string): readonly string[] {
		return Object.values(this.boards)
			.filter((candidate) => candidate.board === board)
			.map(({ workstreamId }) => workstreamId);
	}

	#put(board: WidgetBoard): void {
		this.boards = { ...this.boards, [board.workstreamId]: board };
		const { [board.workstreamId]: _cleared, ...rest } = this.errors;
		this.errors = rest;
	}
}

function merged(board: WidgetBoard, reading: WidgetReading): readonly WidgetReading[] {
	const others = board.readings.filter(({ widgetId }) => widgetId !== reading.widgetId);
	return [...others, reading];
}

export const widgetBoardsAggregate = new WidgetBoardsAggregate();
