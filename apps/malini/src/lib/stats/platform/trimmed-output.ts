import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { RTK_DATA_FOLDER } from '@malini/agent-bridge/sandbox';
import type { TrimmedOutput, TrimmedProgram } from '$contract/stats';
import { openDatabase } from '$main/db/driver';
import { all } from '$main/db/rows';

const RTK_HEADLINE_INPUT_CAP_TOKENS = 7_500;
const TOP_PROGRAMS = 5;

const PROGRAMS_SQL = `
	SELECT program, COUNT(*) AS commands, SUM(input_tokens) AS inputTokens, SUM(MAX(saved_tokens, 0)) AS savedTokens
	FROM (
		SELECT
			CASE WHEN instr(original_cmd, ' ') > 0 THEN substr(original_cmd, 1, instr(original_cmd, ' ') - 1)
			ELSE original_cmd END AS program,
			input_tokens,
			saved_tokens
		FROM commands
		WHERE input_tokens <= ?
	)
	GROUP BY program
	ORDER BY savedTokens DESC, commands DESC`;

export function readTrimmedOutput(
	path: string = join(RTK_DATA_FOLDER, 'history.db'),
): TrimmedOutput | null {
	if (!existsSync(path)) return null;
	const db = openDatabase(path);
	try {
		const programs = all<TrimmedProgram>(db, PROGRAMS_SQL, RTK_HEADLINE_INPUT_CAP_TOKENS);
		const total = (field: keyof Omit<TrimmedProgram, 'program'>) =>
			programs.reduce((sum, program) => sum + program[field], 0);
		const commands = total('commands');
		if (commands === 0) return null;
		return {
			commands,
			inputTokens: total('inputTokens'),
			savedTokens: total('savedTokens'),
			programs: programs.slice(0, TOP_PROGRAMS),
		};
	} finally {
		db.close();
	}
}
