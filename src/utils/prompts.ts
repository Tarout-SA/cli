import inquirer from "inquirer";
import {
	type NeedsInputRequest,
	isJsonMode,
	outputNeedsInput,
} from "../lib/output.js";
import { ExitCode, exit } from "./exit-codes.js";

export async function confirm(
	message: string,
	defaultValue = false,
): Promise<boolean> {
	const { confirmed } = await inquirer.prompt([
		{
			type: "confirm",
			name: "confirmed",
			message,
			default: defaultValue,
		},
	]);
	return confirmed;
}

export async function input(
	message: string,
	defaultValue?: string,
): Promise<string> {
	const { value } = await inquirer.prompt([
		{
			type: "input",
			name: "value",
			message,
			default: defaultValue,
		},
	]);
	return value;
}

export async function select<T extends string>(
	message: string,
	choices: Array<{ name: string; value: T }>,
): Promise<T> {
	const { value } = await inquirer.prompt([
		{
			type: "list",
			name: "value",
			message,
			choices,
		},
	]);
	return value;
}

export async function password(message: string): Promise<string> {
	const { value } = await inquirer.prompt([
		{
			type: "password",
			name: "value",
			message,
			mask: "*",
		},
	]);
	return value;
}

/**
 * Either prompt the human user via inquirer (TTY mode) or emit a
 * structured needs_input event and exit (JSON / agent mode).
 *
 * Used at deploy-flow choice points so an external coding agent can read
 * the request from stdout, ask its human user in chat, then re-invoke
 * the CLI with the answer passed via `req.flag`. Exits with
 * ExitCode.NEEDS_INPUT in the JSON path; never returns.
 */
export async function promptOrEmit<T>(
	req: NeedsInputRequest,
	fallback: () => Promise<T>,
): Promise<T> {
	if (isJsonMode()) {
		outputNeedsInput(req);
		exit(ExitCode.NEEDS_INPUT);
	}
	return fallback();
}
