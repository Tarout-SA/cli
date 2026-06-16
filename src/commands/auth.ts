import type { Command } from "commander";
import { startAuthServer } from "../lib/auth-server.js";
import { resolveProfileFromCredential } from "../lib/auth-profile.js";
import { canLaunchBrowser, openInBrowser } from "../lib/browser.js";
import {
	clearConfig,
	getApiUrl,
	getCurrentProfile,
	getToken,
	isLoggedIn,
	setCurrentProfile,
	setProfile,
} from "../lib/config.js";
import { AuthError, handleError } from "../lib/errors.js";
import {
	box,
	colors,
	isJsonMode,
	log,
	outputData,
	outputError,
	success,
} from "../lib/output.js";
import { ExitCode, exit } from "../utils/exit-codes.js";
import { input, promptOrEmit } from "../utils/prompts.js";
import { failSpinner, startSpinner, succeedSpinner } from "../utils/spinner.js";

/**
 * Browser auth (`tarout login`, `tarout register`) needs a reachable GUI, and
 * a programmatic `--json` caller can't watch a browser at all. When neither
 * holds, emit a structured AUTH_BOOTSTRAP_REQUIRED error so the calling agent
 * surfaces the API-token path to its user instead of waiting on a
 * never-arriving browser callback.
 */
function refuseBrowserAuthForAgent(action: "login" | "register"): never {
	const message = `tarout ${action} requires a browser. Agents should ask the user to run \`tarout token <api-token>\` or set TAROUT_TOKEN — generate one at https://tarout.sa/dashboard/settings/profile.`;
	if (isJsonMode()) {
		outputError("AUTH_BOOTSTRAP_REQUIRED", message, {
			action,
			recommendedFlags: [
				"export TAROUT_TOKEN=<token>",
				"tarout token <api-token>",
			],
		});
	} else {
		process.stderr.write(`error: ${message}\n`);
	}
	exit(ExitCode.AUTH_ERROR);
}

