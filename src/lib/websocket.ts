/**
 * @fileoverview WebSocket client for streaming deployment logs.
 * Connects to the Tarout platform's WebSocket server to receive real-time
 * deployment output for CLI monitoring.
 * @module lib/websocket
 */

import WebSocket from "ws";
import { getApiUrl, getToken } from "./config.js";

/** Configuration options for the WebSocket connection */
export interface WebSocketOptions {
	/** Callback invoked for each log line received */
	onData: (data: string) => void;
	/** Callback invoked when the connection closes */
	onClose?: (code: number, reason: string) => void;
	/** Callback invoked on connection errors */
	onError?: (error: Error) => void;
	/** Callback invoked when connection is established */
	onOpen?: () => void;
}

/** Result from streaming deployment logs */
export interface StreamResult {
	/** Function to close the WebSocket connection */
	cleanup: () => void;
	/** Promise that resolves when the connection closes */
	done: Promise<{ code: number; reason: string }>;
}

/**
 * Streams deployment logs from the server via WebSocket.
 * Connects to /listen-deployment endpoint and streams log output in real-time.
 *
 * @param deploymentId - The deployment record id to stream
 * @param options - Callbacks for handling WebSocket events
 * @returns Object containing cleanup function and completion promise
 *
 * @example
 * const { cleanup, done } = streamDeploymentLogs("deployment_123", {
 *   onData: (line) => console.log(line),
 *   onClose: () => console.log("Stream ended"),
 * });
 *
 * // Later, to stop streaming:
 * cleanup();
 *
 * // Or wait for natural completion:
 * const { code, reason } = await done;
 */
export function streamDeploymentLogs(
	deploymentId: string,
	options: WebSocketOptions,
): StreamResult {
	const token = getToken();
	const apiUrl = getApiUrl();

	// Convert HTTP(S) URL to WS(S)
	const wsUrl = apiUrl.replace(/^http/, "ws");
	const fullUrl = `${wsUrl}/listen-deployment?deploymentId=${encodeURIComponent(deploymentId)}`;

	const ws = new WebSocket(fullUrl, {
		headers: {
			"x-api-key": token || "",
		},
	});

	let buffer = "";

	// Create a promise that resolves when the connection closes
	const done = new Promise<{ code: number; reason: string }>((resolve) => {
		ws.on("close", (code, reason) => {
			// Process any remaining data in buffer
			if (buffer.length > 0) {
				options.onData(buffer);
			}

			options.onClose?.(code, reason.toString());
			resolve({ code, reason: reason.toString() });
		});
	});

	ws.on("open", () => {
		options.onOpen?.();
	});

	ws.on("message", (data) => {
		// Append incoming data to buffer
		buffer += data.toString();

		// Process complete lines
		const lines = buffer.split("\n");
		// Keep the last incomplete line in the buffer
		buffer = lines.pop() || "";

		// Emit each complete line
		for (const line of lines) {
			if (line.length > 0) {
				options.onData(line);
			}
		}
	});

	ws.on("error", (error) => {
		options.onError?.(error);
	});

	const cleanup = () => {
		if (ws.readyState === WebSocket.OPEN) {
			ws.close();
		}
	};

	return { cleanup, done };
}

/**
 * Creates a connection to stream deployment logs and collects them.
 * This is a higher-level wrapper that handles the common use case of
 * collecting all logs until deployment completes.
 *
 * @param deploymentId - The deployment record id to stream
 * @param callbacks - Optional callbacks for real-time updates
 * @returns Promise resolving to collected log lines
 *
 * @example
 * const logs = await collectDeploymentLogs("deployment_123", {
 *   onLine: (line) => process.stdout.write(line + "\n"),
 * });
 * console.log(`Collected ${logs.length} log lines`);
 */
export async function collectDeploymentLogs(
	deploymentId: string,
	callbacks?: {
		onLine?: (line: string) => void;
		onError?: (error: Error) => void;
	},
): Promise<string[]> {
	const lines: string[] = [];

	const { done } = streamDeploymentLogs(deploymentId, {
		onData: (line) => {
			lines.push(line);
			callbacks?.onLine?.(line);
		},
		onError: callbacks?.onError,
	});

	await done;
	return lines;
}
