import { Command } from "commander";
import open from "open";
import {
  clearConfig,
  getCurrentProfile,
  getApiUrl,
  isLoggedIn,
  setCurrentProfile,
  setProfile,
} from "../lib/config.js";
import { startAuthServer } from "../lib/auth-server.js";
import { handleError, AuthError } from "../lib/errors.js";
import {
  success,
  error,
  log,
  colors,
  box,
  isJsonMode,
  outputData,
} from "../lib/output.js";
import { startSpinner, succeedSpinner, failSpinner } from "../utils/spinner.js";
import { ExitCode, exit } from "../utils/exit-codes.js";

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

        const spinner = startSpinner("Waiting for authentication...");

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
