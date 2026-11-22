import type { WidgetBoard, WidgetReading } from '$contract/widgets';

class WidgetBoardsAggregate {
	boards = $state.raw<Readonly<Record<string, WidgetBoard>>>({});
	errors = $state.raw<Readonly<Record<string, string>>>({});

	set(board: WidgetBoard): void {
		this.boards = { ...this.boards, [board.workstreamId]: board };
		const { [board.workstreamId]: _cleared, ...rest } = this.errors;
		this.errors = rest;
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
}

function merged(board: WidgetBoard, reading: WidgetReading): readonly WidgetReading[] {
	const others = board.readings.filter(({ widgetId }) => widgetId !== reading.widgetId);
	return [...others, reading];
}

export const widgetBoardsAggregate = new WidgetBoardsAggregate();
