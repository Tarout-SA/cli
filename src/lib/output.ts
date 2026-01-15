/**
 * @fileoverview Output formatting and display utilities for the CLI.
 * Handles colored output, tables, JSON mode, and respects global flags.
 * @module lib/output
 */

import chalk from "chalk";
import Table from "cli-table3";
import { jsonError, jsonSuccess, outputJson } from "../utils/json.js";

/** Global CLI options affecting output behavior */
let globalOptions = {
	json: false,
	quiet: false,
	verbose: false,
	noColor: false,
	yes: false,
};

export function setGlobalOptions(options: Partial<typeof globalOptions>): void {
	globalOptions = { ...globalOptions, ...options };
}

export function getGlobalOptions() {
	return globalOptions;
}

export function isJsonMode(): boolean {
	return globalOptions.json;
}

export function isQuietMode(): boolean {
	return globalOptions.quiet;
}

export function isVerboseMode(): boolean {
	return globalOptions.verbose;
}

export function shouldSkipConfirmation(): boolean {
	return globalOptions.yes;
}

// Color helpers that respect --no-color
function c(colorFn: (str: string) => string, str: string): string {
	return globalOptions.noColor ? str : colorFn(str);
}

export const colors = {
	success: (str: string) => c(chalk.green, str),
	error: (str: string) => c(chalk.red, str),
	warn: (str: string) => c(chalk.yellow, str),
	info: (str: string) => c(chalk.blue, str),
	dim: (str: string) => c(chalk.dim, str),
	bold: (str: string) => c(chalk.bold, str),
	cyan: (str: string) => c(chalk.cyan, str),
};

// Status badges
export function getStatusBadge(status: string): string {
	const badges: Record<string, string> = {
		running: colors.success("● running"),
		idle: colors.warn("○ idle"),
		error: colors.error("✗ error"),
		done: colors.success("✓ done"),
		deploying: colors.info("◐ deploying"),
		stopped: colors.dim("○ stopped"),
		cancelled: colors.warn("○ cancelled"),
	};
	return badges[status.toLowerCase()] || status;
}

// Output functions
export function log(message: string): void {
	if (!globalOptions.quiet && !globalOptions.json) {
		console.log(message);
	}
}

export function info(message: string): void {
	if (!globalOptions.quiet && !globalOptions.json) {
		console.log(colors.info(message));
	}
}

export function success(message: string): void {
	if (!globalOptions.quiet && !globalOptions.json) {
		console.log(colors.success(`✓ ${message}`));
	}
}

export function warn(message: string): void {
	if (!globalOptions.json) {
		console.log(colors.warn(`⚠ ${message}`));
	}
}

export function error(message: string, suggestions?: string[]): void {
	if (globalOptions.json) {
		outputJson(jsonError("ERROR", message, suggestions));
		return;
	}

	console.error(colors.error(`Error: ${message}`));

	if (suggestions && suggestions.length > 0) {
		console.error("");
		console.error("Did you mean one of these?");
		for (const suggestion of suggestions) {
			console.error(colors.dim(`  - ${suggestion}`));
		}
	}
}

export function verbose(message: string): void {
	if (globalOptions.verbose && !globalOptions.json) {
		console.log(colors.dim(`[verbose] ${message}`));
	}
}

// Table output
export function table(headers: string[], rows: string[][]): void {
	if (globalOptions.json) {
		return;
	}

	const t = new Table({
		head: headers.map((h) => colors.bold(h)),
		style: { head: [], border: [] },
		chars: {
			top: "",
			"top-mid": "",
			"top-left": "",
			"top-right": "",
			bottom: "",
			"bottom-mid": "",
			"bottom-left": "",
			"bottom-right": "",
			left: "  ",
			"left-mid": "",
			mid: "",
			"mid-mid": "",
			right: "",
			"right-mid": "",
			middle: "  ",
		},
	});

	for (const row of rows) {
		t.push(row);
	}

	console.log(t.toString());
}

// JSON output helpers
export function outputSuccess<T>(data: T, meta?: { total?: number }): void {
	if (globalOptions.json) {
		outputJson(jsonSuccess(data, meta));
	}
}

export function outputData<T>(data: T): void {
	if (globalOptions.json) {
		outputJson(jsonSuccess(data));
	}
}

// Quiet mode output (only essential info)
export function quietOutput(message: string): void {
	if (globalOptions.quiet || globalOptions.json) {
		console.log(message);
	}
}

// Box for important info
export function box(title: string, content: string[]): void {
	if (globalOptions.json || globalOptions.quiet) {
		return;
	}

	console.log("");
	console.log(colors.bold(title));
	for (const line of content) {
		console.log(`  ${line}`);
	}
	console.log("");
}
