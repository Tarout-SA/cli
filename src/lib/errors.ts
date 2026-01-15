/**
 * @fileoverview Error handling utilities for the CLI.
 * Provides custom error classes and centralized error handling with
 * proper exit codes and user-friendly messages.
 * @module lib/errors
 */

import { ExitCode, exit } from "../utils/exit-codes.js";
import { jsonError, outputJson } from "../utils/json.js";
import { error, isJsonMode } from "./output.js";

/**
 * Base CLI error class with exit code and optional suggestions.
 * @extends Error
 */
export class CliError extends Error {
	constructor(
		message: string,
		public code: number = ExitCode.GENERAL_ERROR,
		public suggestions?: string[],
	) {
		super(message);
		this.name = "CliError";
	}
}

/**
 * Error thrown when the user is not authenticated.
 * Exit code: 3 (AUTH_ERROR)
 */
export class AuthError extends CliError {
	constructor(message = "Not logged in. Run 'tarout login' first.") {
		super(message, ExitCode.AUTH_ERROR);
	}
}

/**
 * Error thrown when a requested resource is not found.
 * Exit code: 4 (NOT_FOUND)
 */
export class NotFoundError extends CliError {
	constructor(resource: string, id: string, suggestions?: string[]) {
		super(`${resource} "${id}" not found`, ExitCode.NOT_FOUND, suggestions);
	}
}

/**
 * Error thrown when the user lacks permission for an action.
 * Exit code: 5 (PERMISSION_DENIED)
 */
export class PermissionError extends CliError {
	constructor(message = "Permission denied") {
		super(message, ExitCode.PERMISSION_DENIED);
	}
}

/**
 * Error thrown for invalid command arguments.
 * Exit code: 2 (INVALID_ARGUMENTS)
 */
export class InvalidArgumentError extends CliError {
	constructor(message: string) {
		super(message, ExitCode.INVALID_ARGUMENTS);
	}
}

/**
 * Centralized error handler for all CLI commands.
 * Formats errors appropriately for JSON or human-readable output,
 * then exits with the appropriate code.
 * @param {unknown} err - The error to handle
 * @returns {never} This function always exits the process
 */
export function handleError(err: unknown): never {
	if (err instanceof CliError) {
		if (isJsonMode()) {
			outputJson(
				jsonError(getErrorCode(err.code), err.message, err.suggestions),
			);
		} else {
			error(err.message, err.suggestions);
		}
		exit(err.code);
	}

	// Handle tRPC errors
	if (err && typeof err === "object" && "code" in err) {
		const trpcError = err as { code: string; message: string };
		const exitCode = mapTrpcErrorCode(trpcError.code);

		if (isJsonMode()) {
			outputJson(jsonError(trpcError.code, trpcError.message));
		} else {
			error(trpcError.message);
		}
		exit(exitCode);
	}

	// Generic error
	const message = err instanceof Error ? err.message : String(err);
	if (isJsonMode()) {
		outputJson(jsonError("UNKNOWN_ERROR", message));
	} else {
		error(message);
	}
	exit(ExitCode.GENERAL_ERROR);
}

function getErrorCode(exitCode: number): string {
	const codes: Record<number, string> = {
		[ExitCode.SUCCESS]: "SUCCESS",
		[ExitCode.GENERAL_ERROR]: "ERROR",
		[ExitCode.INVALID_ARGUMENTS]: "INVALID_ARGUMENTS",
		[ExitCode.AUTH_ERROR]: "AUTH_ERROR",
		[ExitCode.NOT_FOUND]: "NOT_FOUND",
		[ExitCode.PERMISSION_DENIED]: "PERMISSION_DENIED",
	};
	return codes[exitCode] || "ERROR";
}

function mapTrpcErrorCode(code: string): number {
	const mapping: Record<string, number> = {
		UNAUTHORIZED: ExitCode.AUTH_ERROR,
		FORBIDDEN: ExitCode.PERMISSION_DENIED,
		NOT_FOUND: ExitCode.NOT_FOUND,
		BAD_REQUEST: ExitCode.INVALID_ARGUMENTS,
		PARSE_ERROR: ExitCode.INVALID_ARGUMENTS,
	};
	return mapping[code] || ExitCode.GENERAL_ERROR;
}

/**
 * Finds similar strings to a target using fuzzy matching (Dice coefficient).
 * Useful for providing "did you mean?" suggestions when a resource isn't found.
 * @param {string} target - The string to match against
 * @param {string[]} candidates - Array of possible matches
 * @param {number} [maxResults=3] - Maximum number of suggestions to return
 * @returns {string[]} Array of similar strings, sorted by similarity
 * @example
 * findSimilar("my-ap", ["my-app", "your-app", "test"]) // ["my-app"]
 */
export function findSimilar(
	target: string,
	candidates: string[],
	maxResults = 3,
): string[] {
	const targetLower = target.toLowerCase();

	return candidates
		.map((candidate) => ({
			candidate,
			score: similarity(targetLower, candidate.toLowerCase()),
		}))
		.filter(({ score }) => score > 0.3)
		.sort((a, b) => b.score - a.score)
		.slice(0, maxResults)
		.map(({ candidate }) => candidate);
}

// Simple similarity score (Dice coefficient)
function similarity(s1: string, s2: string): number {
	if (s1 === s2) return 1;
	if (s1.length < 2 || s2.length < 2) return 0;

	const bigrams1 = new Set<string>();
	for (let i = 0; i < s1.length - 1; i++) {
		bigrams1.add(s1.slice(i, i + 2));
	}

	let intersection = 0;
	for (let i = 0; i < s2.length - 1; i++) {
		if (bigrams1.has(s2.slice(i, i + 2))) {
			intersection++;
		}
	}

	return (2 * intersection) / (s1.length - 1 + s2.length - 1);
}
