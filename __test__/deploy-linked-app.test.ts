import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveDeploymentTarget } from "../src/commands/deploy";
import { setGlobalOptions } from "../src/lib/output";

/**
 * App-selection behavior:
 *
 *  1. `tarout deploy` NEVER silently reuses an app — even a linked one. When any
 *     app exists it asks create-vs-reuse (a needs_input in agent mode), listing
 *     the linked app first as a reuse option. `--app`/`--new-app` skip the prompt.
 *  2. The re-invoke hint points at the real mechanism — the positional arg
 *     `tarout deploy <id|name>` — not the non-existent `--app` flag.
 */

function captureNeedsInput(
	run: () => Promise<unknown>,
): Promise<Record<string, unknown> | undefined> {
	return (async () => {
		const logs: string[] = [];
		const origLog = console.log;
		const origExit = process.exit;
		console.log = (...a: unknown[]) => {
			logs.push(a.map(String).join(" "));
		};
		process.exit = ((code?: number) => {
			throw new Error(`__EXIT_${code ?? 0}`);
		}) as never;
		try {
			await run();
			throw new Error("expected needs_input exit, but resolution returned");
		} catch (err) {
			expect(String(err)).toContain("__EXIT_6");
		} finally {
			console.log = origLog;
			process.exit = origExit;
		}
		return logs
			.map((l) => {
				try {
					return JSON.parse(l);
				} catch {
					return null;
				}
			})
			.find((x) => x?.field === "deploy_app");
	})();
}

const PROFILE = {
	token: "t",
	apiUrl: "https://tarout.sa",
	userId: "u",
	userEmail: "u@e.com",
	organizationId: "org_1",
	organizationName: "Org",
	environmentId: "env_1",
	environmentName: "production",
} as any;

const DEMO_APP = { applicationId: "app_demo1234", name: "demo", appName: "demo" };

// `application.one` details — a configured github source, so the non-prompting
// path is actually exercised (a "drop" app would early-return true anyway).
const DEMO_DETAILS = {
	applicationId: "app_demo1234",
	name: "demo",
	sourceType: "github",
	owner: "acme",
	repository: "demo",
};

function fakeClient() {
	return {
		application: {
			allByOrganization: { query: async () => [DEMO_APP] },
			one: { query: async () => DEMO_DETAILS },
		},
	};
}

let tmp: string;
let prevCwd: string;

beforeEach(() => {
	prevCwd = process.cwd();
	tmp = mkdtempSync(join(tmpdir(), "tarout-deploy-"));
	process.chdir(tmp);
});

afterEach(() => {
	process.chdir(prevCwd);
	rmSync(tmp, { recursive: true, force: true });
	setGlobalOptions({ json: false, nonInteractive: false, quiet: false });
});

function writeLink() {
	mkdirSync(join(tmp, ".tarout"), { recursive: true });
	writeFileSync(
		join(tmp, ".tarout", "project.json"),
		JSON.stringify({
			applicationId: "app_demo1234",
			name: "demo",
			organizationId: "org_1",
			linkedAt: new Date().toISOString(),
		}),
	);
}

describe("resolveDeploymentTarget — linked app no longer auto-reused", () => {
	it("asks create-vs-reuse (needs_input) instead of silently reusing the linked app", async () => {
		writeLink();
		setGlobalOptions({ json: true, nonInteractive: true });

		const needsInput = await captureNeedsInput(() =>
			resolveDeploymentTarget(
				fakeClient(),
				PROFILE,
				undefined,
				{ source: "upload" },
				"upload",
			),
		);

		expect(needsInput).toBeTruthy();
		expect(needsInput?.field).toBe("deploy_app");
		// The linked app is offered as a reuse option and flagged in context.
		const choices = (needsInput?.choices ?? []) as Array<{ value: string }>;
		expect(choices.some((c) => c.value === "app_demo1234")).toBe(true);
		expect((needsInput?.context as any)?.linkedApp?.id).toBe("app_demo1234");
	});

	it("an explicit positional app id still reuses without prompting", async () => {
		writeLink();
		setGlobalOptions({ json: true, nonInteractive: true });

		const target = await resolveDeploymentTarget(
			fakeClient(),
			PROFILE,
			"app_demo1234",
			{ source: "upload" },
			"upload",
		);

		expect(target.app.applicationId).toBe("app_demo1234");
		expect(target.createdApp).toBe(false);
	});
});

describe("resolveDeploymentTarget — no linked app prompt", () => {
	it("emits a needs_input whose hint names the positional arg, not --app", async () => {
		// No .tarout/project.json → linkedApp is undefined → must ASK.
		setGlobalOptions({ json: true, nonInteractive: true });

		const logs: string[] = [];
		const origLog = console.log;
		const origExit = process.exit;
		console.log = (...a: unknown[]) => {
			logs.push(a.map(String).join(" "));
		};
		// Agent-mode select() emits needs_input then process.exit(6); make that
		// catchable so the assertion can inspect the emitted envelope.
		process.exit = ((code?: number) => {
			throw new Error(`__EXIT_${code ?? 0}`);
		}) as never;

		try {
			await resolveDeploymentTarget(
				fakeClient(),
				PROFILE,
				undefined,
				{},
				"auto",
			);
			throw new Error("expected needs_input exit, but resolution returned");
		} catch (err) {
			expect(String(err)).toContain("__EXIT_6");
		} finally {
			console.log = origLog;
			process.exit = origExit;
		}

		const needsInput = logs
			.map((l) => {
				try {
					return JSON.parse(l);
				} catch {
					return null;
				}
			})
			.find((x) => x?.field === "deploy_app");

		expect(needsInput).toBeTruthy();
		expect(needsInput.flag).toContain("tarout deploy <id|name>");
		expect(needsInput.flag).not.toContain("--app <id|name>");
	});
});
