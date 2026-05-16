import type { Command } from "commander";
import open from "open";
import { startAuthServer } from "../lib/auth-server.js";
import {
	clearConfig,
	getCurrentProfile,
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
	success,
} from "../lib/output.js";
import { input } from "../utils/prompts.js";
import { failSpinner, startSpinner, succeedSpinner } from "../utils/spinner.js";

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
						log(`Already logged in as ${colors.cyan(profile.userEmail)}`);
						log(`Organization: ${profile.organizationName}`);
						log("");
						log(`Run ${colors.dim("tarout logout")} to sign out first.`);
						return;
					}
				}

				const apiUrl = options.apiUrl;
				log("");
				log("Opening browser to authenticate...");

				// Start local server for callback
				const authServer = await startAuthServer();
				const callbackUrl = `http://localhost:${authServer.port}/callback`;

				// Open browser to auth page
				const authUrl = `${apiUrl}/cli-auth?callback=${encodeURIComponent(callbackUrl)}`;

				await open(authUrl);

				const _spinner = startSpinner("Waiting for authentication...");

				try {
					const authData = await authServer.waitForCallback();

					succeedSpinner("Authentication successful!");
					authServer.close();

					// Save profile
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
						success(`Logged in as ${colors.cyan(authData.userEmail)}`);
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
						log(`Already logged in as ${colors.cyan(profile.userEmail)}`);
						log(`Run ${colors.dim("tarout logout")} to sign out first.`);
						return;
					}
				}

				const apiUrl = options.apiUrl;
				log("");
				log("Opening browser to create your account...");

				const authServer = await startAuthServer();
				const callbackUrl = `http://localhost:${authServer.port}/callback`;
				const authUrl = `${apiUrl}/cli-auth?action=register&callback=${encodeURIComponent(callbackUrl)}`;

				await open(authUrl);

				const _spinner = startSpinner("Waiting for account creation...");

				try {
					const authData = await authServer.waitForCallback();
					succeedSpinner("Account created and authenticated!");
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

				// Call the platform to get user info from the token
				const { createTRPCProxyClient, httpBatchLink } = await import(
					"@trpc/client"
				);
				const superjson = (await import("superjson")).default;

				const tempClient = createTRPCProxyClient({
					transformer: superjson,
					links: [
						httpBatchLink({
							url: `${apiUrl}/api/trpc`,
							headers: () => ({ "x-api-key": apiToken }),
						}),
					],
				});

				const user = await (tempClient as any).user.get.query();
				const orgs = await (tempClient as any).organization.all.query();
				const envs = await (tempClient as any).environment.all.query();

				succeedSpinner("Token verified!");

				const org = orgs?.[0];
				const env = envs?.[0];

				setProfile("default", {
					token: apiToken,
					apiUrl,
					userId: user.id,
					userEmail: user.email,
					userName: user.name,
					organizationId: org?.id || "",
					organizationName: org?.name || "",
					environmentId: env?.environmentId || "",
					environmentName: env?.name || "",
				});
				setCurrentProfile("default");

				if (isJsonMode()) {
					outputData({
						success: true,
						user: { id: user.id, email: user.email, name: user.name },
						organization: { id: org?.id, name: org?.name },
					});
				} else {
					log("");
					success(`Authenticated as ${colors.cyan(user.email)}`);
					box("Account", [
						`Organization: ${colors.bold(org?.name || "None")}`,
						`Environment: ${colors.bold(env?.name || "None")}`,
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
					tokenName = await input("Token name (e.g., ci-deploy):");
				}

				const { getApiClient } = await import("../lib/api.js");
				const client = getApiClient();

				const profile = getCurrentProfile();
				const _spinner = startSpinner("Creating API token...");

				const result = await client.user.createApiKey.mutate({
					name: tokenName,
					metadata: { organizationId: profile?.organizationId || "" },
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
