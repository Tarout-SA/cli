import { Command } from "commander";
import { getApiClient } from "../lib/api.js";
import {
  getCurrentProfile,
  isLoggedIn,
  updateProfile,
} from "../lib/config.js";
import {
  handleError,
  AuthError,
  NotFoundError,
  findSimilar,
} from "../lib/errors.js";
import {
  success,
  log,
  colors,
  table,
  isJsonMode,
  outputData,
  quietOutput,
} from "../lib/output.js";
import {
  startSpinner,
  succeedSpinner,
  failSpinner,
} from "../utils/spinner.js";

export function registerOrgsCommands(program: Command) {
  const orgs = program.command("orgs").description("Manage organizations");

  // List organizations
  orgs
    .command("list")
    .alias("ls")
    .description("List your organizations")
    .action(async () => {
      try {
        if (!isLoggedIn()) throw new AuthError();

        const client = getApiClient();
        const profile = getCurrentProfile();
        const spinner = startSpinner("Fetching organizations...");

        const organizations = await client.organization.all.query();

        succeedSpinner();

        if (isJsonMode()) {
          outputData(organizations);
          return;
        }

        if (organizations.length === 0) {
          log("");
          log("No organizations found.");
          return;
        }

        log("");
        table(
          ["ID", "NAME", "ACTIVE"],
          organizations.map((org: any) => [
            colors.cyan(org.id.slice(0, 8)),
            org.name,
            org.id === profile?.organizationId ? colors.success("*") : "",
          ])
        );
        log("");
        log(colors.dim(`${organizations.length} organization${organizations.length === 1 ? "" : "s"}`));
        log("");
        log(`Current: ${colors.bold(profile?.organizationName || "None")}`);
      } catch (err) {
        handleError(err);
      }
    });

  // Switch organization
  orgs
    .command("switch")
    .argument("<org>", "Organization ID or name")
    .description("Switch to a different organization")
    .action(async (orgIdentifier) => {
      try {
        if (!isLoggedIn()) throw new AuthError();

        const client = getApiClient();
        const spinner = startSpinner("Switching organization...");

        const organizations = await client.organization.all.query();
        const org = findOrg(organizations, orgIdentifier);

        if (!org) {
          failSpinner();
          const suggestions = findSimilar(
            orgIdentifier,
            organizations.map((o: any) => o.name)
          );
          throw new NotFoundError("Organization", orgIdentifier, suggestions);
        }

        // Get environments for the new org
        // Note: This requires a server-side endpoint to switch org context
        // For now, we update the local profile
        // In full implementation, this would call a tRPC endpoint to update session

        // Get first environment for the new org
        const envs = await client.environment.all.query();
        const defaultEnv = envs.find((e: any) => e.organizationId === org.id) || envs[0];

        updateProfile({
          organizationId: org.id,
          organizationName: org.name,
          environmentId: defaultEnv?.environmentId,
          environmentName: defaultEnv?.name || "production",
        });

        succeedSpinner(`Switched to ${org.name}`);

        if (isJsonMode()) {
          outputData({
            organizationId: org.id,
            organizationName: org.name,
            environmentId: defaultEnv?.environmentId,
            environmentName: defaultEnv?.name,
          });
        } else {
          quietOutput(org.id);
          log("");
          log(`Organization: ${colors.bold(org.name)}`);
          log(`Environment: ${colors.bold(defaultEnv?.name || "production")}`);
          log("");
        }
      } catch (err) {
        handleError(err);
      }
    });
}

export function registerEnvsCommands(program: Command) {
  const envs = program.command("envs").description("Manage environments (production/staging)");

  // List environments
  envs
    .command("list")
    .alias("ls")
    .description("List environments")
    .action(async () => {
      try {
        if (!isLoggedIn()) throw new AuthError();

        const client = getApiClient();
        const profile = getCurrentProfile();
        const spinner = startSpinner("Fetching environments...");

        const environments = await client.environment.all.query();

        succeedSpinner();

        if (isJsonMode()) {
          outputData(environments);
          return;
        }

        if (environments.length === 0) {
          log("");
          log("No environments found.");
          return;
        }

        log("");
        table(
          ["ID", "NAME", "ACTIVE"],
          environments.map((env: any) => [
            colors.cyan(env.environmentId.slice(0, 8)),
            env.name,
            env.environmentId === profile?.environmentId ? colors.success("*") : "",
          ])
        );
        log("");
        log(`Current: ${colors.bold(profile?.environmentName || "None")}`);
      } catch (err) {
        handleError(err);
      }
    });

  // Switch environment
  envs
    .command("switch")
    .argument("<env>", "Environment ID or name")
    .description("Switch to a different environment")
    .action(async (envIdentifier) => {
      try {
        if (!isLoggedIn()) throw new AuthError();

        const client = getApiClient();
        const spinner = startSpinner("Switching environment...");

        const environments = await client.environment.all.query();
        const env = findEnv(environments, envIdentifier);

        if (!env) {
          failSpinner();
          const suggestions = findSimilar(
            envIdentifier,
            environments.map((e: any) => e.name)
          );
          throw new NotFoundError("Environment", envIdentifier, suggestions);
        }

        // Update local profile
        // In full implementation, this would call a tRPC endpoint to update session
        updateProfile({
          environmentId: env.environmentId,
          environmentName: env.name,
        });

        succeedSpinner(`Switched to ${env.name}`);

        if (isJsonMode()) {
          outputData({
            environmentId: env.environmentId,
            environmentName: env.name,
          });
        } else {
          quietOutput(env.environmentId);
          log("");
          log(`Environment: ${colors.bold(env.name)}`);
          log("");
        }
      } catch (err) {
        handleError(err);
      }
    });
}

// Helper functions
function findOrg(orgs: any[], identifier: string) {
  const lowerIdentifier = identifier.toLowerCase();

  return orgs.find(
    (org) =>
      org.id === identifier ||
      org.id.startsWith(identifier) ||
      org.name.toLowerCase() === lowerIdentifier
  );
}

function findEnv(envs: any[], identifier: string) {
  const lowerIdentifier = identifier.toLowerCase();

  return envs.find(
    (env) =>
      env.environmentId === identifier ||
      env.environmentId.startsWith(identifier) ||
      env.name.toLowerCase() === lowerIdentifier
  );
}
