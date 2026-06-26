import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureDatabasePlan } from "../src/commands/deploy";
import { setGlobalOptions } from "../src/lib/output";

/**
 * `ensureDatabasePlan` defaults a new database to the org's subscribed tier and
 * NEVER buys an add-on: add-ons aren't sold standalone, so a paid org with no
 * open slot resolves to `{ok:false}` carrying the exhausted entitlement key and
 * the caller surfaces a plan-upgrade prompt. These tests drive it with a
 * scripted fake tRPC client — no DB, no payment gateway.
 */

type Tier = {
	tier: string;
	canCreate: boolean;
	limit: number;
	available: number;
	monthlyHalalas: number;
};

function tier(
	t: string,
	limit: number,
	used: number,
	monthlyHalalas: number,
): Tier {
	return {
		tier: t,
		limit,
		available: Math.max(0, limit - used),
		canCreate: used < limit,
		monthlyHalalas,
	};
}

function fakeClient(opts: {
	planKey?: string | null;
	tiers?: Tier[];
	onPurchase?: (input: unknown) => void;
	onTiers?: () => void;
}) {
	return {
		subscription: {
			getCurrent: {
				query: async () => ({ planKey: opts.planKey ?? "free" }),
			},
			// Present so a regression that reintroduces auto-buy is caught loudly.
			purchaseAddons: {
				mutate: async (input: unknown) => {
					opts.onPurchase?.(input);
					return { applied: true };
				},
			},
		},
		postgres: {
			getEntitlements: {
				query: async () => {
					opts.onTiers?.();
					return { tiers: opts.tiers ?? [] };
				},
			},
		},
	};
}

const savedDisplay = process.env.DISPLAY;
const savedWayland = process.env.WAYLAND_DISPLAY;

beforeEach(() => {
	setGlobalOptions({ json: true, nonInteractive: true });
	delete process.env.DISPLAY;
	delete process.env.WAYLAND_DISPLAY;
});

afterEach(() => {
	setGlobalOptions({ json: false, nonInteractive: false });
	if (savedDisplay === undefined) delete process.env.DISPLAY;
	else process.env.DISPLAY = savedDisplay;
	if (savedWayland === undefined) delete process.env.WAYLAND_DISPLAY;
	else process.env.WAYLAND_DISPLAY = savedWayland;
});

describe("ensureDatabasePlan", () => {
	it("Starter org with no open DB slot → needs upgrade, NO purchase", async () => {
		let purchaseCalled = false;
		const client = fakeClient({
			planKey: "shared",
			tiers: [
				tier("FREE", 0, 0, 0),
				tier("STARTER", 0, 0, 2900),
				tier("STANDARD", 0, 0, 4900),
				tier("PRO", 0, 0, 9900),
			],
			onPurchase: () => {
				purchaseCalled = true;
			},
		});
		const r = await ensureDatabasePlan(client, undefined);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.failedKey).toMatch(/^db\..*\.slots$/);
			expect(r.currentPlanKey).toBe("shared");
		}
		expect(purchaseCalled).toBe(false);
	});

	it("Dedicated org with a bundled db.standard slot → STANDARD, NO purchase", async () => {
		let purchaseCalled = false;
		const client = fakeClient({
			planKey: "dedicated_small",
			tiers: [
				tier("FREE", 0, 0, 0),
				tier("STARTER", 0, 0, 2900),
				tier("STANDARD", 5, 0, 4900), // bundled with the dedicated plan
				tier("PRO", 0, 0, 9900),
			],
			onPurchase: () => {
				purchaseCalled = true;
			},
		});
		const r = await ensureDatabasePlan(client, undefined);
		expect(r).toEqual({ ok: true, plan: "STANDARD" });
		expect(purchaseCalled).toBe(false);
	});

	it("Dedicated org with bundled db.standard exhausted → needs upgrade, NO purchase", async () => {
		let purchaseCalled = false;
		const client = fakeClient({
			planKey: "dedicated_small",
			tiers: [tier("STANDARD", 5, 5, 4900), tier("PRO", 0, 0, 9900)],
			onPurchase: () => {
				purchaseCalled = true;
			},
		});
		const r = await ensureDatabasePlan(client, undefined);
		expect(r.ok).toBe(false);
		if (!r.ok) {
			// The org owns db.standard (limit > 0), so the gate names that tier.
			expect(r.failedKey).toBe("db.standard.slots");
		}
		expect(purchaseCalled).toBe(false);
	});

	it("free org with an open free DB slot → FREE, no purchase", async () => {
		let purchaseCalled = false;
		const client = fakeClient({
			planKey: "free",
			tiers: [tier("FREE", 1, 0, 0), tier("STARTER", 0, 0, 2900)],
			onPurchase: () => {
				purchaseCalled = true;
			},
		});
		const r = await ensureDatabasePlan(client, undefined);
		expect(r).toEqual({ ok: true, plan: "FREE" });
		expect(purchaseCalled).toBe(false);
	});

	it("explicit non-free tier wins — no tier lookup, no purchase", async () => {
		let tiersCalled = false;
		let purchaseCalled = false;
		const client = fakeClient({
			planKey: "shared",
			onTiers: () => {
				tiersCalled = true;
			},
			onPurchase: () => {
				purchaseCalled = true;
			},
		});
		const r = await ensureDatabasePlan(client, "PRO");
		expect(r).toEqual({ ok: true, plan: "PRO" });
		expect(tiersCalled).toBe(false);
		expect(purchaseCalled).toBe(false);
	});

	it("explicit FREE on a paid org is dropped → resolves the org's real tier", async () => {
		const client = fakeClient({
			planKey: "shared",
			tiers: [tier("FREE", 0, 0, 0), tier("STANDARD", 1, 0, 4900)],
		});
		const r = await ensureDatabasePlan(client, "FREE");
		expect(r).toEqual({ ok: true, plan: "STANDARD" });
	});
});
