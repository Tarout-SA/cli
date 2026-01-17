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
	// Deployment-specific exit codes
	DEPLOYMENT_FAILED: 10,
	DEPLOYMENT_TIMEOUT: 11,
	BUILD_FAILED: 12,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export function exit(code: number): never {
	process.exit(code);
}
