import { describe, expect, it } from "vitest";
import { classifyPlanDirection } from "../src/commands/billing";

const PLANS = [
	{ planKey: "free", sortOrder: 0, priceHalalas: 0 },
	{ planKey: "shared", sortOrder: 1, priceHalalas: 1900 },
	{ planKey: "dedicated_1", sortOrder: 2, priceHalalas: 9900 },
];

describe("classifyPlanDirection", () => {
	it("detects a downgrade (higher → lower)", () => {
		expect(classifyPlanDirection(PLANS, "dedicated_1", "shared")).toBe("downgrade");
	});
	it("detects an upgrade (lower → higher)", () => {
		expect(classifyPlanDirection(PLANS, "shared", "dedicated_1")).toBe("upgrade");
	});
	it("detects the same plan", () => {
		expect(classifyPlanDirection(PLANS, "shared", "shared")).toBe("same");
	});
	it("treats paid → free as a downgrade", () => {
		expect(classifyPlanDirection(PLANS, "shared", "free")).toBe("downgrade");
	});
	it("throws on an unknown target plan", () => {
		expect(() => classifyPlanDirection(PLANS, "shared", "bogus")).toThrow(/Unknown plan/);
	});
});
