import type { Command } from "commander";
import { getApiClient } from "../lib/api.js";
import { isLoggedIn } from "../lib/config.js";
import { AuthError, handleError } from "../lib/errors.js";
import { colors, isJsonMode, log, outputData, table } from "../lib/output.js";
import { failSpinner, startSpinner, succeedSpinner } from "../utils/spinner.js";

export function registerDashboardCommands(program: Command) {
	const dashboard = program
		.command("dashboard")
		.description("View organization dashboard overview");

	// ── Overview ─────────────────────────────────────────────────────────────────
	dashboard
		.command("overview")
		.alias("status")
		.description("Show overall organization resource summary")
		.action(async () => {
			try {
				if (!isLoggedIn()) throw new AuthError();
				const client = getApiClient();
				const _spinner = startSpinner("Fetching dashboard...");
				const data = await client.dashboard.getOverview.query();
				succeedSpinner();

				if (isJsonMode()) {
					outputData(data);
					return;
				}

				const d = data as any;
				log("");
				log(colors.bold("Organization Overview"));
				log("");

				if (d.apps !== undefined || d.applications !== undefined) {
					log(
						`  Applications: ${colors.cyan(String(d.apps ?? d.applications ?? 0))}`,
					);
				}
				if (d.databases !== undefined || d.dbs !== undefined) {
					log(
						`  Databases:    ${colors.cyan(String(d.databases ?? d.dbs ?? 0))}`,
					);
				}
				if (d.deployments !== undefined) {
					log(`  Deployments:  ${colors.cyan(String(d.deployments ?? 0))}`);
				}
				if (d.domains !== undefined) {
					log(`  Domains:      ${colors.cyan(String(d.domains ?? 0))}`);
				}
				if (d.servers !== undefined) {
					log(`  Servers:      ${colors.cyan(String(d.servers ?? 0))}`);
				}
				if (d.storage !== undefined) {
					log(`  Storage:      ${colors.cyan(String(d.storage ?? 0))}`);
				}

				if (d.serverHealth !== undefined) {
					log("");
					log(
						`  Server health: ${d.serverHealth === "healthy" ? colors.success("healthy") : colors.warn(d.serverHealth || "unknown")}`,
					);
				}

				log("");
			} catch (err) {
				failSpinner();
				handleError(err);
			}
		});

	// ── Active plans ──────────────────────────────────────────────────────────────
	dashboard
		.command("plans")
		.description("Show active paid resources and plans")
		.action(async () => {
			try {
				if (!isLoggedIn()) throw new AuthError();
				const client = getApiClient();
				const _spinner = startSpinner("Fetching active plans...");
				const data = await client.dashboard.getActivePlans.query();
				succeedSpinner();

				if (isJsonMode()) {
					outputData(data);
					return;
				}

				const list = Array.isArray(data) ? data : (data as any)?.items || [];
				if (list.length === 0) {
					log("");
					log("No active paid resources.");
					return;
				}

				log("");
				log(colors.bold("Active Paid Resources"));
				log("");
				table(
					["NAME", "TYPE", "PLAN", "STATUS"],
					list.map((item: any) => [
						colors.bold(item.name || "-"),
						item.type || item.resourceType || "-",
						colors.cyan(item.plan || item.planKey || "-"),
						item.status === "running" || item.applicationStatus === "running"
							? colors.success(item.status || item.applicationStatus || "-")
							: colors.dim(item.status || item.applicationStatus || "-"),
					]),
				);
				log("");
				log(
					colors.dim(`${list.length} resource${list.length === 1 ? "" : "s"}`),
				);
			} catch (err) {
				failSpinner();
				handleError(err);
			}
		});
}
