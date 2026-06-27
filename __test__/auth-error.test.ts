import { describe, expect, it } from "vitest";
import { AGENT_LOGIN_HINT, AuthError } from "../src/lib/errors";
import { ExitCode } from "../src/utils/exit-codes";

describe("AuthError", () => {
	it("is exit 3 and carries agent-facing login guidance for the --json envelope", () => {
		const err = new AuthError();
		expect(err.code).toBe(ExitCode.AUTH_ERROR);
		// The structured `details` is what an agent reads to know it should run
		// `tarout login` ITSELF (browser, hands-free) rather than hand it to the user.
		expect(err.details).toMatchObject({
			nextCommand: "tarout login",
			hint: AGENT_LOGIN_HINT,
		});
		expect(err.message).toMatch(/tarout login/);
	});

	it("guidance tells the agent to run login directly, not delegate", () => {
		expect(AGENT_LOGIN_HINT).toMatch(/run `tarout login` directly/i);
		expect(AGENT_LOGIN_HINT).toMatch(/do not ask the user/i);
		expect(AGENT_LOGIN_HINT).toMatch(/--token/); // headless fallback still named
	});
});
