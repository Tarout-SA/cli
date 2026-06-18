import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	getProjectConfigDir,
	getProjectConfigPath,
	setProjectConfig,
} from "../../src/lib/config";

describe("CLI project config permissions", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("writes local project metadata with private permissions", () => {
		const basePath = mkdtempSync(join(tmpdir(), "tarout-cli-config-"));
		tempDirs.push(basePath);

		setProjectConfig(
			{
				applicationId: "app_123",
				name: "example",
				organizationId: "org_123",
				linkedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
			},
			basePath,
		);

		if (process.platform === "win32") {
			expect(statSync(getProjectConfigPath(basePath)).isFile()).toBe(true);
			return;
		}

		expect(statSync(getProjectConfigDir(basePath)).mode & 0o777).toBe(0o700);
		expect(statSync(getProjectConfigPath(basePath)).mode & 0o777).toBe(
			0o600,
		);
	});
});
