/**
 * Consistent exit codes for AI-friendly CLI
 */
export const ExitCode = {
	SUCCESS: 0,
	GENERAL_ERROR: 1,
	INVALID_ARGUMENTS: 2,
	AUTH_ERROR: 3,
	NOT_FOUND: 4,
	PERMISSION_DENIED: 5,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export function exit(code: ExitCodeValue): never {
	process.exit(code);
}
