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
import { getProjectConfig, setProjectConfig } from "../lib/config.js";
import {
	InvalidArgumentError,
	NotFoundError,
	findSimilar,
	handleError,
} from "../lib/errors.js";
import {
	box,
	colors,
	isJsonMode,
	log,
	outputError,
	outputJsonLine,
	shouldSkipConfirmation,
} from "../lib/output.js";
import { ExitCode, exit } from "../utils/exit-codes.js";
import { select } from "../utils/prompts.js";
import {
	type AppSummary,
	configureOptionalResources,
	createAppFromCurrentDirectory,
	emitNeedsUpgrade,
	ensureAuthenticatedForDeploy,
	findApp,
	inferSuggestedPlan,
	inspectCurrentProject,
	isEntitlementError,
	promptUpgradeFromEntitlementError,
	streamDeploymentWithLogs,
	uploadCurrentDirectorySource,
} from "./deploy.js";

// Re-exported so existing imports (and tests) of these helpers from
// `cli/src/commands/up` continue to resolve after they were lifted into
// `deploy.ts` for sharing with the `tarout deploy` command.
export { inferSuggestedPlan, isEntitlementError };

const DEFAULT_REGION = "me-central2";

interface UpOptions {
	apiUrl?: string;
	app?: string;
	branch?: string;
	buildCommand?: string;
	database?: string;
	databasePlan?: string;
	description?: string;
	frameworkPreset?: string;
	idempotencyKey?: string;
	installCommand?: string;
	name?: string;
	outputDirectory?: string;
	plan?: string;
	region?: string;
	repo?: string;
	reuseDatabase?: string;
	reuseStorage?: string;
	rootDirectory?: string;
	source?: string;
	startCommand?: string;
	storage?: boolean;
	storagePlan?: string;
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
		.option("--name <name>", "Application name (defaults to directory name)")
		.option("--plan <plan>", "App hosting plan: free, shared, or dedicated", "free")
		.option("--source <source>", "Source: upload (default) or github", "upload")
		.option(
			"--app <ref>",
			"Deploy to an existing app by id or name (skips create-or-pick prompt; 'auto' picks the lone match)",
		)
		.option("--repo <owner/repo>", "GitHub repository (when --source github)")
		.option("--branch <branch>", "GitHub branch (with --source github)", "main")
		.option("-r, --region <region>", "Deployment region", DEFAULT_REGION)
		.option(
			"--database <type>",
			"Provision and attach a database: none, postgres, or mysql (defaults to auto-detected)",
		)
		.option("--database-plan <plan>", "Database plan (e.g. free, starter)")
		.option("--storage", "Provision and attach file storage")
		.option("--storage-plan <plan>", "Storage plan (e.g. free, starter)")
		.option(
			"--reuse-database <ref>",
			"Reuse an existing database in this project: <id>, <name>, or 'auto'",
		)
		.option(
			"--reuse-storage <ref>",
			"Reuse an existing storage bucket in this project: <id>, <name>, or 'auto'",
		)
		.option("--description <text>", "Description for the newly created app")
		.option(
			"--framework-preset <preset>",
			"Framework preset override (e.g. nextjs, vite, astro)",
		)
		.option("--root-directory <path>", "Project root directory inside the source")
		.option("--install-command <cmd>", "Custom install command")
		.option("--build-command <cmd>", "Custom build command")
		.option(
			"--output-directory <path>",
			"Build output directory (static assets)",
		)
		.option("--start-command <cmd>", "Custom start command")
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

				// Resolution order:
				//   1) --app <ref> (explicit; supports id, name, or 'auto')
				//   2) Linked directory (idempotent redeploy — agent edit→up→edit→up loop)
				//   3) Interactive picker ("Create new" vs existing apps in this org)
				//   4) Non-interactive fallthrough → create new
				let app: AppSummary | undefined;
				let reused = false;
				const linked = getProjectConfig();
				let allApps: AppSummary[] | undefined;
				const loadApps = async (): Promise<AppSummary[]> => {
					if (!allApps) {
						allApps =
							(await client.application.allByOrganization.query()) as AppSummary[];
					}
					return allApps;
				};

				if (options.app) {
					const apps = await loadApps();
					const picked = resolveAppRef(apps, options.app);
					app = picked;
					reused = true;
					setProjectConfig({
						applicationId: picked.applicationId,
						name: picked.name,
						organizationId: profile.organizationId,
						linkedAt: new Date().toISOString(),
					});
					emitEvent({
						event: "app_reused",
						applicationId: picked.applicationId,
						name: picked.name,
						via: "--app",
					});
				} else if (linked) {
					const apps = await loadApps();
					const existing =
						findApp(apps, linked.applicationId) ?? findApp(apps, linked.name);
					if (existing) {
						app = existing;
						reused = true;
						emitEvent({
							event: "app_reused",
							applicationId: app.applicationId,
							name: app.name,
							via: "linked",
						});
					}
				}

