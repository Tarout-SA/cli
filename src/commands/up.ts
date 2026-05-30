/**
 * `tarout up [path]` — single-command, agent-friendly orchestration.
 *
 * Wraps the existing inspect → auth → create → upload/connect → deploy →
 * stream chain into one entry point so an external coding agent can run
 * one command and parse one final JSON envelope.
 *
 * Defaults are agent-first: FREE plan, region me-central2, source=upload,
 * non-interactive. Re-uses the helpers in `deploy.ts` rather than
 * duplicating logic — the canonical create/upload/stream flow lives there.
 */

import { resolve } from "node:path";
import type { Command } from "commander";
import { getApiClient } from "../lib/api.js";
import { NotFoundError, handleError } from "../lib/errors.js";
import {
	colors,
	isJsonMode,
	log,
	outputError,
	outputJsonLine,
} from "../lib/output.js";
import { ExitCode, exit } from "../utils/exit-codes.js";
import {
	createAppFromCurrentDirectory,
	ensureAuthenticatedForDeploy,
	inspectCurrentProject,
	streamDeploymentWithLogs,
	uploadCurrentDirectorySource,
} from "./deploy.js";

const DEFAULT_REGION = "me-central2";

interface UpOptions {
	apiUrl?: string;
	branch?: string;
	idempotencyKey?: string;
	plan?: string;
	region?: string;
	repo?: string;
	source?: string;
	token?: string;
}

type Source = "upload" | "github";

export function normalizeSource(value: string | undefined): Source {
	if (!value) return "upload";
	const v = value.trim().toLowerCase();
	if (v === "upload" || v === "github") return v;
	throw new Error(
		`Invalid --source "${value}". Use "upload" (default) or "github".`,
	);
}

export function parseRepo(repo: string): { owner: string; repository: string } {
	const trimmed = repo.trim().replace(/\.git$/, "");
	const httpsMatch = trimmed.match(/github\.com[/:]([^/]+)\/([^/]+?)$/i);
	if (httpsMatch?.[1] && httpsMatch[2]) {
		return { owner: httpsMatch[1], repository: httpsMatch[2] };
	}
	const slashMatch = trimmed.split("/");
	if (slashMatch.length === 2 && slashMatch[0] && slashMatch[1]) {
		return { owner: slashMatch[0], repository: slashMatch[1] };
	}
	throw new Error(
		`--repo must be "owner/name" or a GitHub URL (got "${repo}").`,
	);
}

/**
 * Convert a tRPC FORBIDDEN raised by the entitlement gate into a
 * structured NEEDS_UPGRADE response so the agent can decide whether
 * to call `tarout agent request-upgrade` (Phase 2) instead of bubbling
 * a generic permission error.
 */
export function isEntitlementError(err: unknown): boolean {
	if (!err || typeof err !== "object") return false;
	// tRPC v10 client wraps server TRPCError into TRPCClientError where the
	// real code lives on `.data.code` (not top-level `.code`). Accept either.
	const e = err as {
		code?: string;
		message?: string;
		data?: { code?: string };
	};
	const code = e.code ?? e.data?.code;
	if (code !== "FORBIDDEN") return false;
	const msg = (e.message ?? "").toLowerCase();
	return (
		msg.includes("plan limit reached") ||
		msg.includes("entitlement") ||
		msg.includes("upgrade to add more") ||
		msg.includes("active subscription")
	);
}

