/**
 * Structured JSON output for AI-friendly CLI
 */

export interface JsonSuccessResponse<T> {
	success: true;
	data: T;
	meta?: {
		total?: number;
		page?: number;
	};
}

export interface JsonErrorResponse {
	success: false;
	error: {
		code: string;
		message: string;
		suggestions?: string[];
		details?: unknown;
	};
}

export type JsonResponse<T> = JsonSuccessResponse<T> | JsonErrorResponse;

export function jsonSuccess<T>(
	data: T,
	meta?: JsonSuccessResponse<T>["meta"],
): JsonSuccessResponse<T> {
	return {
		success: true,
		data,
		...(meta && { meta }),
	};
}

export function jsonError(
	code: string,
	message: string,
	suggestions?: string[],
	details?: unknown,
): JsonErrorResponse {
	return {
		success: false,
		error: {
			code,
			message,
			...(suggestions && { suggestions }),
			...(details !== undefined && { details }),
		},
	};
}

export function outputJson<T>(response: JsonResponse<T>): void {
	console.log(JSON.stringify(response, null, 2));
}