				if (!app && !isJsonMode() && !shouldSkipConfirmation()) {
					const apps = await loadApps();
					if (apps.length > 0) {
						const createValue = "__create__";
						log("");
						log(
							`Found ${apps.length} existing app${apps.length === 1 ? "" : "s"} in this organization.`,
						);
						const selected = await select<string>(
							"Deploy to an existing app or create a new one?",
							[
								{
									name: `Create a new app${
										options.name ? ` named "${options.name}"` : ""
									}`,
									value: createValue,
								},
								...apps.map((existing) => ({
									name: `${existing.name} ${colors.dim(`(${existing.applicationId.slice(0, 8)})`)}`,
									value: existing.applicationId,
								})),
							],
							{
								field: "deploy_target_app",
								flag: "--app <id|name|auto>",
							},
						);
						if (selected !== createValue) {
							const picked = findApp(apps, selected);
							if (!picked) {
								throw new NotFoundError("Application", selected);
							}
							app = picked;
							reused = true;
							setProjectConfig({
								applicationId: picked.applicationId,
								name: picked.name,
								organizationId: profile.organizationId,
								linkedAt: new Date().toISOString(),
							});
							emitEvent({
								event: "app_reused",
								applicationId: picked.applicationId,
								name: picked.name,
								via: "interactive",
							});
						}
					}
				}

				if (!reused) {
					try {
						emitEvent({ event: "app_create_started" });
						app = await createAppFromCurrentDirectory(client, profile, {
							name: options.name,
							plan: options.plan,
							region: options.region,
							description: options.description,
							frameworkPreset: options.frameworkPreset,
							rootDirectory: options.rootDirectory,
							installCommand: options.installCommand,
							buildCommand: options.buildCommand,
							outputDirectory: options.outputDirectory,
							startCommand: options.startCommand,
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

							// JSON / non-TTY / --yes: keep the machine-readable contract.
							if (isJsonMode() || shouldSkipConfirmation()) {
								await emitNeedsUpgrade(client, err, options.plan, "tarout up");
								exit(ExitCode.PERMISSION_DENIED);
							}

							log("");
							log(colors.warn(message));

							const upgraded = await promptUpgradeFromEntitlementError(
								client,
								err,
								options.plan,
							);

							if (!upgraded) {
								await emitNeedsUpgrade(client, err, options.plan, "tarout up");
								exit(ExitCode.PERMISSION_DENIED);
							}

							box("Upgrade complete", [
								colors.success("Subscription updated."),
								`Run ${colors.cyan("tarout up")} again to deploy on the new plan.`,
							]);
							return;
						}
						throw err;
					}

					// Provision the backend the project actually needs (detected DB /
					// storage, or the explicit --database/--storage flags) and wire it
					// in, only on first creation. `deploy` already does this; `up` used
					// to detect resources but never create them, leaving the app to boot
					// without its backend.
					emitEvent({
						event: "provision_started",
						database: inspection.database,
						storage: inspection.storage,
					});
					await configureOptionalResources(
						client,
						profile,
						app,
						{
							database: options.database,
							databasePlan: options.databasePlan,
							storage: options.storage,
							storagePlan: options.storagePlan,
							reuseDatabase: options.reuseDatabase,
							reuseStorage: options.reuseStorage,
						},
						inspection,
					);
					emitEvent({ event: "provision_done" });
				}

				if (!app) {
					throw new Error("Failed to resolve the target application.");
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
 * Streaming JSON event line for agents to read while the orchestration
 * runs. No-op when --json is off; the human path gets the spinners and
 * boxed output the underlying helpers already produce.
 */
function emitEvent(payload: Record<string, unknown>): void {
	if (isJsonMode()) {
		outputJsonLine({ type: "event", ...payload });
	}
}

/**
 * Resolve `--app <ref>` against the org's app list.
 *
 * `auto`     → pick the lone match; error if 0 or >1
 * `<id>`     → exact applicationId
 * `<name>`   → name-equality lookup (case-insensitive)
 * fallthrough → fuzzy "did you mean" suggestions in the error
 */
function resolveAppRef(apps: AppSummary[], ref: string): AppSummary {
	const normalized = ref.trim();

	if (normalized.toLowerCase() === "auto") {
		if (apps.length === 0) {
			throw new InvalidArgumentError(
				"--app=auto: no existing apps in this organization. Drop --app to create a new one.",
			);
		}
		if (apps.length > 1) {
			const sample = apps
				.slice(0, 5)
				.map((a) => `${a.name} (${a.applicationId.slice(0, 8)})`)
				.join(", ");
			throw new InvalidArgumentError(
				`--app=auto needs exactly one match, found ${apps.length}. Candidates: ${sample}. Pick one by id or name.`,
			);
		}
		return apps[0]!;
	}

	const match = findApp(apps, normalized);
	if (match) return match;

	const suggestions = findSimilar(
		normalized,
		apps.flatMap((a) => [a.name, a.applicationId]),
	);
	throw new NotFoundError(
		"Application",
		normalized,
		suggestions.length > 0
			? suggestions
			: apps.length > 0
				? apps.slice(0, 5).map((a) => `${a.name} (${a.applicationId.slice(0, 8)})`)
				: [
						"No apps exist in this organization yet. Drop --app to create a new one.",
					],
	);
}

