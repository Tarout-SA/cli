import ora, { type Ora } from "ora";
import { isJsonMode } from "../lib/output.js";

let currentSpinner: Ora | null = null;

/**
 * Agents driving the CLI expect pure NDJSON on stdout. Spinners (ora)
 * inject TTY frames and Unicode symbols that would corrupt the stream,
 * so we no-op every spinner call when --json is active. The shared
 * `outputJsonLine` / `outputData` / `outputError` helpers carry the
 * progress signal in JSON form instead.
 */
function jsonMode(): boolean {
	try {
		return isJsonMode();
	} catch {
		return false;
	}
}

export function startSpinner(text: string): Ora | null {
	if (jsonMode()) return null;
	// Stop any existing spinner
	if (currentSpinner) {
		currentSpinner.stop();
	}
	currentSpinner = ora(text).start();
	return currentSpinner;
}

export function succeedSpinner(text?: string): void {
	if (jsonMode()) return;
	if (currentSpinner) {
		currentSpinner.succeed(text);
		currentSpinner = null;
	}
}

export function failSpinner(text?: string): void {
	if (jsonMode()) return;
	if (currentSpinner) {
		currentSpinner.fail(text);
		currentSpinner = null;
	}
}

export function stopSpinner(): void {
	if (jsonMode()) return;
	if (currentSpinner) {
		currentSpinner.stop();
		currentSpinner = null;
	}
}

export function updateSpinner(text: string): void {
	if (jsonMode()) return;
	if (currentSpinner) {
		currentSpinner.text = text;
	}
}
