import { describe, expect, it } from "vitest";
import {
	assertPostgresTierChange,
	resolveDbTierTarget,
	runDatabaseTierChange,
} from "../src/commands/db";

describe("assertPostgresTierChange", () => {
	it("passes for a postgres database", () => {
		expect(() => assertPostgresTierChange({ type: "postgres", name: "main" })).not.toThrow();
	});
	it("throws a clear error for mysql", () => {
		expect(() => assertPostgresTierChange({ type: "mysql", name: "shop" })).toThrow(/PostgreSQL/);
	});
});

describe("resolveDbTierTarget", () => {
	it("upgrade normalizes to uppercase and accepts pro", () => {
		expect(resolveDbTierTarget("upgrade", "pro")).toBe("PRO");
		expect(resolveDbTierTarget("upgrade", "standard")).toBe("STANDARD");
	});
	it("downgrade accepts standard but rejects pro", () => {
		expect(resolveDbTierTarget("downgrade", "standard")).toBe("STANDARD");
		expect(() => resolveDbTierTarget("downgrade", "pro")).toThrow(/highest tier/);
	});
	it("rejects free, empty, and invalid tiers", () => {
		expect(() => resolveDbTierTarget("upgrade", "free")).toThrow();
		expect(() => resolveDbTierTarget("upgrade", undefined)).toThrow(/required/);
		expect(() => resolveDbTierTarget("upgrade", "huge")).toThrow();
	});
});

describe("runDatabaseTierChange", () => {
	it("upgrade routes to purchaseDatabaseUpgrade and classifies a checkout", async () => {
		let captured: unknown;
		const client = {
			subscription: {
				purchaseDatabaseUpgrade: {
					mutate: async (i: unknown) => {
						captured = i;
						return { applied: false, paymentUrl: "https://pay.test/x", orderId: "ord_1", proratedChargeHalalas: 2000 };
					},
				},
			},
		};
		const r = await runDatabaseTierChange(client, { direction: "upgrade", postgresId: "pg_1", targetPlan: "PRO" });
		expect(captured).toEqual({ postgresId: "pg_1", targetPlan: "PRO" });
		expect(r.status).toBe("payment_required");
		expect(r.kind).toBe("database");
		expect(r.target).toBe("PRO");
	});
	it("downgrade routes to purchaseDatabaseDowngrade and applies immediately", async () => {
		let captured: unknown;
		const client = {
			subscription: {
				purchaseDatabaseDowngrade: {
					mutate: async (i: unknown) => {
						captured = i;
						return { applied: true, proratedChargeHalalas: 0 };
					},
				},
			},
		};
		const r = await runDatabaseTierChange(client, { direction: "downgrade", postgresId: "pg_2", targetPlan: "STARTER" });
		expect(captured).toEqual({ postgresId: "pg_2", targetPlan: "STARTER" });
		expect(r.status).toBe("applied");
		expect(r.kind).toBe("database");
	});
});
