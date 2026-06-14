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
	// External agent must collect a value and re-invoke. Pairs with a
	// `needs_input` JSON event on stdout. Distinct from INVALID_ARGUMENTS so
	// the agent doesn't treat a missing-input case as a malformed call.
	NEEDS_INPUT: 6,
	// Deployment-specific exit codes
	DEPLOYMENT_FAILED: 10,
	DEPLOYMENT_TIMEOUT: 11,
	BUILD_FAILED: 12,
	// A hosted checkout is still PENDING (not paid yet, not failed). The agent
	// should resume polling (`tarout billing wait <orderId>`) or surface the
	// payment URL to a human — distinct from GENERAL_ERROR so a resumable
	// checkout isn't treated as a hard failure.
	CHECKOUT_PENDING: 13,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

export function exit(code: number): never {
	process.exit(code);
}
