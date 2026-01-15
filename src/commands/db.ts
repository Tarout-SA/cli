import { Command } from "commander";
import { spawn } from "node:child_process";
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
  shouldSkipConfirmation,
  quietOutput,
  box,
} from "../lib/output.js";
import {
  startSpinner,
  succeedSpinner,
  failSpinner,
} from "../utils/spinner.js";
import { confirm, input, select } from "../utils/prompts.js";
import { ExitCode } from "../utils/exit-codes.js";

type DatabaseType = "postgres" | "mysql" | "redis";

export function registerDbCommands(program: Command) {
  const db = program.command("db").description("Manage databases");

  // List databases
  db.command("list")
    .alias("ls")
    .description("List all databases")
    .option("-t, --type <type>", "Filter by type (postgres, mysql, redis)")
    .action(async (options) => {
      try {
        if (!isLoggedIn()) throw new AuthError();

        const client = getApiClient();
        const spinner = startSpinner("Fetching databases...");

        // Fetch all database types
        const [postgres, mysql, redis] = await Promise.all([
          client.postgres.allByOrganization.query(),
          client.mysql.allByOrganization.query(),
          client.redis.allByOrganization.query(),
        ]);

        succeedSpinner();

        // Combine and filter
        let databases: Array<{
          id: string;
          name: string;
          type: DatabaseType;
          status: string;
          created: Date | string;
        }> = [];

        if (!options.type || options.type === "postgres") {
          databases = databases.concat(
            postgres.map((db: any) => ({
              id: db.postgresId,
              name: db.name,
              type: "postgres" as DatabaseType,
              status: db.applicationStatus,
              created: db.createdAt,
            }))
          );
        }

        if (!options.type || options.type === "mysql") {
          databases = databases.concat(
            mysql.map((db: any) => ({
              id: db.mysqlId,
              name: db.name,
              type: "mysql" as DatabaseType,
              status: db.applicationStatus,
              created: db.createdAt,
            }))
          );
        }

        if (!options.type || options.type === "redis") {
          databases = databases.concat(
            redis.map((db: any) => ({
              id: db.redisId,
              name: db.name,
              type: "redis" as DatabaseType,
              status: db.applicationStatus,
              created: db.createdAt,
            }))
          );
        }

        if (isJsonMode()) {
          outputData(databases);
          return;
        }

        if (databases.length === 0) {
          log("");
          log("No databases found.");
          log("");
          log(`Create one with: ${colors.dim("tarout db create <name>")}`);
          return;
        }

        log("");
        table(
          ["ID", "NAME", "TYPE", "STATUS", "CREATED"],
          databases.map((db) => [
            colors.cyan(db.id.slice(0, 8)),
            db.name,
            getTypeLabel(db.type),
            getStatusBadge(db.status),
            formatDate(db.created),
          ])
        );
        log("");
        log(
          colors.dim(`${databases.length} database${databases.length === 1 ? "" : "s"}`)
        );
      } catch (err) {
        handleError(err);
      }
    });

  // Create database
  db.command("create")
    .argument("[name]", "Database name")
    .description("Create a new database")
    .option("-t, --type <type>", "Database type (postgres, mysql, redis)", "postgres")
    .option("-d, --description <description>", "Database description")
    .action(async (name, options) => {
      try {
        if (!isLoggedIn()) throw new AuthError();

        const profile = getCurrentProfile();
        if (!profile) throw new AuthError();

        // Interactive mode if no name provided
        let dbName = name;
        let dbType = options.type as DatabaseType;

        if (!dbName) {
          dbName = await input("Database name:");
        }

        if (!options.type && !shouldSkipConfirmation()) {
          dbType = await select("Database type:", [
            { name: "PostgreSQL", value: "postgres" },
            { name: "MySQL", value: "mysql" },
            { name: "Redis", value: "redis" },
          ]);
        }

        // Generate appName (URL-safe slug)
        const slug = generateSlug(dbName);

        const client = getApiClient();
        const spinner = startSpinner(`Creating ${dbType} database...`);

        let database: any;

        switch (dbType) {
          case "postgres":
            database = await client.postgres.create.mutate({
              name: dbName,
              appName: slug,
              dockerImage: "postgres:17",
              organizationId: profile.organizationId,
              description: options.description,
            });
            break;
          case "mysql":
            database = await client.mysql.create.mutate({
              name: dbName,
              appName: slug,
              dockerImage: "mysql:8",
              organizationId: profile.organizationId,
              description: options.description,
            });
            break;
          case "redis":
            database = await client.redis.create.mutate({
              name: dbName,
              appName: slug,
              dockerImage: "redis:7",
              organizationId: profile.organizationId,
              description: options.description,
            });
            break;
          default:
            throw new CliError(`Unsupported database type: ${dbType}`, ExitCode.INVALID_ARGUMENTS);
        }

        succeedSpinner("Database created!");

        const dbId = database.postgresId || database.mysqlId || database.redisId;

        if (isJsonMode()) {
          outputData(database);
          return;
        }

        quietOutput(dbId);

        box("Database Created", [
          `ID: ${colors.cyan(dbId)}`,
          `Name: ${database.name}`,
          `Type: ${getTypeLabel(dbType)}`,
        ]);

        log("Next steps:");
        log(`  View connection info: ${colors.dim(`tarout db info ${dbId.slice(0, 8)}`)}`);
        log("");
      } catch (err) {
        handleError(err);
      }
    });

  // Delete database
  db.command("delete")
    .alias("rm")
    .argument("<db>", "Database ID or name")
    .description("Delete a database")
    .action(async (dbIdentifier) => {
      try {
        if (!isLoggedIn()) throw new AuthError();

        const client = getApiClient();

        // Find the database
        const spinner = startSpinner("Finding database...");
        const allDbs = await getAllDatabases(client);
        const dbInfo = findDatabase(allDbs, dbIdentifier);

        if (!dbInfo) {
          failSpinner();
          const suggestions = findSimilar(
            dbIdentifier,
            allDbs.map((d) => d.name)
          );
          throw new NotFoundError("Database", dbIdentifier, suggestions);
        }

        succeedSpinner();

        // Confirm deletion
        if (!shouldSkipConfirmation()) {
          log("");
          log(`Database: ${colors.bold(dbInfo.name)}`);
          log(`Type: ${getTypeLabel(dbInfo.type)}`);
          log(`ID: ${colors.dim(dbInfo.id)}`);
          log("");

          const confirmed = await confirm(
            `Are you sure you want to delete "${dbInfo.name}"? This cannot be undone.`,
            false
          );

          if (!confirmed) {
            log("Cancelled.");
            return;
          }
        }

        const deleteSpinner = startSpinner("Deleting database...");

        switch (dbInfo.type) {
          case "postgres":
            await client.postgres.remove.mutate({ postgresId: dbInfo.id });
            break;
          case "mysql":
            await client.mysql.remove.mutate({ mysqlId: dbInfo.id });
            break;
          case "redis":
            await client.redis.remove.mutate({ redisId: dbInfo.id });
            break;
        }

        succeedSpinner("Database deleted!");

        if (isJsonMode()) {
          outputData({ deleted: true, id: dbInfo.id });
        } else {
          quietOutput(dbInfo.id);
        }
      } catch (err) {
        handleError(err);
      }
    });

  // Get database info
  db.command("info")
    .argument("<db>", "Database ID or name")
    .description("Show database details and connection info")
    .action(async (dbIdentifier) => {
      try {
        if (!isLoggedIn()) throw new AuthError();

        const client = getApiClient();

        // Find the database
        const spinner = startSpinner("Fetching database info...");
        const allDbs = await getAllDatabases(client);
        const dbSummary = findDatabase(allDbs, dbIdentifier);

        if (!dbSummary) {
          failSpinner();
          const suggestions = findSimilar(
            dbIdentifier,
            allDbs.map((d) => d.name)
          );
          throw new NotFoundError("Database", dbIdentifier, suggestions);
        }

        // Get full details
        let dbDetails: any;
        switch (dbSummary.type) {
          case "postgres":
            dbDetails = await client.postgres.one.query({ postgresId: dbSummary.id });
            break;
          case "mysql":
            dbDetails = await client.mysql.one.query({ mysqlId: dbSummary.id });
            break;
          case "redis":
            dbDetails = await client.redis.one.query({ redisId: dbSummary.id });
            break;
        }

        succeedSpinner();

        if (isJsonMode()) {
          outputData(dbDetails);
          return;
        }

        log("");
        log(colors.bold(dbDetails.name));
        log(colors.dim(dbSummary.id));
        log("");

        // Status
        log(`${colors.bold("Status")}`);
        log(`  ${getStatusBadge(dbDetails.applicationStatus)}`);
        log(`  Type: ${getTypeLabel(dbSummary.type)}`);
        log("");

        // Connection info
        log(`${colors.bold("Connection")}`);
        if (dbSummary.type === "redis") {
          if (dbDetails.cloudHost) {
            log(`  Host: ${colors.cyan(dbDetails.cloudHost)}`);
            log(`  Port: ${dbDetails.cloudPort || 6379}`);
            if (dbDetails.cloudPassword) {
              log(`  Password: ${colors.dim("********")}`);
            }
          } else {
            log(`  ${colors.dim("Not yet deployed")}`);
          }
        } else {
          if (dbDetails.cloudInstanceId || dbDetails.databaseName) {
            log(`  Host: ${colors.cyan(dbDetails.cloudHost || "localhost")}`);
            log(`  Port: ${dbDetails.cloudPort || (dbSummary.type === "postgres" ? 5432 : 3306)}`);
            log(`  Database: ${dbDetails.cloudDatabaseName || dbDetails.databaseName}`);
            log(`  Username: ${dbDetails.cloudUsername || dbDetails.databaseUser}`);
            log(`  Password: ${colors.dim("********")}`);
          } else {
            log(`  ${colors.dim("Not yet deployed")}`);
          }
        }
        log("");

        // Connection string
        if (dbDetails.cloudHost || dbDetails.databaseName) {
          log(`${colors.bold("Connection String")}`);
          const connStr = getConnectionString(dbSummary.type, dbDetails);
          log(`  ${colors.cyan(connStr)}`);
          log("");
        }

        // Created
        log(`${colors.bold("Created")}`);
        log(`  ${new Date(dbDetails.createdAt).toLocaleString()}`);
        log("");
      } catch (err) {
        handleError(err);
      }
    });

  // Connect to database shell
  db.command("connect")
    .argument("<db>", "Database ID or name")
    .description("Open interactive database shell")
    .action(async (dbIdentifier) => {
      try {
        if (!isLoggedIn()) throw new AuthError();

        const client = getApiClient();

        // Find the database
        const spinner = startSpinner("Connecting to database...");
        const allDbs = await getAllDatabases(client);
        const dbSummary = findDatabase(allDbs, dbIdentifier);

        if (!dbSummary) {
          failSpinner();
          const suggestions = findSimilar(
            dbIdentifier,
            allDbs.map((d) => d.name)
          );
          throw new NotFoundError("Database", dbIdentifier, suggestions);
        }

        // Get full details
        let dbDetails: any;
        switch (dbSummary.type) {
          case "postgres":
            dbDetails = await client.postgres.one.query({ postgresId: dbSummary.id });
            break;
          case "mysql":
            dbDetails = await client.mysql.one.query({ mysqlId: dbSummary.id });
            break;
          case "redis":
            dbDetails = await client.redis.one.query({ redisId: dbSummary.id });
            break;
        }

        succeedSpinner();

        // Check if database is deployed
        if (!dbDetails.cloudHost && !dbDetails.databaseName) {
          throw new CliError("Database not deployed yet. Deploy first.", ExitCode.GENERAL_ERROR);
        }

        // Build connection command
        const { command, args, env } = getConnectCommand(dbSummary.type, dbDetails);

        log("");
        log(`Connecting to ${colors.bold(dbDetails.name)}...`);
        log(colors.dim("Press Ctrl+D to exit"));
        log("");

        // Spawn the shell
        const child = spawn(command, args, {
          stdio: "inherit",
          env: { ...process.env, ...env },
        });

        child.on("exit", (code) => {
          process.exit(code || 0);
        });
      } catch (err) {
        handleError(err);
      }
    });
}