export function registerAuthCommands(program: Command) {
	// Login command
	program
		.command("login")
		.description("Authenticate with Tarout via browser")
		.option("--api-url <url>", "Custom API URL", "https://tarout.sa")
		.action(async (options) => {
			try {
				if (isLoggedIn()) {
					const profile = getCurrentProfile();
					if (profile) {
						if (isJsonMode()) {
							outputData({
								alreadyLoggedIn: true,
								userEmail: profile.userEmail,
								organizationName: profile.organizationName,
							});
							return;
						}
						log(`Already logged in as ${colors.cyan(profile.userEmail)}`);
						log(`Organization: ${profile.organizationName}`);
						log("");
						log(`Run ${colors.dim("tarout logout")} to sign out first.`);
						return;
					}
				}

				if (isJsonMode() || !canLaunchBrowser()) {
					refuseBrowserAuthForAgent("login");
				}

				const apiUrl = options.apiUrl;
				log("");
				log("Opening browser to authenticate...");

					// Start local server for callback
					const authServer = await startAuthServer();
					const callbackUrl = `http://localhost:${authServer.port}/callback?state=${encodeURIComponent(authServer.state)}`;

				// Open browser to auth page. The launch may silently no-op (SSH/WSL,
				// missing xdg-open) — openInBrowser also prints the URL so the user
				// can complete auth by pasting it, while the callback server keeps
				// waiting below.
				const authUrl = `${apiUrl}/cli-authorize?callback=${encodeURIComponent(callbackUrl)}`;
				await openInBrowser(authUrl, {
					hint: "If the browser didn't open, visit this URL to authenticate:",
				});

				const _spinner = startSpinner("Waiting for authentication...");

				try {
					const authData = await authServer.waitForCallback();

					succeedSpinner("CLI authorized.");
					authServer.close();

					// Save profile
					const fallbackProfile = {
						token: authData.token,
						apiUrl,
						userId: authData.userId,
						userEmail: authData.userEmail,
						userName: authData.userName,
						organizationId: authData.organizationId,
						organizationName: authData.organizationName,
						projectId: authData.projectId,
						projectName: authData.projectName,
						projectSlug: authData.projectSlug,
						environmentId: authData.environmentId,
						environmentName: authData.environmentName,
					};
					const profile = await resolveProfileFromCredential({
						token: authData.token,
						apiUrl,
						fallback: fallbackProfile,
					}).catch(() => fallbackProfile);
					setProfile("default", profile);
					setCurrentProfile("default");

					if (isJsonMode()) {
						outputData({
							success: true,
							user: {
								id: authData.userId,
								email: authData.userEmail,
								name: authData.userName,
							},
							organization: {
								id: authData.organizationId,
								name: authData.organizationName,
							},
							environment: {
								id: authData.environmentId,
								name: authData.environmentName,
							},
						});
					} else {
						log("");
						success(`CLI authorized as ${colors.cyan(authData.userEmail)}`);
						box("Account", [
							`Organization: ${colors.bold(authData.organizationName)}`,
							`Environment: ${colors.bold(authData.environmentName)}`,
						]);
					}
				} catch (err) {
					failSpinner("Authentication failed");
					authServer.close();
					throw err;
				}
			} catch (err) {
				handleError(err);
			}
		});

	// Logout command
	program
		.command("logout")
		.description("Sign out and clear stored credentials")
		.action(async () => {
			try {
				if (!isLoggedIn()) {
					if (isJsonMode()) {
						outputData({ success: true, message: "Already logged out" });
					} else {
						log("Already logged out.");
					}
					return;
				}

				const profile = getCurrentProfile();
				clearConfig();

				if (isJsonMode()) {
					outputData({ success: true, message: "Logged out successfully" });
				} else {
					success(`Logged out from ${profile?.userEmail || "Tarout"}`);
				}
			} catch (err) {
				handleError(err);
			}
		});

	// Register command
	program
		.command("register")
		.description("Create a new Tarout account via browser")
		.option("--api-url <url>", "Custom API URL", "https://tarout.sa")
		.action(async (options) => {
			try {
				if (isLoggedIn()) {
					const profile = getCurrentProfile();
					if (profile) {
						if (isJsonMode()) {
							outputData({
								alreadyLoggedIn: true,
								userEmail: profile.userEmail,
								organizationName: profile.organizationName,
							});
							return;
						}
						log(`Already logged in as ${colors.cyan(profile.userEmail)}`);
						log(`Run ${colors.dim("tarout logout")} to sign out first.`);
						return;
					}
				}

				if (isJsonMode() || !canLaunchBrowser()) {
					refuseBrowserAuthForAgent("register");
				}

				const apiUrl = options.apiUrl;
				log("");
				log("Opening browser to create your account...");

					const authServer = await startAuthServer();
					const callbackUrl = `http://localhost:${authServer.port}/callback?state=${encodeURIComponent(authServer.state)}`;
				const authUrl = `${apiUrl}/cli-authorize?action=register&callback=${encodeURIComponent(callbackUrl)}`;
				await openInBrowser(authUrl, {
					hint: "If the browser didn't open, visit this URL to create your account:",
				});

				const _spinner = startSpinner("Waiting for account creation...");

				try {
					const authData = await authServer.waitForCallback();
					succeedSpinner("Account created and authenticated!");
					authServer.close();

					const fallbackProfile = {
						token: authData.token,
						apiUrl,
						userId: authData.userId,
						userEmail: authData.userEmail,
						userName: authData.userName,
						organizationId: authData.organizationId,
						organizationName: authData.organizationName,
						projectId: authData.projectId,
						projectName: authData.projectName,
						projectSlug: authData.projectSlug,
						environmentId: authData.environmentId,
						environmentName: authData.environmentName,
					};
					const profile = await resolveProfileFromCredential({
						token: authData.token,
						apiUrl,
						fallback: fallbackProfile,
					}).catch(() => fallbackProfile);
					setProfile("default", profile);
					setCurrentProfile("default");

					if (isJsonMode()) {
						outputData({
							success: true,
							user: {
								id: authData.userId,
								email: authData.userEmail,
								name: authData.userName,
							},
							organization: {
								id: authData.organizationId,
								name: authData.organizationName,
							},
							environment: {
								id: authData.environmentId,
								name: authData.environmentName,
							},
						});
					} else {
						log("");
						success(
							`Account created! Logged in as ${colors.cyan(authData.userEmail)}`,
						);
						box("Account", [
							`Organization: ${colors.bold(authData.organizationName)}`,
							`Environment: ${colors.bold(authData.environmentName)}`,
						]);
					}
				} catch (err) {
					failSpinner("Account creation failed");
					authServer.close();
					throw err;
				}
			} catch (err) {
				handleError(err);
			}
		});

	// Token command — authenticate with an existing API token (useful for CI)
	program
		.command("token")
		.argument("<api-token>", "API token to authenticate with")
		.description("Authenticate using an existing API key (for CI/scripts)")
		.option("--api-url <url>", "Custom API URL", "https://tarout.sa")
		.action(async (apiToken, options) => {
			try {
				const apiUrl = options.apiUrl;
				const _spinner = startSpinner("Verifying token...");

				const profile = await resolveProfileFromCredential({
					token: apiToken,
					apiUrl,
				});

				succeedSpinner("Token verified!");

				setProfile("default", profile);
				setCurrentProfile("default");

				if (isJsonMode()) {
					outputData({
						success: true,
						user: {
							id: profile.userId,
							email: profile.userEmail,
							name: profile.userName,
						},
						organization: {
							id: profile.organizationId,
							name: profile.organizationName,
						},
					});
				} else {
					log("");
					success(`Authenticated as ${colors.cyan(profile.userEmail)}`);
					box("Account", [
						`Organization: ${colors.bold(profile.organizationName || "None")}`,
						`Environment: ${colors.bold(profile.environmentName || "None")}`,
					]);
				}
			} catch (err) {
				handleError(err);
			}
		});

	// Generate API token for current user
	program
		.command("token:create")
		.description("Create a new API token for the current account")
		.option("-n, --name <name>", "Token name")
		.action(async (options) => {
			try {
				if (!isLoggedIn()) throw new AuthError();

				let tokenName = options.name;
				if (!tokenName) {
					tokenName = await promptOrEmit<string>(
						{
							field: "name",
							kind: "input",
							question: "Token name (e.g., ci-deploy):",
							flag: "--name",
							context: { step: "token_create" },
						},
						() => input("Token name (e.g., ci-deploy):"),
					);
				}

				const { getApiClient } = await import("../lib/api.js");
				const client = getApiClient();

				const profile = getCurrentProfile();

				// A key with an empty organizationId authenticates to NOTHING (every
				// later REST/MCP/CLI call → UNAUTHORIZED). When running from a bare
				// TAROUT_TOKEN (no saved profile, so profile is null) resolve the real
				// org from the live credential instead of stamping "".
				let keyOrg = profile?.organizationId;
				let keyEnv = profile?.environmentId;
				let keyProj = profile?.projectId;
				if (!keyOrg) {
					const resolved = await resolveProfileFromCredential({
						apiUrl: getApiUrl(),
						token: getToken() || "",
						fallback: profile,
					});
					keyOrg = resolved.organizationId;
					keyEnv = resolved.environmentId;
					keyProj = resolved.projectId;
				}
				if (!keyOrg) {
					throw new Error(
						"Could not determine your organization. Run `tarout auth login` first, or pass a token scoped to an organization.",
					);
				}

				const _spinner = startSpinner("Creating API token...");

				const result = await client.user.createApiKey.mutate({
					name: tokenName,
					metadata: {
						organizationId: keyOrg,
						environmentId: keyEnv || "",
						projectId: keyProj || "",
					},
				});

				succeedSpinner("API token created!");

				if (isJsonMode()) {
					outputData(result);
					return;
				}

				log("");
				log(colors.bold("API Token Created"));
				log("");
				log(`  Name: ${tokenName}`);
				log(`  Token: ${colors.cyan(result.key || result.token || "")}`);
				log("");
				log(colors.warn("Save this token — it will not be shown again."));
				log(
					`  Use with: ${colors.dim("tarout token <your-token>")} or set ${colors.dim("TAROUT_TOKEN")} env var`,
				);
				log("");
			} catch (err) {
				handleError(err);
			}
		});

	// Whoami command
	program
		.command("whoami")
		.description("Show current authenticated user")
		.action(async () => {
			try {
				if (!isLoggedIn()) {
					throw new AuthError();
				}

				const profile = getCurrentProfile();
				if (!profile) {
					throw new AuthError();
				}

				if (isJsonMode()) {
					outputData({
						user: {
							id: profile.userId,
							email: profile.userEmail,
							name: profile.userName,
						},
						organization: {
							id: profile.organizationId,
							name: profile.organizationName,
						},
						environment: {
							id: profile.environmentId,
							name: profile.environmentName,
						},
						apiUrl: profile.apiUrl,
					});
				} else {
					log("");
					log(`${colors.bold("User")}`);
					log(`  Email: ${colors.cyan(profile.userEmail)}`);
					if (profile.userName) {
						log(`  Name: ${profile.userName}`);
					}
					log("");
					log(`${colors.bold("Organization")}`);
					log(`  Name: ${profile.organizationName}`);
					log(`  ID: ${colors.dim(profile.organizationId)}`);
					log("");
					log(`${colors.bold("Environment")}`);
					log(`  Name: ${profile.environmentName}`);
					log(`  ID: ${colors.dim(profile.environmentId)}`);
					log("");
				}
			} catch (err) {
				handleError(err);
			}
		});
}
