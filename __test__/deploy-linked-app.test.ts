import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveDeploymentTarget } from "../src/commands/deploy";
import { setGlobalOptions } from "../src/lib/output";

/**
 * Regression guard for two agent-breaking deploy bugs (reported against 0.8.x):
 *
 *  1. A bare `tarout deploy` on a directory linked via `.tarout/project.json`
 *     must silently redeploy the linked app — NOT emit a create-vs-reuse
 *     needs_input. In an agent (non-TTY/JSON) context the prompt was a hard
 *     halt (exit 6) that broke the documented "redeploy just works" path.
 *  2. When there IS no linked app and the CLI must ask, the re-invoke hint must
 *     point at the real mechanism — the positional arg `tarout deploy <id|name>`
 *     — not the non-existent `--app` flag.
 */

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

describe("resolveDeploymentTarget — linked app redeploy", () => {
	it("reuses the linked app without prompting in agent (JSON) mode", async () => {
		writeLink();
		setGlobalOptions({ json: true, nonInteractive: true });

		const target = await resolveDeploymentTarget(
			fakeClient(),
			PROFILE,
			undefined,
			{ source: "upload" },
			"upload",
		);

		expect(target.app.name).toBe("demo");
		expect(target.app.applicationId).toBe("app_demo1234");
		expect(target.createdApp).toBe(false);
	});

	it("reuses the linked app even without --yes and without a TTY", async () => {
		writeLink();
		setGlobalOptions({ json: false, nonInteractive: true });

		const target = await resolveDeploymentTarget(
			fakeClient(),
			PROFILE,
			undefined,
			{},
			"auto",
		);

		expect(target.app.name).toBe("demo");
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