// Helper functions
async function getAllDatabases(client: ReturnType<typeof getApiClient>) {
  const [postgres, mysql, redis] = await Promise.all([
    client.postgres.allByOrganization.query(),
    client.mysql.allByOrganization.query(),
    client.redis.allByOrganization.query(),
  ]);

  const databases: Array<{
    id: string;
    name: string;
    type: DatabaseType;
    status: string;
  }> = [];

  for (const db of postgres as any[]) {
    databases.push({
      id: db.postgresId,
      name: db.name,
      type: "postgres",
      status: db.applicationStatus,
    });
  }

  for (const db of mysql as any[]) {
    databases.push({
      id: db.mysqlId,
      name: db.name,
      type: "mysql",
      status: db.applicationStatus,
    });
  }

  for (const db of redis as any[]) {
    databases.push({
      id: db.redisId,
      name: db.name,
      type: "redis",
      status: db.applicationStatus,
    });
  }

  return databases;
}

function findDatabase(
  databases: Array<{ id: string; name: string; type: DatabaseType }>,
  identifier: string
) {
  const lowerIdentifier = identifier.toLowerCase();

  return databases.find(
    (db) =>
      db.id === identifier ||
      db.id.startsWith(identifier) ||
      db.name.toLowerCase() === lowerIdentifier
  );
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

function formatDate(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getTypeLabel(type: DatabaseType): string {
  const labels: Record<DatabaseType, string> = {
    postgres: colors.info("PostgreSQL"),
    mysql: colors.warn("MySQL"),
    redis: colors.error("Redis"),
  };
  return labels[type] || type;
}

function getConnectionString(type: DatabaseType, details: any): string {
  const host = details.cloudHost || "localhost";
  const user = details.cloudUsername || details.databaseUser || "user";
  const dbName = details.cloudDatabaseName || details.databaseName || "db";

  switch (type) {
    case "postgres":
      const pgPort = details.cloudPort || 5432;
      return `postgresql://${user}:****@${host}:${pgPort}/${dbName}`;
    case "mysql":
      const myPort = details.cloudPort || 3306;
      return `mysql://${user}:****@${host}:${myPort}/${dbName}`;
    case "redis":
      const redisPort = details.cloudPort || 6379;
      return `redis://:****@${host}:${redisPort}`;
    default:
      return "";
  }
}

function getConnectCommand(
  type: DatabaseType,
  details: any
): { command: string; args: string[]; env: Record<string, string> } {
  const host = details.cloudHost || "localhost";
  const user = details.cloudUsername || details.databaseUser || "user";
  const password = details.cloudPassword || details.databasePassword || "";
  const dbName = details.cloudDatabaseName || details.databaseName || "db";

  switch (type) {
    case "postgres":
      return {
        command: "psql",
        args: [
          "-h", host,
          "-p", String(details.cloudPort || 5432),
          "-U", user,
          "-d", dbName,
        ],
        env: { PGPASSWORD: password },
      };
    case "mysql":
      return {
        command: "mysql",
        args: [
          "-h", host,
          "-P", String(details.cloudPort || 3306),
          "-u", user,
          `-p${password}`,
          dbName,
        ],
        env: {},
      };
    case "redis":
      return {
        command: "redis-cli",
        args: [
          "-h", host,
          "-p", String(details.cloudPort || 6379),
          ...(password ? ["-a", password] : []),
        ],
        env: {},
      };
    default:
      throw new CliError(`Unsupported database type: ${type}`, ExitCode.INVALID_ARGUMENTS);
  }
}
