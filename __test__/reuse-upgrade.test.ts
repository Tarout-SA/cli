import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	finalizeDatabaseReuse,
	finalizeStorageReuse,
} from "../src/commands/deploy";
import { setGlobalOptions } from "../src/lib/output";

/**
 * Reusing a DB/bucket at a higher requested plan must NOT silently skip the
 * upgrade in agent mode. We assert a `reuse_plan_unchanged` JSON event is
 * emitted (so an agent learns the resource stayed put + the upgrade command),
 * and that no billing mutation is attempted on the client.
 */
const throwingClient = {
	postgres: {
		upgrade: {
			mutate: async () => {
				throw new Error("client should not be called in agent mode");
			},
		},
	},
	storage: {
		upgrade: {
			mutate: async () => {
				throw new Error("client should not be called in agent mode");
			},
		},
	},
};

function captureJsonLines(fn: () => Promise<void>): Promise<string[]> {
	const lines: string[] = [];
	const spy = vi.spyOn(console, "log").mockImplementation((msg) => {
		if (typeof msg === "string") lines.push(msg);
	});
	return fn().then(() => {
		spy.mockRestore();
		return lines;
	});
}

describe("reuse upgrade in agent (JSON) mode is non-silent", () => {
	beforeEach(() => setGlobalOptions({ json: true, yes: false }));
	afterEach(() => setGlobalOptions({ json: false }));

	it("database reuse at a higher plan emits reuse_plan_unchanged and stays put", async () => {
		let decision: Awaited<ReturnType<typeof finalizeDatabaseReuse>> | undefined;
		const lines = await captureJsonLines(async () => {
			decision = await finalizeDatabaseReuse(
				throwingClient,
				{ id: "db_1", name: "maindb", plan: "FREE" },
				"postgres",
				"STANDARD",
				true,
			);
		});
		const events = lines.map((l) => JSON.parse(l));
		const notice = events.find((e) => e.event === "reuse_plan_unchanged");
		expect(notice).toBeDefined();
		expect(notice.resourceType).toBe("database");
		expect(notice.currentPlan).toBe("FREE");
		expect(notice.requestedPlan).toBe("STANDARD");
		expect(notice.nextCommand).toContain("tarout db upgrade maindb --plan standard");
		// stayed on the existing plan, no upgrade performed
		expect(decision?.plan).toBe("FREE");
		expect((decision as { upgraded?: boolean })?.upgraded).toBe(false);
	});

	it("storage reuse at a higher plan emits reuse_plan_unchanged and stays put", async () => {
		let decision: Awaited<ReturnType<typeof finalizeStorageReuse>> | undefined;
		const lines = await captureJsonLines(async () => {
			decision = await finalizeStorageReuse(
				throwingClient,
				{ bucketId: "bkt_1", name: "assets", plan: "STARTER" },
				"PRO",
				true,
			);
		});
		const events = lines.map((l) => JSON.parse(l));
		const notice = events.find((e) => e.event === "reuse_plan_unchanged");
		expect(notice).toBeDefined();
		expect(notice.resourceType).toBe("storage");
		expect(notice.nextCommand).toContain("tarout storage upgrade assets --plan pro");
		expect(decision?.plan).toBe("STARTER");
	});

	it("a lower requested plan emits reuse_plan_lower", async () => {
		const lines = await captureJsonLines(async () => {
			await finalizeStorageReuse(
				throwingClient,
				{ bucketId: "bkt_2", name: "assets2", plan: "PRO" },
				"STARTER",
				true,
			);
		});
		const events = lines.map((l) => JSON.parse(l));
		expect(events.some((e) => e.event === "reuse_plan_lower")).toBe(true);
	});
});
