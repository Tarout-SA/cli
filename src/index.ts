#!/usr/bin/env node

import { Command } from "commander";
import packageJson from "../package.json" with { type: "json" };
import { registerAccountCommands } from "./commands/account.js";
import { registerAiCommands } from "./commands/ai.js";
import { registerAppsCommands } from "./commands/apps.js";
import { registerAuthCommands } from "./commands/auth.js";
import { registerBackupsCommands } from "./commands/backups.js";
import { registerBillingCommands } from "./commands/billing.js";
import { registerBuildCommand } from "./commands/build.js";
import { registerDashboardCommands } from "./commands/dashboard.js";
import { registerDbCommands } from "./commands/db.js";
import {
	registerDeployCommands,
	registerLogsCommand,
} from "./commands/deploy.js";
import { registerDestinationsCommands } from "./commands/destinations.js";
import { registerDevCommand } from "./commands/dev.js";
import { registerDomainsCommands } from "./commands/domains.js";
import { registerEmailCommands } from "./commands/email.js";
import { registerEnvCommands } from "./commands/env.js";
import { registerFirewallCommands } from "./commands/firewall.js";
import { registerInboxCommands } from "./commands/inbox.js";
import { registerKeysCommands } from "./commands/keys.js";
import { registerLinkCommands } from "./commands/link.js";
import { registerMonitorCommands } from "./commands/monitor.js";
import { registerNotificationsCommands } from "./commands/notifications.js";
import { registerEnvsCommands, registerOrgsCommands } from "./commands/orgs.js";
import { registerProjectsCommands } from "./commands/projects.js";
import { registerProvidersCommands } from "./commands/providers.js";
import { registerQueuesCommands } from "./commands/queues.js";
import { registerServersCommands } from "./commands/servers.js";
import { registerSettingsCommands } from "./commands/settings.js";
import { registerSmsCommands } from "./commands/sms.js";
import { registerStorageCommands } from "./commands/storage.js";
import { registerTicketsCommands } from "./commands/tickets.js";
import { registerUpCommand } from "./commands/up.js";
import { registerWalletCommands } from "./commands/wallet.js";
import { registerWhatsappCommands } from "./commands/whatsapp.js";
import { setGlobalOptions } from "./lib/output.js";

const program = new Command();

// CLI metadata
program
	.name("tarout")
	.description("Tarout PaaS Command Line Interface")
	.version(packageJson.version)
	.option("--json", "Output as JSON (machine-readable)")
	.option("-y, --yes", "Skip all confirmation prompts")
	.option("-q, --quiet", "Minimal output")
	.option("-v, --verbose", "Extra debug information")
	.option("--no-color", "Disable colored output")
	.hook("preAction", (thisCommand) => {
		const opts = thisCommand.opts();
		setGlobalOptions({
			json: opts.json || false,
			yes: opts.yes || false,
			quiet: opts.quiet || false,
			verbose: opts.verbose || false,
			noColor: opts.color === false,
		});
	});

// Register all commands
registerAuthCommands(program);
registerAppsCommands(program);
registerDeployCommands(program);
registerUpCommand(program);
registerLogsCommand(program);
registerEnvCommands(program);
registerDbCommands(program);
registerDomainsCommands(program);
registerOrgsCommands(program);
registerProjectsCommands(program);
registerEnvsCommands(program);
registerLinkCommands(program);
registerDevCommand(program);
registerBuildCommand(program);
registerStorageCommands(program);
registerKeysCommands(program);
registerBillingCommands(program);
registerServersCommands(program);
registerMonitorCommands(program);
registerTicketsCommands(program);
registerWalletCommands(program);
registerAiCommands(program);
registerNotificationsCommands(program);
registerBackupsCommands(program);
registerAccountCommands(program);
registerDashboardCommands(program);
registerDestinationsCommands(program);
registerEmailCommands(program);
registerInboxCommands(program);
registerProvidersCommands(program);
registerSettingsCommands(program);
registerSmsCommands(program);
registerWhatsappCommands(program);
registerFirewallCommands(program);
registerQueuesCommands(program);

// Parse and execute
program.parse();
