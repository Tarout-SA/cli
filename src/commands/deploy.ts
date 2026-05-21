import { execFile } from "node:child_process";
import { createReadStream, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import type { Command } from "commander";
import open from "open";
import { getApiClient } from "../lib/api.js";
import { startAuthServer } from "../lib/auth-server.js";
import {
	getCurrentProfile,
	getProjectConfig,
	isLoggedIn,
	setCurrentProfile,
	setProfile,
	setProjectConfig,
} from "../lib/config.js";
import {
	AuthError,
	analyzeDeploymentError,
	BuildFailedError,
	DeploymentFailedError,
	DeploymentTimeoutError,
	findSimilar,
	handleError,
	InvalidArgumentError,
	NotFoundError,
} from "../lib/errors.js";
import {
	box,
	colors,
	getStatusBadge,
	isJsonMode,
	log,
	outputData,
	quietOutput,
	shouldSkipConfirmation,
	success,
	table,
} from "../lib/output.js";
import { streamDeploymentLogs } from "../lib/websocket.js";
import { confirm, input, select } from "../utils/prompts.js";
import {
	failSpinner,
	startSpinner,
	stopSpinner,
	succeedSpinner,
} from "../utils/spinner.js";

const DEFAULT_REGION = "me-central2";
const DROP_UPLOAD_CONTENT_TYPE = "application/zip";

const execFileAsync = promisify(execFile);

interface AppSummary {
	appName?: string;
	applicationId: string;
	name: string;
	sourceType?: string | null;
}

interface DeploymentSummary {
	createdAt: Date | string;
	deploymentId: string;
	status: string;
	title?: string | null;
}

async function ensureLoggedInForDeploy(): Promise<void> {
	if (isLoggedIn()) return;

	if (isJsonMode()) {
		throw new AuthError();
	}

	log("");
	log("Tarout needs an authenticated account before deploying.");
	const authAction = await select<"login" | "register">("Continue with:", [
		{ name: "Log in to an existing account", value: "login" },
		{ name: "Create a free Tarout account", value: "register" },
	]);

	await authenticateViaBrowser(authAction);
}

async function authenticateViaBrowser(action: "login" | "register") {
	const apiUrl = "https://tarout.sa";
	const authServer = await startAuthServer();
	const callbackUrl = `http://localhost:${authServer.port}/callback`;
	const authUrl =
		action === "register"
			? `${apiUrl}/cli-auth?action=register&callback=${encodeURIComponent(callbackUrl)}`
			: `${apiUrl}/cli-auth?callback=${encodeURIComponent(callbackUrl)}`;

	log("");
	log(
		action === "register"
			? "Opening browser to create your account..."
			: "Opening browser to authenticate...",
	);
	await open(authUrl);

	const _spinner = startSpinner(
		action === "register"
			? "Waiting for account creation..."
			: "Waiting for authentication...",
	);

	try {
		const authData = await authServer.waitForCallback();
		succeedSpinner(
			action === "register"
				? "Account created and authenticated!"
				: "Authentication successful!",
		);
		authServer.close();

		setProfile("default", {
			token: authData.token,
			apiUrl,
			userId: authData.userId,
			userEmail: authData.userEmail,
			userName: authData.userName,
			organizationId: authData.organizationId,
			organizationName: authData.organizationName,
			environmentId: authData.environmentId,
			environmentName: authData.environmentName,
		});
		setCurrentProfile("default");

		log("");
		success(`Logged in as ${colors.cyan(authData.userEmail)}`);
		box("Account", [
			`Organization: ${colors.bold(authData.organizationName)}`,
			`Environment: ${colors.bold(authData.environmentName)}`,
		]);
	} catch (err) {
		failSpinner(
			action === "register"
				? "Account creation failed"
				: "Authentication failed",
		);
		authServer.close();
		throw err;
	}
}

async function confirmRegion(region: string | undefined): Promise<void> {
	const requestedRegion = region || DEFAULT_REGION;
	if (requestedRegion === DEFAULT_REGION) return;

	const message = `Tarout currently deploys only to ${DEFAULT_REGION} (Dammam, Saudi Arabia). The requested region "${requestedRegion}" would move workloads outside the active Saudi region when additional regions are enabled.`;

	if (isJsonMode()) {
		throw new InvalidArgumentError(message);
	}

	log("");
	log(colors.warn(message));

	if (shouldSkipConfirmation()) {
		log(colors.dim(`Continuing with ${DEFAULT_REGION}.`));
		return;
	}

	const proceed = await confirm(`Continue with ${DEFAULT_REGION}?`, false);
	if (!proceed) {
		throw new InvalidArgumentError("Deployment cancelled.");
	}
}

async function resolveDeploymentTarget(
	client: any,
	appIdentifier?: string,
): Promise<{ app: AppSummary; shouldUploadSource: boolean }> {
	const _spinner = startSpinner("Finding application...");
	const apps: AppSummary[] = await client.application.allByOrganization.query();
	succeedSpinner();

	if (appIdentifier) {
		const app = findApp(apps, appIdentifier);
		if (!app) {
			const suggestions = findSimilar(
				appIdentifier,
				apps.map((a) => a.name),
			);
			throw new NotFoundError("Application", appIdentifier, suggestions);
		}

		const details = await getApplicationDetails(client, app.applicationId);
		return {
			app,
			shouldUploadSource: shouldUseLocalSource(details, {
				explicitApp: true,
			}),
		};
	}

	const linkedProject = getProjectConfig();
	if (linkedProject) {
		const app =
			findApp(apps, linkedProject.applicationId) ??
			findApp(apps, linkedProject.name);

		if (app) {
			const details = await getApplicationDetails(client, app.applicationId);
			return {
				app,
				shouldUploadSource: shouldUseLocalSource(details, {
					linkedProject: true,
				}),
			};
		}

		if (!isJsonMode()) {
			log("");
			log(
				colors.warn(
					`Linked application "${linkedProject.name}" was not found in this organization.`,
				),
			);
		}
	}

	if (isJsonMode()) {
		throw new InvalidArgumentError(
			"No linked application. Run 'tarout link', pass an app name, or run without --json to choose interactively.",
		);
	}

	if (apps.length === 0) {
		const app = await createAppFromCurrentDirectory(client);
		return { app, shouldUploadSource: true };
	}

	const createValue = "__create__";
	const selected = await select<string>("Select an application to deploy:", [
		{
			name: `Create a new app from ${colors.cyan(basename(process.cwd()) || "this directory")}`,
			value: createValue,
		},
		...apps.map((app) => ({
			name: `${app.name} ${colors.dim(`(${app.applicationId.slice(0, 8)})`)}`,
			value: app.applicationId,
		})),
	]);

	if (selected === createValue) {
		const app = await createAppFromCurrentDirectory(client);
		return { app, shouldUploadSource: true };
	}

	const app = findApp(apps, selected);
	if (!app) {
		throw new NotFoundError("Application", selected);
	}

	const profile = getCurrentProfile();
	if (profile) {
		setProjectConfig({
			applicationId: app.applicationId,
			name: app.name,
			organizationId: profile.organizationId,
			linkedAt: new Date().toISOString(),
		});
	}

	const details = await getApplicationDetails(client, app.applicationId);
	return {
		app,
		shouldUploadSource: await promptForLocalSourceIfNeeded(details),
	};
}

async function createAppFromCurrentDirectory(client: any): Promise<AppSummary> {
	const profile = getCurrentProfile();
	if (!profile) throw new AuthError();

	const defaultName = basename(process.cwd()) || "tarout-app";
	let appName = defaultName;

	if (!shouldSkipConfirmation()) {
		appName = await input("Application name:", defaultName);
	}

	const slug = generateSlug(appName);
	const _spinner = startSpinner("Creating application...");
	const application = await client.application.create.mutate({
		name: appName,
		appName: slug,
		organizationId: profile.organizationId,
		region: DEFAULT_REGION,
	});
	succeedSpinner("Application created!");

	setProjectConfig({
		applicationId: application.applicationId,
		name: application.name,
		organizationId: profile.organizationId,
		linkedAt: new Date().toISOString(),
	});

	if (!isJsonMode()) {
		box("Project Linked", [
			`Application: ${colors.cyan(application.name)}`,
			`ID: ${colors.dim(application.applicationId)}`,
			`Directory: ${colors.dim(process.cwd())}`,
		]);
	}

	return {
		applicationId: application.applicationId,
		name: application.name,
		appName: application.appName,
		sourceType: application.sourceType,
	};
}

async function getApplicationDetails(client: any, applicationId: string) {
	return client.application.one.query({ applicationId });
}

function shouldUseLocalSource(
	app: any,
	context: { explicitApp?: boolean; linkedProject?: boolean },
): boolean {
	if (app?.sourceType === "drop") return true;
	if (!hasConfiguredSource(app)) return true;

	// Explicit app deployments should respect the app's configured source.
	if (context.explicitApp) return false;

	// Linked non-drop projects usually represent dashboard/git deployments.
	if (context.linkedProject) return false;

	return false;
}

async function promptForLocalSourceIfNeeded(app: any): Promise<boolean> {
	if (app?.sourceType === "drop" || !hasConfiguredSource(app)) return true;

	if (shouldSkipConfirmation()) return false;

	log("");
	log(
		`${colors.bold(app.name)} already has a ${colors.cyan(app.sourceType)} source configured.`,
	);
	return confirm(
		"Use the current directory as the deployment source instead?",
		false,
	);
}

function hasConfiguredSource(app: any): boolean {
	switch (app?.sourceType) {
		case "drop":
			return Boolean(app.dropSourceObjectName);
		case "github":
			return Boolean(
				(app.owner && app.repository) ||
					app.github?.repository ||
					app.github?.owner,
			);
		case "gitlab":
			return Boolean(app.gitlabRepository || app.gitlab?.gitlabRepository);
		case "bitbucket":
			return Boolean(
				app.bitbucketRepository || app.bitbucket?.bitbucketRepository,
			);
		case "gitea":
			return Boolean(app.giteaRepository || app.gitea?.giteaRepository);
		case "git":
			return Boolean(app.customGitUrl || app.gitUrl);
		case "dockerfileUpload":
			return Boolean(app.dockerfileContent);
		case "dockerhub":
			return Boolean(app.dockerHubImage);
		default:
			return false;
	}
}

async function uploadCurrentDirectorySource(
	client: any,
	applicationId: string,
	appName: string,
): Promise<void> {
	const archivePath = await createSourceArchive();
	const archiveDir = dirname(archivePath);

	try {
		const { size } = statSync(archivePath);
		const fileName = `${generateSlug(appName)}.zip`;

		const _uploadUrlSpinner = startSpinner("Preparing source upload...");
		const upload = await client.application.getDropUploadUrl.mutate({
			applicationId,
			fileName,
			fileSize: size,
			contentType: DROP_UPLOAD_CONTENT_TYPE,
		});
		succeedSpinner();

		const _uploadSpinner = startSpinner(
			`Uploading source archive (${formatBytes(size)})...`,
		);
		const response = await fetch(upload.uploadUrl, {
			method: "PUT",
			body: createReadStream(archivePath) as any,
			headers: {
				"Content-Length": String(size),
			},
			duplex: "half",
		} as any);

		if (!response.ok) {
			const body = await response.text().catch(() => "");
			throw new Error(`Upload failed (${response.status}): ${body}`);
		}
		succeedSpinner("Source uploaded!");

		const _completeSpinner = startSpinner("Finalizing source...");
		await client.application.completeDropUpload.mutate({
			applicationId,
			objectName: upload.objectName,
			fileName,
			fileSize: size,
			dropBuildPath: "/",
		});
		succeedSpinner("Source ready for deployment.");
	} finally {
		rmSync(archiveDir, { recursive: true, force: true });
	}
}

async function createSourceArchive(): Promise<string> {
	const tempDir = mkdtempSync(join(tmpdir(), "tarout-source-"));
	const archivePath = join(tempDir, "source.zip");

	const excludes = [
		".git/*",
		".tarout/*",
		".next/*",
		"dist/*",
		"build/*",
		"coverage/*",
		"node_modules/*",
		"*/node_modules/*",
		".env",
		".env.*",
		"*.log",
	];

	const _spinner = startSpinner("Packaging current directory...");
	try {
		await execFileAsync("zip", ["-qry", archivePath, ".", "-x", ...excludes], {
			cwd: process.cwd(),
			maxBuffer: 1024 * 1024,
		});
		succeedSpinner("Source packaged.");
		return archivePath;
	} catch (err) {
		failSpinner("Failed to package source.");
		rmSync(tempDir, { recursive: true, force: true });

		if (
			err instanceof Error &&
			("code" in err ? (err as { code?: string }).code === "ENOENT" : false)
		) {
			throw new InvalidArgumentError(
				"The 'zip' command is required to upload a local directory. Install zip or connect a Git source in the Tarout dashboard.",
			);
		}

		throw err;
	}
}

function generateSlug(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-+/g, "-");

	if (/^[a-z][a-z0-9-]*[a-z0-9]$/.test(slug)) return slug;
	return `app-${slug || "tarout-app"}`.replace(/-+$/g, "");
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function registerDeployCommands(program: Command) {
	// Deploy command
	program
		.command("deploy")
		.argument("[app]", "Application ID or name")
		.description("Deploy an application")
		.option("-r, --region <region>", "Deployment region", DEFAULT_REGION)
		.option("-w, --wait", "Wait for deployment to complete and stream logs")
		.option("--watch", "Alias for --wait")
		.action(async (appIdentifier, options) => {
			try {
				await ensureLoggedInForDeploy();
				await confirmRegion(options.region);

				const client = getApiClient();
				const { app, shouldUploadSource } = await resolveDeploymentTarget(
					client,
					appIdentifier,
				);

				if (shouldUploadSource) {
					await uploadCurrentDirectorySource(
						client,
						app.applicationId,
						app.name,
					);
				}

				const _deploySpinner = startSpinner(`Deploying ${app.name}...`);

				// Trigger deployment
				const result = await client.application.deployToCloud.mutate({
					applicationId: app.applicationId,
				});

				if (options.wait || options.watch) {
					// Stream logs and wait for completion
					await streamDeploymentWithLogs(
						client,
						result.deploymentId,
						app.name,
						app.applicationId,
					);
					return;
				}

				succeedSpinner("Deployment started!");

				if (isJsonMode()) {
					outputData({
						deploymentId: result.deploymentId,
						status: "deploying",
					});
				} else {
					quietOutput(result.deploymentId);
					log("");
					log(`Deployment ID: ${colors.cyan(result.deploymentId)}`);
					log("");
					log("Deployment is running in the background.");
					log(
						`Check status: ${colors.dim(`tarout deploy:status ${app.applicationId.slice(0, 8)}`)}`,
					);
					log(
						`View logs: ${colors.dim(`tarout deploy:logs ${result.deploymentId.slice(0, 8)}`)}`,
					);
					log("");
				}
			} catch (err) {
				handleError(err);
			}
		});

	// Deploy status command
	program
		.command("deploy:status")
		.argument("<app>", "Application ID or name")
		.description("Check deployment status")
		.action(async (appIdentifier) => {
			try {
				if (!isLoggedIn()) throw new AuthError();

				const client = getApiClient();

				// Find the application
				const _spinner = startSpinner("Fetching status...");
				const apps: AppSummary[] =
					await client.application.allByOrganization.query();
				const appSummary = findApp(apps, appIdentifier);

				if (!appSummary) {
					failSpinner();
					const suggestions = findSimilar(
						appIdentifier,
						apps.map((a) => a.name),
					);
					throw new NotFoundError("Application", appIdentifier, suggestions);
				}

				const app = await client.application.one.query({
					applicationId: appSummary.applicationId,
				});

				const cloudStatus = await client.application.getDeploymentStatus.query({
					applicationId: appSummary.applicationId,
				});

				succeedSpinner();

				if (isJsonMode()) {
					outputData({
						applicationId: app.applicationId,
						name: app.name,
						status: app.applicationStatus,
						url: app.appSubdomain
							? `https://${app.appSubdomain}`
							: app.domain?.[0]?.host
								? `https://${app.domain[0].host}`
								: null,
						cloudStatus,
					});
					return;
				}

				log("");
				log(`${colors.bold(app.name)}`);
				log("");
				log(`Status: ${getStatusBadge(app.applicationStatus)}`);

				const appUrl = app.appSubdomain
					? `https://${app.appSubdomain}`
					: app.domain?.[0]?.host
						? `https://${app.domain[0].host}`
						: null;
				if (appUrl) {
					log(`URL: ${colors.cyan(appUrl)}`);
				}

				if (cloudStatus) {
					log(`Provider: ${cloudStatus.provider}`);
					log(`Region: ${cloudStatus.region}`);
					log(`Updated: ${new Date(cloudStatus.updatedAt).toLocaleString()}`);
				}

				log("");
			} catch (err) {
				handleError(err);
			}
		});

	// Deploy cancel command
	program
		.command("deploy:cancel")
		.argument("<app>", "Application ID or name")
		.description("Cancel a running deployment")
		.action(async (appIdentifier) => {
			try {
				if (!isLoggedIn()) throw new AuthError();

				const client = getApiClient();

				// Find the application
				const _spinner = startSpinner("Cancelling deployment...");
				const apps: AppSummary[] =
					await client.application.allByOrganization.query();
				const app = findApp(apps, appIdentifier);

				if (!app) {
					failSpinner();
					const suggestions = findSimilar(
						appIdentifier,
						apps.map((a) => a.name),
					);
					throw new NotFoundError("Application", appIdentifier, suggestions);
				}

				await client.application.cancelDeployment.mutate({
					applicationId: app.applicationId,
				});

				succeedSpinner("Deployment cancelled");

				if (isJsonMode()) {
					outputData({ cancelled: true, applicationId: app.applicationId });
				}
			} catch (err) {
				handleError(err);
			}
		});

	// Deploy list command
	program
		.command("deploy:list")
		.argument("<app>", "Application ID or name")
		.description("List recent deployments")
		.option("-n, --limit <number>", "Number of deployments to show", "10")
		.action(async (appIdentifier, options) => {
			try {
				if (!isLoggedIn()) throw new AuthError();

				const client = getApiClient();

				// Find the application
				const _spinner = startSpinner("Fetching deployments...");
				const apps: AppSummary[] =
					await client.application.allByOrganization.query();
				const appSummary = findApp(apps, appIdentifier);

				if (!appSummary) {
					failSpinner();
					const suggestions = findSimilar(
						appIdentifier,
						apps.map((a) => a.name),
					);
					throw new NotFoundError("Application", appIdentifier, suggestions);
				}

				// Get deployments
				const deployments: DeploymentSummary[] =
					await client.deployment.all.query({
						applicationId: appSummary.applicationId,
					});

				succeedSpinner();

				const limitedDeployments = deployments.slice(
					0,
					Number.parseInt(options.limit, 10),
				);

				if (isJsonMode()) {
					outputData(limitedDeployments);
					return;
				}

				if (limitedDeployments.length === 0) {
					log("");
					log("No deployments found.");
					log("");
					log(
						`Deploy with: ${colors.dim(`tarout deploy ${appSummary.applicationId.slice(0, 8)}`)}`,
					);
					return;
				}

				log("");
				table(
					["ID", "STATUS", "TITLE", "CREATED"],
					limitedDeployments.map((d: any) => [
						colors.cyan(d.deploymentId.slice(0, 8)),
						getStatusBadge(d.status),
						d.title || colors.dim("-"),
						formatDate(d.createdAt),
					]),
				);
				log("");
				log(
					colors.dim(
						`${limitedDeployments.length} deployment${limitedDeployments.length === 1 ? "" : "s"}`,
					),
				);
			} catch (err) {
				handleError(err);
			}
		});

	// Deploy logs command - view logs for a specific deployment
	program
		.command("deploy:logs")
		.argument("<deployment-id>", "Deployment ID")
		.description("View deployment logs")
		.option(
			"-f, --follow",
			"Stream logs in real-time (for running deployments)",
		)
		.option("--no-stream", "Fetch logs via HTTP instead of WebSocket")
		.action(async (deploymentId, options) => {
			try {
				if (!isLoggedIn()) throw new AuthError();

				const client = getApiClient();

				// Get deployment details
				const _spinner = startSpinner("Fetching deployment...");
				let deployment: any;
				try {
					deployment = await client.deployment.one.query({ deploymentId });
				} catch {
					// Deployment not found
					failSpinner();
					throw new NotFoundError("Deployment", deploymentId);
				}

				succeedSpinner();

				const isRunning = deployment.status === "running";

				// Determine whether to stream or fetch
				const shouldStream =
					options.follow || (isRunning && options.stream !== false);

				if (shouldStream && deployment.logPath) {
					// Stream logs via WebSocket
					log("");
					log(
						colors.dim(
							`Streaming logs for deployment ${colors.cyan(deployment.deploymentId.slice(0, 8))}...`,
						),
					);
					log(colors.dim("Press Ctrl+C to stop"));
					log("");

					const logLines: string[] = [];
					const errors: string[] = [];
					let finalStatus = deployment.status;

					const { cleanup, done } = streamDeploymentLogs(deployment.logPath, {
						onData: (line) => {
							logLines.push(line);
							if (isErrorLine(line)) {
								errors.push(line);
							}
							if (!isJsonMode()) {
								printLogLine(line);
							}
						},
						onError: (error) => {
							if (!isJsonMode()) {
								log(colors.error(`WebSocket error: ${error.message}`));
							}
						},
					});

					// Handle Ctrl+C gracefully
					process.on("SIGINT", () => {
						cleanup();
						if (!isJsonMode()) {
							log("");
							log(colors.dim("Log streaming stopped"));
						}
						process.exit(0);
					});

					// Wait for stream to end (deployment complete or error)
					await done;

					// Get final deployment status
					const finalDeployment = await client.deployment.one.query({
						deploymentId,
					});
					finalStatus = finalDeployment.status;

					// Output JSON result if in JSON mode
					if (isJsonMode()) {
						const analysis =
							finalStatus === "error"
								? analyzeDeploymentError(logLines, finalDeployment.errorMessage)
								: undefined;

						outputData({
							deploymentId: deployment.deploymentId,
							status: finalStatus,
							logs: logLines,
							errors: errors.length > 0 ? errors : undefined,
							errorAnalysis: analysis,
							application: deployment.application,
						});
					} else {
						log("");
						log(
							`Final status: ${getStatusBadge(finalStatus)} ${finalStatus === "error" && finalDeployment.errorMessage ? `- ${finalDeployment.errorMessage}` : ""}`,
						);
					}
				} else {
					// Fetch logs via HTTP
					const logsResult = await client.deployment.getDeploymentLogs.query({
						deploymentId,
						offset: 0,
						limit: 5000,
					});

					if (isJsonMode()) {
						const errors = logsResult.lines.filter(isErrorLine);
						const analysis =
							deployment.status === "error"
								? analyzeDeploymentError(
										logsResult.lines,
										deployment.errorMessage,
									)
								: undefined;

						outputData({
							deploymentId: deployment.deploymentId,
							status: deployment.status,
							logs: logsResult.lines,
							totalLines: logsResult.totalLines,
							errors: errors.length > 0 ? errors : undefined,
							errorAnalysis: analysis,
							application: deployment.application,
						});
						return;
					}

					if (logsResult.lines.length === 0) {
						log("");
						log("No logs available for this deployment.");
						return;
					}

					log("");
					log(
						colors.dim(
							`Logs for deployment ${colors.cyan(deployment.deploymentId.slice(0, 8))} (${logsResult.totalLines} lines):`,
						),
					);
					log("");

					for (const line of logsResult.lines) {
						printLogLine(line);
					}

					if (logsResult.hasMore) {
						log("");
						log(
							colors.dim(
								`Showing ${logsResult.lines.length} of ${logsResult.totalLines} lines`,
							),
						);
					}

					log("");
					log(`Status: ${getStatusBadge(deployment.status)}`);
				}
			} catch (err) {
				handleError(err);
			}
		});

	// Deploy rollback command - rollback to a previous deployment
	program
		.command("deploy:rollback")
		.argument("<app>", "Application ID or name")
		.description("Rollback to a previous deployment")
		.option("--to <deployment-id>", "Specific deployment ID to rollback to")
		.option("--previous", "Rollback to the immediately previous deployment")
		.option("-w, --wait", "Wait for rollback to complete")
		.action(async (appIdentifier, options) => {
			try {
				if (!isLoggedIn()) throw new AuthError();

				const client = getApiClient();

				// Find the application
				const _spinner = startSpinner("Finding application...");
				const apps: AppSummary[] =
					await client.application.allByOrganization.query();
				const appSummary = findApp(apps, appIdentifier);

				if (!appSummary) {
					failSpinner();
					const suggestions = findSimilar(
						appIdentifier,
						apps.map((a) => a.name),
					);
					throw new NotFoundError("Application", appIdentifier, suggestions);
				}

				// Get deployments
				const deployments: DeploymentSummary[] =
					await client.deployment.all.query({
						applicationId: appSummary.applicationId,
					});

				succeedSpinner();

				// Filter to only successful deployments
				const successfulDeployments = deployments.filter(
					(d) => d.status === "done",
				);

				if (successfulDeployments.length === 0) {
					log("");
					log("No successful deployments found to rollback to.");
					return;
				}

				let targetDeploymentId: string;

				if (options.to) {
					// Use specific deployment ID
					const targetDeployment = successfulDeployments.find(
						(d) =>
							d.deploymentId === options.to ||
							d.deploymentId.startsWith(options.to),
					);

					if (!targetDeployment) {
						throw new NotFoundError("Deployment", options.to);
					}

					targetDeploymentId = targetDeployment.deploymentId;
				} else if (options.previous) {
					// Use the second most recent successful deployment (first is current)
					if (successfulDeployments.length < 2) {
						log("");
						log("No previous deployment to rollback to.");
						log("There must be at least 2 successful deployments.");
						return;
					}

					targetDeploymentId = successfulDeployments[1].deploymentId;
				} else {
					// Interactive selection
					log("");
					log(
						`Select a deployment to rollback to for ${colors.cyan(appSummary.name)}:`,
					);
					log("");

					const choices = successfulDeployments
						.slice(0, 10)
						.map((d, index) => ({
							name: `${colors.cyan(d.deploymentId.slice(0, 8))} - ${d.title || "Deployment"} (${formatDate(d.createdAt)})${index === 0 ? colors.dim(" [current]") : ""}`,
							value: d.deploymentId,
						}));

					const { select } = await import("../utils/prompts.js");
					targetDeploymentId = await select("Select deployment:", choices);
				}

				// Confirm rollback
				if (!options.yes) {
					const targetDeployment = successfulDeployments.find(
						(d) => d.deploymentId === targetDeploymentId,
					);

					log("");
					log(`Rolling back ${colors.cyan(appSummary.name)} to:`);
					log(`  Deployment: ${colors.cyan(targetDeploymentId.slice(0, 8))}`);
					log(`  Title: ${targetDeployment?.title || "Deployment"}`);
					log(
						`  Created: ${
							targetDeployment
								? formatDate(targetDeployment.createdAt)
								: colors.dim("unknown")
						}`,
					);
					log("");

					const { confirm } = await import("../utils/prompts.js");
					const confirmed = await confirm(
						"Are you sure you want to rollback?",
						false,
					);

					if (!confirmed) {
						log("Cancelled.");
						return;
					}
				}

				// Perform rollback
				const _rollbackSpinner = startSpinner("Initiating rollback...");

				const result = await client.deployment.rollback.mutate({
					applicationId: appSummary.applicationId,
					targetDeploymentId,
				});

				if (options.wait) {
					// Stream logs and wait for completion
					await streamDeploymentWithLogs(
						client,
						result.deploymentId,
						appSummary.name,
						appSummary.applicationId,
					);
					return;
				}

				succeedSpinner("Rollback initiated!");

				if (isJsonMode()) {
					outputData({
						deploymentId: result.deploymentId,
						rollbackFrom: targetDeploymentId,
						status: "running",
					});
				} else {
					quietOutput(result.deploymentId);
					log("");
					log(`Deployment ID: ${colors.cyan(result.deploymentId)}`);
					log(`Rolling back to: ${colors.dim(targetDeploymentId.slice(0, 8))}`);
					log("");
					log("Rollback is running in the background.");
					log(
						`Check status: ${colors.dim(`tarout deploy:status ${appSummary.applicationId.slice(0, 8)}`)}`,
					);
					log(
						`View logs: ${colors.dim(`tarout deploy:logs ${result.deploymentId.slice(0, 8)}`)}`,
					);
					log("");
				}
			} catch (err) {
				handleError(err);
			}
		});

	// List deployments filtered by type
	program
		.command("deploy:list-by-type")
		.argument("<app>", "App ID or name")
		.argument("<type>", "Deployment type: git, upload, docker")
		.option("-n, --limit <n>", "Number of deployments", "20")
		.description("List deployments filtered by source type")
		.action(async (appIdentifier, type, options) => {
			try {
				if (!isLoggedIn()) throw new AuthError();
				const client = getApiClient();
				const _spinner = startSpinner("Fetching apps...");
				const apps = await client.application.allByOrganization.query();
				const appList = Array.isArray(apps)
					? apps
					: (apps as any)?.applications || [];
				const app = findApp(appList, appIdentifier);
				if (!app) {
					failSpinner();
					throw new NotFoundError("Application", appIdentifier);
				}
				const _depSpinner = startSpinner("Fetching deployments...");
				const result = await client.deployment.allByType.query({
					applicationId: app.applicationId,
					type,
					limit: Number.parseInt(options.limit || "20"),
				} as any);
				succeedSpinner();
				if (isJsonMode()) {
					outputData(result);
					return;
				}
				const list = Array.isArray(result)
					? result
					: (result as any)?.deployments || [];
				if (!list.length) {
					log(`\nNo ${type} deployments found.\n`);
					return;
				}
				log("");
				table(
					["ID", "STATUS", "BRANCH", "CREATED"],
					list.map((d: any) => [
						colors.cyan((d.deploymentId || d.id || "").slice(0, 8)),
						d.status === "done"
							? colors.success(d.status)
							: d.status === "error"
								? colors.error(d.status)
								: colors.warn(d.status || "-"),
						d.buildSourceBranch || d.branch || "-",
						d.createdAt ? new Date(d.createdAt).toLocaleDateString() : "-",
					]),
				);
				log("");
			} catch (err) {
				handleError(err);
			}
		});
}

// Register logs command separately
export function registerLogsCommand(program: Command) {
	program
		.command("logs")
		.argument("<app>", "Application ID or name")
		.description("View application logs")
		.option(
			"-l, --level <level>",
			"Log level (ALL, ERROR, WARN, INFO, DEBUG)",
			"ALL",
		)
		.option("-f, --follow", "Stream logs continuously")
		.option("-n, --limit <number>", "Number of logs to show", "100")
		.option("--since <duration>", "Show logs since (e.g., 1h, 30m, 2d)")
		.action(async () => {
			log("");
			log("Application logs are available in the dashboard.");
			log("CLI log streaming is not yet supported for Coolify deployments.");
			log("");
		});
}

// Helper functions
function findApp(apps: AppSummary[], identifier: string) {
	const lowerIdentifier = identifier.toLowerCase();

	return apps.find(
		(app) =>
			app.applicationId === identifier ||
			app.applicationId.startsWith(identifier) ||
			app.name.toLowerCase() === lowerIdentifier ||
			app.appName?.toLowerCase() === lowerIdentifier,
	);
}

function formatDate(date: Date | string): string {
	const d = new Date(date);
	return d.toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stream deployment logs and wait for completion.
 * Used by `deploy --wait` to show real-time logs.
 */
async function streamDeploymentWithLogs(
	client: any,
	deploymentId: string,
	appName: string,
	applicationId: string,
): Promise<void> {
	// Get deployment details to get logPath
	stopSpinner();

	let deployment: any;
	try {
		deployment = await client.deployment.one.query({ deploymentId });
	} catch {
		throw new NotFoundError("Deployment", deploymentId);
	}

	const logLines: string[] = [];
	const errors: string[] = [];
	const startTime = Date.now();
	let wsConnected = false;
	let lastStatus = deployment.status;

	if (!isJsonMode()) {
		log("");
		log(
			`${colors.bold(appName)} - Deployment ${colors.cyan(deploymentId.slice(0, 8))}`,
		);
		log(colors.dim("─".repeat(50)));
		log("");
	}

	// Start streaming logs if logPath is available
	let cleanup: (() => void) | null = null;

	if (deployment.logPath) {
		const stream = streamDeploymentLogs(deployment.logPath, {
			onData: (line) => {
				logLines.push(line);
				if (isErrorLine(line)) {
					errors.push(line);
				}
				if (!isJsonMode()) {
					printLogLine(line);
				}
			},
			onOpen: () => {
				wsConnected = true;
			},
			onError: () => {
				// WebSocket errors are not fatal - we'll fall back to polling
				if (!isJsonMode() && wsConnected) {
					log(colors.dim("[WebSocket reconnecting...]"));
				}
			},
		});
		cleanup = stream.cleanup;
	}

	// Poll for deployment status
	const maxWaitMs = 600000; // 10 minutes
	const pollIntervalMs = 3000;

	try {
		while (Date.now() - startTime < maxWaitMs) {
			await sleep(pollIntervalMs);

			// Get updated deployment status
			const updatedDeployment = await client.deployment.one.query({
				deploymentId,
			});
			lastStatus = updatedDeployment.status;

			if (lastStatus === "done") {
				// Give WebSocket a moment to flush remaining logs
				await sleep(500);
				cleanup?.();

				// Get final application info for URL
				const finalApp = await client.application.one.query({ applicationId });
				const duration = Math.round((Date.now() - startTime) / 1000);

				const deployUrl = finalApp.appSubdomain
					? `https://${finalApp.appSubdomain}`
					: finalApp.domain?.[0]?.host
						? `https://${finalApp.domain[0].host}`
						: null;

				if (isJsonMode()) {
					outputData({
						success: true,
						data: {
							deploymentId,
							status: "done",
							url: deployUrl,
							duration,
							logs: logLines,
						},
					});
				} else {
					log("");
					log(colors.dim("─".repeat(50)));
					log(colors.success("✓ Deployment successful!"));
					log("");
					log(`URL: ${colors.cyan(deployUrl || "Pending...")}`);
					log(`Duration: ${colors.dim(`${duration}s`)}`);
					log("");
				}
				return;
			}

			if (lastStatus === "error" || lastStatus === "cancelled") {
				cleanup?.();

				const errorAnalysis = analyzeDeploymentError(
					logLines,
					updatedDeployment.errorMessage,
				);
				const duration = Math.round((Date.now() - startTime) / 1000);

				if (isJsonMode()) {
					outputData({
						success: false,
						error: {
							code:
								errorAnalysis.category === "build_script" ||
								errorAnalysis.category === "npm_install" ||
								errorAnalysis.category === "typescript"
									? "BUILD_FAILED"
									: "DEPLOYMENT_FAILED",
							message: updatedDeployment.errorMessage || "Deployment failed",
							deploymentId,
							duration,
							logs: logLines,
							errors: errors.length > 0 ? errors : undefined,
							errorAnalysis,
						},
					});
				} else {
					log("");
					log(colors.dim("─".repeat(50)));
					log(colors.error("✗ Deployment failed"));
					log("");

					if (updatedDeployment.errorMessage) {
						log(`Error: ${colors.error(updatedDeployment.errorMessage)}`);
					}

					if (errorAnalysis.category !== "unknown") {
						log("");
						log(colors.bold("Error Analysis:"));
						log(`  Category: ${errorAnalysis.category}`);
						log(`  Type: ${errorAnalysis.type}`);
						log("");
						log(colors.bold("Possible Causes:"));
						for (const cause of errorAnalysis.possibleCauses.slice(0, 3)) {
							log(`  • ${cause}`);
						}
						log("");
						log(colors.bold("Suggested Fixes:"));
						for (const fix of errorAnalysis.suggestedFixes.slice(0, 3)) {
							log(`  • ${fix}`);
						}
					}
					log("");
				}

				// Throw appropriate error for exit code
				if (
					errorAnalysis.category === "build_script" ||
					errorAnalysis.category === "npm_install" ||
					errorAnalysis.category === "typescript" ||
					errorAnalysis.category === "docker_build"
				) {
					throw new BuildFailedError(
						updatedDeployment.errorMessage || "Build failed",
						deploymentId,
						errorAnalysis,
					);
				}
				throw new DeploymentFailedError(
					updatedDeployment.errorMessage || "Deployment failed",
					deploymentId,
					errorAnalysis,
				);
			}
		}

		// Timeout
		cleanup?.();
		const duration = Math.round((Date.now() - startTime) / 1000);

		if (isJsonMode()) {
			outputData({
				success: false,
				error: {
					code: "DEPLOYMENT_TIMEOUT",
					message: "Deployment timed out",
					deploymentId,
					duration,
					logs: logLines,
					errors: errors.length > 0 ? errors : undefined,
				},
			});
		} else {
			log("");
			log(colors.dim("─".repeat(50)));
			log(colors.warn("⚠ Deployment timed out"));
			log("");
			log(
				`The deployment is still running. Check status with: ${colors.dim(`tarout deploy:status ${applicationId.slice(0, 8)}`)}`,
			);
			log("");
		}

		throw new DeploymentTimeoutError(
			"Deployment timed out after 10 minutes",
			deploymentId,
		);
	} finally {
		// Ensure cleanup is called
		cleanup?.();
	}
}

/**
 * Check if a log line contains an error indicator.
 */
function isErrorLine(line: string): boolean {
	const errorPatterns = [
		/error/i,
		/ERR!/i,
		/failed/i,
		/fatal/i,
		/exception/i,
		/ENOENT/i,
		/EACCES/i,
		/EPERM/i,
	];
	return errorPatterns.some((pattern) => pattern.test(line));
}

/**
 * Print a log line with appropriate formatting.
 */
function printLogLine(line: string): void {
	// Detect log level from content
	if (isErrorLine(line)) {
		console.log(colors.error(line));
	} else if (/warn/i.test(line)) {
		console.log(colors.warn(line));
	} else if (/step|stage|building|installing|deploying/i.test(line)) {
		console.log(colors.info(line));
	} else {
		console.log(line);
	}
}
