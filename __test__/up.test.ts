import { describe, expect, it } from "vitest";
import {
	inferSuggestedPlan,
	isEntitlementError,
	normalizeSource,
	parseRepo,
} from "../src/commands/up";

describe("tarout up — argument parsing", () => {
	it("defaults --source to upload", () => {
		expect(normalizeSource(undefined)).toBe("upload");
		expect(normalizeSource("")).toBe("upload");
	});

	it("accepts upload and github (case-insensitive)", () => {
		expect(normalizeSource("upload")).toBe("upload");
		expect(normalizeSource("GITHUB")).toBe("github");
		expect(normalizeSource("Github")).toBe("github");
	});

	it("rejects unknown source values with a descriptive error", () => {
		expect(() => normalizeSource("zip")).toThrowError(/Invalid --source/);
		expect(() => normalizeSource("gitlab")).toThrowError(/Invalid --source/);
	});

	it("parses owner/name", () => {
		expect(parseRepo("acme/widget")).toEqual({
			owner: "acme",
			repository: "widget",
		});
	});

	it("parses an HTTPS GitHub URL (with .git suffix)", () => {
		expect(parseRepo("https://github.com/acme/widget.git")).toEqual({
			owner: "acme",
			repository: "widget",
		});
	});

	it("parses an SSH GitHub URL", () => {
		expect(parseRepo("git@github.com:acme/widget.git")).toEqual({
			owner: "acme",
			repository: "widget",
		});
	});

	it("rejects malformed repo strings", () => {
		expect(() => parseRepo("nope")).toThrowError(
			/--repo must be "owner\/name" or a GitHub URL/,
		);
		expect(() => parseRepo("a/b/c")).toThrowError(
			/--repo must be "owner\/name" or a GitHub URL/,
		);
	});
});

describe("tarout up — entitlement detection", () => {
	it("recognizes the exact server message from assertEntitlement", () => {
		expect(
			isEntitlementError({
				code: "FORBIDDEN",
				message:
					"Plan limit reached for app.free.slots: 2/1. Upgrade to add more.",
			}),
		).toBe(true);
	});

	it("recognizes the tRPC-client-wrapped shape (code on .data.code)", () => {
		expect(
			isEntitlementError({
				data: { code: "FORBIDDEN" },
				message:
					"Plan limit reached for app.shared.slots: 6/5. Upgrade to add more.",
			}),
		).toBe(true);
	});

	it("recognizes 'entitlement' and 'active subscription' variants", () => {
		expect(
			isEntitlementError({
				code: "FORBIDDEN",
				message: "Org has no entitlement for app.shared.slots",
			}),
		).toBe(true);
		expect(
			isEntitlementError({
				code: "FORBIDDEN",
				message: "Active subscription required",
			}),
		).toBe(true);
	});

	it("ignores FORBIDDEN errors with unrelated messages (role checks)", () => {
		expect(
			isEntitlementError({
				code: "FORBIDDEN",
				message: "Only org owners can perform this action",
			}),
		).toBe(false);
	});

	it("ignores non-FORBIDDEN errors and non-objects", () => {
		expect(isEntitlementError({ code: "NOT_FOUND", message: "slot" })).toBe(
			false,
		);
		expect(isEntitlementError(null)).toBe(false);
		expect(isEntitlementError(undefined)).toBe(false);
		expect(isEntitlementError("FORBIDDEN")).toBe(false);
	});
});

describe("tarout up — upgrade suggestion", () => {
	it("maps requested plan to the subscription tier that grants its entitlement", () => {
		expect(inferSuggestedPlan("free")).toBe("shared");
		expect(inferSuggestedPlan(undefined)).toBe("shared");
		expect(inferSuggestedPlan("FREE")).toBe("shared");
		expect(inferSuggestedPlan("shared")).toBe("shared");
		expect(inferSuggestedPlan("dedicated")).toBe("dedicated_small");
		expect(inferSuggestedPlan("dedicated_small")).toBe("dedicated_small");
		expect(inferSuggestedPlan("dedicated_medium")).toBe("dedicated_medium");
		expect(inferSuggestedPlan("dedicated_large")).toBe("dedicated_large");
	});
});