export function registerUpCommand(program: Command): void {
	program
		.command("up")
		.argument("[path]", "Project directory (defaults to current)")
		.description(
			"Inspect, create, upload, and deploy a project in one command",
		)
		.option(
			"--api-url <url>",
			"Custom API URL (defaults to saved profile or https://tarout.sa)",
		)
		.option("--token <token>", "API token for this run")
		.option("--plan <plan>", "App hosting plan: free, shared, or dedicated", "free")
		.option("--source <source>", "Source: upload (default) or github", "upload")
		.option("--repo <owner/repo>", "GitHub repository (when --source github)")
		.option("--branch <branch>", "GitHub branch (with --source github)", "main")
		.option("-r, --region <region>", "Deployment region", DEFAULT_REGION)
		.option(
			"--idempotency-key <key>",
			"Idempotency key for safe retries (Phase 2; logged only in v1)",
		)
		.action(async (cwdArg: string | undefined, options: UpOptions) => {
			try {
				const cwd = cwdArg ? resolve(cwdArg) : process.cwd();
				if (cwdArg) process.chdir(cwd);

				const source = normalizeSource(options.source);
				const idempotencyKey = options.idempotencyKey?.trim();
				if (idempotencyKey) {
					emitEvent({
						event: "idempotency_key_received",
						idempotencyKey,
						note: "Phase 2 will use this to dedupe. Today it is logged only.",
					});
				}

				emitEvent({ event: "inspect_started", cwd });
				const inspection = inspectCurrentProject(cwd);
				emitEvent({
					event: "inspect_done",
					database: inspection.database,
					storage: inspection.storage,
					git: inspection.git,
				});

				emitEvent({ event: "auth_check_started" });
				const profile = await ensureAuthenticatedForDeploy({
					apiUrl: options.apiUrl,
					token: options.token,
					region: options.region,
				});
				emitEvent({
					event: "auth_check_done",
					userEmail: profile.userEmail,
					organization: profile.organizationName,
				});

				const client = getApiClient();

				let app: Awaited<ReturnType<typeof createAppFromCurrentDirectory>>;
				try {
					emitEvent({ event: "app_create_started" });
					app = await createAppFromCurrentDirectory(client, profile, {
						plan: options.plan,
						region: options.region,
					});
					emitEvent({
						event: "app_create_done",
						applicationId: app.applicationId,
						name: app.name,
						plan: app.plan ?? options.plan ?? "free",
					});
				} catch (err) {
					if (isEntitlementError(err)) {
						const message =
							err instanceof Error ? err.message : "Plan upgrade required";
						const suggestedPlan = inferSuggestedPlan(options.plan);
						outputError("NEEDS_UPGRADE", message, {
							suggestedPlan,
							hint: "Phase 2: run `tarout agent request-upgrade <plan>` then `tarout agent poll-upgrade <requestId>` and retry `tarout up`.",
						});
						exit(ExitCode.PERMISSION_DENIED);
					}
					throw err;
				}

				if (source === "github") {
					if (!options.repo) {
						throw new Error(
							"`--source github` requires `--repo owner/name` or a GitHub URL.",
						);
					}
					const { owner, repository } = parseRepo(options.repo);

					emitEvent({
						event: "github_connect_started",
						owner,
						repository,
						branch: options.branch ?? "main",
					});
					const providersResponse: unknown =
						await client.github.githubProviders.query();
					type Provider = { githubId?: string; id?: string };
					const providerList: Provider[] = Array.isArray(providersResponse)
						? (providersResponse as Provider[])
						: Array.isArray(
									(providersResponse as { providers?: Provider[] })?.providers,
								)
							? (providersResponse as { providers: Provider[] }).providers
							: [];
					const githubId =
						providerList[0]?.githubId ?? providerList[0]?.id ?? "";
					if (!githubId) {
						throw new NotFoundError(
							"GitHub connection",
							"none",
							[
								"Install the Tarout GitHub App: visit your Tarout dashboard → Integrations → GitHub.",
							],
						);
					}
					await client.application.saveGithubProvider.mutate({
						applicationId: app.applicationId,
						repository,
						owner,
						branch: options.branch ?? "main",
						buildPath: "/",
						githubId,
						watchPaths: null,
						enableSubmodules: false,
					});
					emitEvent({
						event: "github_connect_done",
						repository: `${owner}/${repository}`,
					});
				} else {
					emitEvent({ event: "upload_started" });
					await uploadCurrentDirectorySource(
						client,
						app.applicationId,
						app.name,
					);
					emitEvent({ event: "upload_done" });
				}

				emitEvent({ event: "deploy_started", applicationId: app.applicationId });
				const result = await client.application.deployToCloud.mutate({
					applicationId: app.applicationId,
				});
				emitEvent({
					event: "deploy_enqueued",
					deploymentId: result.deploymentId,
				});

				// streamDeploymentWithLogs emits its own final JSON envelope on
				// success/failure/timeout and throws on failure. We let that
				// envelope be the canonical success/error response for the
				// caller — emitEvent lines above are the streaming preamble.
				await streamDeploymentWithLogs(
					client,
					result.deploymentId,
					app.name,
					app.applicationId,
				);
			} catch (err) {
				if (err instanceof Error && err.message.startsWith("Invalid --source")) {
					outputError("INVALID_ARGUMENTS", err.message);
					if (!isJsonMode()) log(colors.error(err.message));
					exit(ExitCode.INVALID_ARGUMENTS);
				}
				if (
					err instanceof Error &&
					err.message.startsWith("--repo must be")
				) {
					outputError("INVALID_ARGUMENTS", err.message);
					if (!isJsonMode()) log(colors.error(err.message));
					exit(ExitCode.INVALID_ARGUMENTS);
				}
				handleError(err);
			}
		});
}

/**
 * Best-effort upgrade suggestion when the entitlement gate rejects the
 * requested plan. Returns the next tier so the agent has something
 * concrete to ask for. "free" → "shared" → "dedicated_small".
 */
export function inferSuggestedPlan(requested?: string): string {
	const r = (requested ?? "free").trim().toLowerCase();
	if (!r || r === "free") return "shared";
	if (r === "shared") return "shared";
	if (r === "dedicated" || r === "dedicated_small") return "dedicated_small";
	if (r === "dedicated_medium") return "dedicated_medium";
	if (r === "dedicated_large") return "dedicated_large";
	return r;
}

/**
 * Streaming JSON event line for agents to read while the orchestration
 * runs. No-op when --json is off; the human path gets the spinners and
 * boxed output the underlying helpers already produce.
 */
function emitEvent(payload: Record<string, unknown>): void {
	if (isJsonMode()) {
		outputJsonLine({ type: "event", ...payload });
	}
}

