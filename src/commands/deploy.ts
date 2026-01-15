import { Command } from "commander";
import { getApiClient } from "../lib/api.js";
import { getCurrentProfile, isLoggedIn } from "../lib/config.js";
import {
  handleError,
  AuthError,
  NotFoundError,
  findSimilar,
  CliError,
} from "../lib/errors.js";
import {
  success,
  error,
  log,
  colors,
  table,
  getStatusBadge,
  isJsonMode,
  outputData,
  quietOutput,
  box,
} from "../lib/output.js";
import {
  startSpinner,
  succeedSpinner,
  failSpinner,
  updateSpinner,
} from "../utils/spinner.js";
import { ExitCode } from "../utils/exit-codes.js";

export function registerDeployCommands(program: Command) {
  // Deploy command
  program
    .command("deploy")
    .argument("<app>", "Application ID or name")
    .description("Deploy an application")
    .option("-r, --region <region>", "Deployment region", "me-central1")
    .option("-w, --wait", "Wait for deployment to complete")
    .action(async (appIdentifier, options) => {
      try {
        if (!isLoggedIn()) throw new AuthError();

        const client = getApiClient();

        // Find the application
        const spinner = startSpinner("Finding application...");
        const apps = await client.application.allByOrganization.query();
        const app = findApp(apps, appIdentifier);

        if (!app) {
          failSpinner();
          const suggestions = findSimilar(
            appIdentifier,
            apps.map((a) => a.name)
          );
          throw new NotFoundError("Application", appIdentifier, suggestions);
        }

        updateSpinner(`Deploying ${app.name}...`);

        // Trigger deployment
        const result = await client.application.deployToCloud.mutate({
          applicationId: app.applicationId,
          region: options.region,
        });

        if (options.wait) {
          // Poll for completion
          let attempts = 0;
          const maxAttempts = 120; // 10 minutes with 5s intervals

          while (attempts < maxAttempts) {
            await sleep(5000);
            attempts++;

            const fullApp = await client.application.one.query({
              applicationId: app.applicationId,
            });

            updateSpinner(
              `Deploying ${app.name}... (${attempts * 5}s)`
            );

            if (fullApp.applicationStatus === "done" || fullApp.applicationStatus === "running") {
              succeedSpinner("Deployment successful!");

              if (isJsonMode()) {
                outputData({
                  deploymentId: result.deploymentId,
                  status: fullApp.applicationStatus,
                  url: fullApp.cloudServiceUrl,
                });
              } else {
                quietOutput(fullApp.cloudServiceUrl || result.deploymentId);
                log("");
                log(`URL: ${colors.cyan(fullApp.cloudServiceUrl || "Pending...")}`);
                log("");
              }
              return;
            }

            if (fullApp.applicationStatus === "error") {
              failSpinner("Deployment failed");
              throw new CliError("Deployment failed. Check logs for details.", ExitCode.GENERAL_ERROR);
            }
          }

          failSpinner("Deployment timed out");
          throw new CliError("Deployment timed out after 10 minutes", ExitCode.GENERAL_ERROR);
        } else {
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
            log(`Check status: ${colors.dim(`tarout deploy:status ${app.applicationId.slice(0, 8)}`)}`);
            log(`View logs: ${colors.dim(`tarout logs ${app.applicationId.slice(0, 8)}`)}`);
            log("");
          }
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
        const spinner = startSpinner("Fetching status...");
        const apps = await client.application.allByOrganization.query();
        const appSummary = findApp(apps, appIdentifier);

        if (!appSummary) {
          failSpinner();
          const suggestions = findSimilar(
            appIdentifier,
            apps.map((a) => a.name)
          );
          throw new NotFoundError("Application", appIdentifier, suggestions);
        }

        const app = await client.application.one.query({
          applicationId: appSummary.applicationId,
        });

        const cloudStatus = await client.application.getCloudDeploymentStatus.query({
          applicationId: appSummary.applicationId,
        });

        succeedSpinner();

        if (isJsonMode()) {
          outputData({
            applicationId: app.applicationId,
            name: app.name,
            status: app.applicationStatus,
            url: app.cloudServiceUrl,
            cloudStatus,
          });
          return;
        }

        log("");
        log(`${colors.bold(app.name)}`);
        log("");
        log(`Status: ${getStatusBadge(app.applicationStatus)}`);

        if (app.cloudServiceUrl) {
          log(`URL: ${colors.cyan(app.cloudServiceUrl)}`);
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
        const spinner = startSpinner("Cancelling deployment...");
        const apps = await client.application.allByOrganization.query();
        const app = findApp(apps, appIdentifier);

        if (!app) {
          failSpinner();
          const suggestions = findSimilar(
            appIdentifier,
            apps.map((a) => a.name)
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
        const spinner = startSpinner("Fetching deployments...");
        const apps = await client.application.allByOrganization.query();
        const appSummary = findApp(apps, appIdentifier);

        if (!appSummary) {
          failSpinner();
          const suggestions = findSimilar(
            appIdentifier,
            apps.map((a) => a.name)
          );
          throw new NotFoundError("Application", appIdentifier, suggestions);
        }

        // Get deployments
        const deployments = await client.deployment.all.query({
          applicationId: appSummary.applicationId,
        });

        succeedSpinner();

        const limitedDeployments = deployments.slice(0, parseInt(options.limit, 10));

        if (isJsonMode()) {
          outputData(limitedDeployments);
          return;
        }

        if (limitedDeployments.length === 0) {
          log("");
          log("No deployments found.");
          log("");
          log(`Deploy with: ${colors.dim(`tarout deploy ${appSummary.applicationId.slice(0, 8)}`)}`);
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
          ])
        );
        log("");
        log(colors.dim(`${limitedDeployments.length} deployment${limitedDeployments.length === 1 ? "" : "s"}`));
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
    .option("-l, --level <level>", "Log level (ALL, ERROR, WARN, INFO, DEBUG)", "ALL")
    .option("-f, --follow", "Stream logs continuously")
    .option("-n, --limit <number>", "Number of logs to show", "100")
    .option("--since <duration>", "Show logs since (e.g., 1h, 30m, 2d)")
    .action(async (appIdentifier, options) => {
      try {
        if (!isLoggedIn()) throw new AuthError();

        const client = getApiClient();

        // Find the application
        const spinner = startSpinner("Fetching logs...");
        const apps = await client.application.allByOrganization.query();
        const app = findApp(apps, appIdentifier);

        if (!app) {
          failSpinner();
          const suggestions = findSimilar(
            appIdentifier,
            apps.map((a) => a.name)
          );
          throw new NotFoundError("Application", appIdentifier, suggestions);
        }

        // Parse time range
        let timeRange: { start: string | null; end: string | null } | undefined;
        if (options.since) {
          const since = parseDuration(options.since);
          if (since) {
            timeRange = {
              start: new Date(Date.now() - since).toISOString(),
              end: null,
            };
          }
        }

        const logs = await client.logs.getCloudRunLogs.query({
          applicationId: app.applicationId,
          level: options.level.toUpperCase() as "ALL" | "ERROR" | "WARN" | "INFO" | "DEBUG",
          limit: parseInt(options.limit, 10),
          timeRange,
        });

        succeedSpinner();

        if (isJsonMode()) {
          outputData(logs);
          return;
        }

        if (!logs.entries || logs.entries.length === 0) {
          log("");
          log("No logs found.");
          return;
        }

        log("");

        for (const entry of logs.entries) {
          printLogEntry(entry);
        }

        // Follow mode - poll for new logs
        if (options.follow) {
          log("");
          log(colors.dim("Streaming logs... (Ctrl+C to stop)"));
          log("");

          let lastTimestamp = logs.entries.length > 0
            ? new Date(logs.entries[logs.entries.length - 1].timestamp).getTime()
            : Date.now();

          while (true) {
            await sleep(2000);

            const newLogs = await client.logs.getCloudRunLogs.query({
              applicationId: app.applicationId,
              level: options.level.toUpperCase() as "ALL" | "ERROR" | "WARN" | "INFO" | "DEBUG",
              limit: 50,
              timeRange: {
                start: new Date(lastTimestamp + 1).toISOString(),
                end: null,
              },
            });

            if (newLogs.entries && newLogs.entries.length > 0) {
              for (const entry of newLogs.entries) {
                const entryTime = new Date(entry.timestamp).getTime();
                if (entryTime > lastTimestamp) {
                  printLogEntry(entry);
                  lastTimestamp = entryTime;
                }
              }
            }
          }
        }
      } catch (err) {
        handleError(err);
      }
    });
}

// Helper functions
function findApp(
  apps: Array<{ applicationId: string; name: string; appName?: string }>,
  identifier: string
) {
  const lowerIdentifier = identifier.toLowerCase();

  return apps.find(
    (app) =>
      app.applicationId === identifier ||
      app.applicationId.startsWith(identifier) ||
      app.name.toLowerCase() === lowerIdentifier ||
      app.appName?.toLowerCase() === lowerIdentifier
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

function parseDuration(duration: string): number | null {
  const match = duration.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return null;

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * (multipliers[unit] || 0);
}

function printLogEntry(entry: { timestamp: string; severity: string; message: string }) {
  const time = new Date(entry.timestamp);
  const timeStr = time.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const levelColors: Record<string, (s: string) => string> = {
    ERROR: colors.error,
    WARN: colors.warn,
    INFO: colors.info,
    DEBUG: colors.dim,
    DEFAULT: colors.dim,
  };

  const colorFn = levelColors[entry.severity] || levelColors.DEFAULT;
  const level = entry.severity.padEnd(5);

  console.log(`${colors.dim(timeStr)}  ${colorFn(level)}  ${entry.message}`);
}
