const SHELL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const STEERS_A_COMMAND =
	/^(?:PATH|HOME|SHELL|USER|LOGNAME|PWD|OLDPWD|IFS|TMPDIR|ENV|BASH_ENV|CDPATH|ZDOTDIR|PS[1-4]|TERM|LANG)$|^(?:DYLD_|LD_|LC_|BASH_FUNC_|CLAUDE_|MALINI_)/u;

export const SECRET_NAME_MAX_LENGTH = 100;

export function secretNameProblem(name: string): string | null {
	if (!SHELL_NAME.test(name) || name.length > SECRET_NAME_MAX_LENGTH) {
		return `${name.slice(0, SECRET_NAME_MAX_LENGTH)} is not a name a command reads, such as API_TOKEN.`;
	}
	if (STEERS_A_COMMAND.test(name)) {
		return `${name} steers how commands run, so it cannot hold a secret.`;
	}
	return null;
}
