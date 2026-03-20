import type { Command } from "commander";
import { getApiClient } from "../lib/api.js";
import { isLoggedIn } from "../lib/config.js";
import {
	AuthError,
	findSimilar,
	handleError,
	InvalidArgumentError,
	NotFoundError,
} from "../lib/errors.js";
import {
	box,
	colors,
	error,
	isJsonMode,
	log,
	outputData,
	quietOutput,
	shouldSkipConfirmation,
	success,
	table,
} from "../lib/output.js";
import { confirm } from "../utils/prompts.js";
import { failSpinner, startSpinner, succeedSpinner } from "../utils/spinner.js";

export function registerDomainsCommands(program: Command) {
	const domains = program
		.command("domains")
		.description("Manage domains and DNS");

	// ── List registered domains (purchased + external) ──
	domains
		.command("list")
		.alias("ls")
		.description("List all registered domains (purchased and external)")
		.action(async () => {
			try {
				if (!isLoggedIn()) throw new AuthError();

				const client = getApiClient();
				const _spinner = startSpinner("Fetching domains...");

				const domainsList: any[] = await client.domainRegistrar.getAll.query();

				succeedSpinner();

				if (isJsonMode()) {
					outputData(domainsList);
					return;
				}

				if (domainsList.length === 0) {
					log("");
					log("No registered domains found.");
					log("");
					log(
						`Register one with: ${colors.dim("tarout domains register <domain>")}`,
					);
					log(
						`Or add an external domain: ${colors.dim("tarout domains add-external <domain>")}`,
					);
					return;
				}

				log("");
				table(
					["DOMAIN", "SOURCE", "STATUS", "CF ZONE", "EXPIRY", "AUTO-RENEW"],
					domainsList.map((d: any) => [
						colors.cyan(d.domainName),
						d.source === "purchased"
							? colors.info("purchased")
							: colors.dim("external"),
						formatStatus(d.status),
						formatCfStatus(d.cloudflareZoneStatus),
						d.source === "purchased" && d.expiryDate
							? formatDate(d.expiryDate)
							: colors.dim("-"),
						d.source === "purchased"
							? d.autoRenew
								? colors.success("on")
								: colors.warn("off")
							: colors.dim("-"),
					]),
				);
				log("");
				log(
					colors.dim(
						`${domainsList.length} domain${domainsList.length === 1 ? "" : "s"}`,
					),
				);
			} catch (err) {
				handleError(err);
			}
		});

	// ── Register (purchase) a domain ──
	domains
		.command("register")
		.argument("<domain>", "Domain name to register (e.g., example.com)")
		.description("Purchase a domain via Name.com")
		.action(async (domainName) => {
			try {
				if (!isLoggedIn()) throw new AuthError();

				if (!isValidDomain(domainName)) {
					throw new InvalidArgumentError(
						`Invalid domain format: ${domainName}. Use format like: example.com`,
					);
				}

				const client = getApiClient();

				// Check availability
				const _spinner = startSpinner(
					`Checking availability for ${domainName}...`,
				);
				const availability = await client.domainRegistrar.searchDomain.query({
					domainName,
				});

				if (!availability.available) {
					failSpinner();
					error(`${domainName} is not available for registration.`);
					return;
				}

				succeedSpinner();

				if (isJsonMode()) {
					outputData(availability);
					return;
				}

				log("");
				log(`${colors.cyan(domainName)} is ${colors.success("available")}!`);
				log(
					`  Price: ${colors.bold(`${availability.purchasePrice} ${availability.currency}`)}`,
				);
				log(
					`  Renewal: ${colors.dim(`${availability.renewalPrice} ${availability.currency}/yr`)}`,
				);
				if (availability.premium) {
					log(`  ${colors.warn("Premium domain")}`);
				}
				log("");

				if (!shouldSkipConfirmation()) {
					const confirmed = await confirm(
						`Proceed to payment for ${domainName}?`,
						false,
					);
					if (!confirmed) {
						log("Cancelled.");
						return;
					}
				}

				const _paySpinner = startSpinner("Creating payment link...");

				const payment =
					await client.domainRegistrar.createRegistrationPayment.mutate({
						domainName,
						years: 1,
						privacyEnabled: true,
						autoRenew: true,
					});

				succeedSpinner();

				box("Domain Registration Payment", [
					`Domain: ${colors.cyan(domainName)}`,
					`Amount: ${payment.amount} SAR`,
					`Payment URL: ${colors.cyan(payment.paymentUrl)}`,
				]);

				log("Open the payment URL above to complete your purchase.");
				log("");
			} catch (err) {
				handleError(err);
			}
		});

	// ── Add external domain ──
	domains
		.command("add-external")
		.argument("<domain>", "Domain name (e.g., example.com)")
		.description(
			"Add an externally-registered domain and get Cloudflare nameservers",
		)
		.action(async (domainName) => {
			try {
				if (!isLoggedIn()) throw new AuthError();

				if (!isValidDomain(domainName)) {
					throw new InvalidArgumentError(
						`Invalid domain format: ${domainName}. Use format like: example.com`,
					);
				}

				const client = getApiClient();
				const _spinner = startSpinner(
					`Adding external domain ${domainName}...`,
				);

				const result = await client.domainRegistrar.addExternalDomain.mutate({
					domainName,
				});

				succeedSpinner("External domain added!");

				if (isJsonMode()) {
					outputData(result);
					return;
				}

				quietOutput(result.domain.domainId);

				box("External Domain Added", [
					`Domain: ${colors.cyan(domainName)}`,
					`Domain ID: ${colors.dim(result.domain.domainId)}`,
				]);

				if (
					result.cloudflareNameservers &&
					result.cloudflareNameservers.length > 0
				) {
					log("Change your domain's nameservers at your registrar to:");
					log("");
					for (const ns of result.cloudflareNameservers) {
						log(`  ${colors.cyan(ns)}`);
					}
					log("");
					log(
						`Then verify: ${colors.dim(`tarout domains verify ${result.domain.domainId.slice(0, 8)}`)}`,
					);
					log("");
					log(
						colors.dim(
							"Nameserver changes can take up to 48 hours to propagate.",
						),
					);
				}
			} catch (err) {
				handleError(err);
			}
		});

	// ── Verify external domain nameservers ──
	domains
		.command("verify")
		.argument("<domain>", "Domain ID or domain name")
		.description("Verify nameserver change for an external domain")
		.action(async (domainIdentifier) => {
			try {
				if (!isLoggedIn()) throw new AuthError();

				const client = getApiClient();

				const _spinner = startSpinner("Finding domain...");
				const allDomains: any[] = await client.domainRegistrar.getAll.query();
				const domain = findRegisteredDomain(allDomains, domainIdentifier);

				if (!domain) {
					failSpinner();
					const suggestions = findSimilar(
						domainIdentifier,
						allDomains.map((d: any) => d.domainName),
					);
					throw new NotFoundError("Domain", domainIdentifier, suggestions);
				}

				updateSpinner("Verifying nameservers...");

				const result = await client.domainRegistrar.verifyExternalDomain.mutate(
					{
						domainId: domain.domainId,
					},
				);

				succeedSpinner();

				if (isJsonMode()) {
					outputData(result);
					return;
				}

				log("");

				if (result.verified) {
					success(`Domain ${colors.cyan(domain.domainName)} is verified!`);
					log("");
					log(
						"Nameservers are correctly configured. DNS management is now active.",
					);
				} else {
					error(`Nameserver change not yet detected for ${domain.domainName}`);
					log("");
					if (
						domain.cloudflareNameservers &&
						domain.cloudflareNameservers.length > 0
					) {
						log("Ensure your nameservers are set to:");
						log("");
						for (const ns of domain.cloudflareNameservers) {
							log(`  ${colors.cyan(ns)}`);
						}
					}
					log("");
					log(
						colors.dim(
							"Nameserver changes can take up to 48 hours to propagate.",
						),
					);
				}
				log("");
			} catch (err) {
				handleError(err);
			}
		});

	// ── Add domain to application (kept from old CLI) ──
	domains
		.command("link")
		.argument("<app>", "Application ID or name")
		.argument("<domain>", "Domain name (e.g., app.example.com)")
		.description("Link a custom domain to an application")
		.action(async (appIdentifier, domainName) => {
			try {
				if (!isLoggedIn()) throw new AuthError();

				if (!isValidDomain(domainName)) {
					throw new InvalidArgumentError(
						`Invalid domain format: ${domainName}. Use format like: app.example.com`,
					);
				}

				const client = getApiClient();

				const _spinner = startSpinner("Finding application...");
				const apps = await client.application.allByOrganization.query();
				const app = findApp(apps, appIdentifier);

				if (!app) {
					failSpinner();
					const suggestions = findSimilar(
						appIdentifier,
						apps.map((a: any) => a.name),
					);
					throw new NotFoundError("Application", appIdentifier, suggestions);
				}

				updateSpinner("Linking domain...");

				const domain = await client.domain.create.mutate({
					host: domainName,
					applicationId: app.applicationId,
				});

				succeedSpinner("Domain linked!");

				if (isJsonMode()) {
					outputData(domain);
					return;
				}

				quietOutput(domain.domainId);

				box("Domain Linked", [
					`Domain: ${colors.cyan(domainName)}`,
					`Application: ${app.name}`,
					`Status: ${domain.isVerified ? colors.success("Verified") : colors.warn("Pending verification")}`,
				]);
			} catch (err) {
				handleError(err);
			}
		});

	// ── Remove app domain ──
	domains
		.command("unlink")
		.argument("<domain>", "Domain ID or hostname")
		.description("Unlink a domain from an application")
		.action(async (domainIdentifier) => {
			try {
				if (!isLoggedIn()) throw new AuthError();

				const client = getApiClient();

				const _spinner = startSpinner("Finding domain...");
				const allDomains = await client.domain.all.query({
					includeUnlinked: true,
				});
				const domain = findAppDomain(allDomains, domainIdentifier);

				if (!domain) {
					failSpinner();
					const suggestions = findSimilar(
						domainIdentifier,
						allDomains.map((d: any) => d.host),
					);
					throw new NotFoundError("Domain", domainIdentifier, suggestions);
				}

				succeedSpinner();

				if (!shouldSkipConfirmation()) {
					log("");
					log(`Domain: ${colors.bold(domain.host)}`);
					if (domain.application) {
						log(`Application: ${domain.application.name}`);
					}
					log("");

					const confirmed = await confirm(
						`Are you sure you want to unlink "${domain.host}"?`,
						false,
					);

					if (!confirmed) {
						log("Cancelled.");
						return;
					}
				}

				const _deleteSpinner = startSpinner("Unlinking domain...");

				await client.domain.delete.mutate({
					domainId: domain.domainId,
				});

				succeedSpinner("Domain unlinked!");

				if (isJsonMode()) {
					outputData({ deleted: true, domainId: domain.domainId });
				} else {
					quietOutput(domain.domainId);
				}
			} catch (err) {
				handleError(err);
			}
		});

	// ── DNS subcommand group ──
	const dns = domains
		.command("dns")
		.description("Manage DNS records (via Cloudflare)");

	// dns list <domain>
	dns
		.command("list")
		.alias("ls")
		.argument("<domain>", "Domain ID or domain name")
		.description("List DNS records for a domain")
		.action(async (domainIdentifier) => {
			try {
				if (!isLoggedIn()) throw new AuthError();

				const client = getApiClient();

				const _spinner = startSpinner("Fetching DNS records...");
				const allDomains: any[] = await client.domainRegistrar.getAll.query();
				const domain = findRegisteredDomain(allDomains, domainIdentifier);

				if (!domain) {
					failSpinner();
					const suggestions = findSimilar(
						domainIdentifier,
						allDomains.map((d: any) => d.domainName),
					);
					throw new NotFoundError("Domain", domainIdentifier, suggestions);
				}

				const records = await client.dns.listByDomain.query({
					registeredDomainId: domain.domainId,
				});

				succeedSpinner();

				if (isJsonMode()) {
					outputData(records);
					return;
				}

				if (!records || records.length === 0) {
					log("");
					log(`No DNS records for ${colors.cyan(domain.domainName)}.`);
					log("");
					log(
						`Add one with: ${colors.dim(`tarout domains dns add ${domain.domainName} A @ 1.2.3.4`)}`,
					);
					return;
				}

				log("");
				log(`DNS records for ${colors.cyan(domain.domainName)}:`);
				log("");
				table(
					["TYPE", "NAME", "CONTENT", "TTL", "PROXIED"],
					records.map((r: any) => [
						colors.bold(r.type),
						r.name,
						truncate(r.content, 40),
						r.ttl === 1 ? "Auto" : `${r.ttl}s`,
						r.proxied ? colors.warn("on") : colors.dim("off"),
					]),
				);
				log("");
				log(
					colors.dim(
						`${records.length} record${records.length === 1 ? "" : "s"}`,
					),
				);
			} catch (err) {
				handleError(err);
			}
		});

	// dns add <domain> <type> <name> <content>
	dns
		.command("add")
		.argument("<domain>", "Domain ID or domain name")
		.argument("<type>", "Record type (A, AAAA, CNAME, MX, TXT, NS, SRV, CAA)")
		.argument("<name>", 'Record name (e.g., "@" for root, "www", "sub")')
		.argument("<content>", "Record content (e.g., IP address, hostname)")
		.option(
			"-p, --priority <priority>",
			"Priority (for MX/SRV)",
			Number.parseInt,
		)
		.option(
			"-t, --ttl <ttl>",
			"TTL in seconds (default: auto)",
			Number.parseInt,
		)
		.description("Create a DNS record at Cloudflare")
		.action(async (domainIdentifier, type, name, content, options) => {
			try {
				if (!isLoggedIn()) throw new AuthError();

				const upperType = type.toUpperCase();
				const validTypes = [
					"A",
					"AAAA",
					"CNAME",
					"MX",
					"TXT",
					"NS",
					"SRV",
					"CAA",
				];
				if (!validTypes.includes(upperType)) {
					throw new InvalidArgumentError(
						`Invalid record type: ${type}. Must be one of: ${validTypes.join(", ")}`,
					);
				}

				const client = getApiClient();

				const _spinner = startSpinner("Finding domain...");
				const allDomains: any[] = await client.domainRegistrar.getAll.query();
				const domain = findRegisteredDomain(allDomains, domainIdentifier);

				if (!domain) {
					failSpinner();
					const suggestions = findSimilar(
						domainIdentifier,
						allDomains.map((d: any) => d.domainName),
					);
					throw new NotFoundError("Domain", domainIdentifier, suggestions);
				}

				updateSpinner("Creating DNS record...");

				const input: any = {
					registeredDomainId: domain.domainId,
					type: upperType,
					name,
					content,
				};

				if (options.priority !== undefined) {
					input.priority = options.priority;
				}
				if (options.ttl !== undefined) {
					input.ttl = options.ttl;
				}

				const record = await client.dns.create.mutate(input);

				succeedSpinner("DNS record created!");

				if (isJsonMode()) {
					outputData(record);
					return;
				}

				quietOutput(record.recordId);

				box("DNS Record Created", [
					`Type: ${colors.bold(upperType)}`,
					`Name: ${name}`,
					`Content: ${content}`,
					`Domain: ${domain.domainName}`,
				]);
			} catch (err) {
				handleError(err);
			}
		});

	// dns remove <recordId>
	dns
		.command("remove")
		.alias("rm")
		.argument("<recordId>", "DNS record ID")
		.description("Delete a DNS record")
		.action(async (recordId) => {
			try {
				if (!isLoggedIn()) throw new AuthError();

				const client = getApiClient();

				if (!shouldSkipConfirmation()) {
					const confirmed = await confirm(
						`Are you sure you want to delete DNS record "${recordId}"?`,
						false,
					);
					if (!confirmed) {
						log("Cancelled.");
						return;
					}
				}

				const _spinner = startSpinner("Deleting DNS record...");

				await client.dns.delete.mutate({ recordId });

				succeedSpinner("DNS record deleted!");

				if (isJsonMode()) {
					outputData({ deleted: true, recordId });
				} else {
					quietOutput(recordId);
				}
			} catch (err) {
				handleError(err);
			}
		});

	// ── Nameservers ──
	domains
		.command("ns")
		.argument("<domain>", "Domain ID or domain name")
		.description("Show nameservers for a domain")
		.action(async (domainIdentifier) => {
			try {
				if (!isLoggedIn()) throw new AuthError();

				const client = getApiClient();

				const _spinner = startSpinner("Fetching nameservers...");
				const allDomains: any[] = await client.domainRegistrar.getAll.query();
				const domain = findRegisteredDomain(allDomains, domainIdentifier);

				if (!domain) {
					failSpinner();
					const suggestions = findSimilar(
						domainIdentifier,
						allDomains.map((d: any) => d.domainName),
					);
					throw new NotFoundError("Domain", domainIdentifier, suggestions);
				}

				const nsData = await client.dns.getNameservers.query({
					registeredDomainId: domain.domainId,
				});

				succeedSpinner();

				if (isJsonMode()) {
					outputData(nsData);
					return;
				}

				log("");
				log(`Nameservers for ${colors.cyan(domain.domainName)}:`);
				log("");

				if (
					nsData.cloudflareNameservers &&
					nsData.cloudflareNameservers.length > 0
				) {
					log(`  ${colors.bold("Cloudflare (assigned):")}`);
					for (const ns of nsData.cloudflareNameservers) {
						log(`    ${colors.cyan(ns)}`);
					}
				}

				if (nsData.currentNameservers && nsData.currentNameservers.length > 0) {
					log("");
					log(`  ${colors.bold("Current nameservers:")}`);
					for (const ns of nsData.currentNameservers) {
						log(`    ${ns}`);
					}
				}

				if (nsData.cloudflareZoneStatus) {
					log("");
					log(`  Zone status: ${formatCfStatus(nsData.cloudflareZoneStatus)}`);
				}

				log("");
			} catch (err) {
				handleError(err);
			}
		});
}

// ── Helper functions ──

function findApp(
	apps: Array<{ applicationId: string; name: string; appName?: string }>,
	identifier: string,
) {
	const lowerIdentifier = identifier.toLowerCase();

	return apps.find(
		(app) =>
			app.applicationId === identifier ||
			app.applicationId.startsWith(identifier) ||
			app.name.toLowerCase() === lowerIdentifier ||
			app.appName?.toLowerCase() === lowerIdentifier,
	);
}

/** Find a registered domain by domainId or domainName */
function findRegisteredDomain(domains: any[], identifier: string) {
	const lowerIdentifier = identifier.toLowerCase();

	return domains.find(
		(d: any) =>
			d.domainId === identifier ||
			d.domainId.startsWith(identifier) ||
			d.domainName.toLowerCase() === lowerIdentifier,
	);
}

/** Find an app domain (domain model) by domainId or host */
function findAppDomain(domains: any[], identifier: string) {
	const lowerIdentifier = identifier.toLowerCase();

	return domains.find(
		(d: any) =>
			d.domainId === identifier ||
			d.domainId.startsWith(identifier) ||
			d.host.toLowerCase() === lowerIdentifier,
	);
}

function isValidDomain(domain: string): boolean {
	const pattern =
		/^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
	return pattern.test(domain);
}

function updateSpinner(text: string) {
	import("../utils/spinner.js").then(({ startSpinner }) => {
		startSpinner(text);
	});
}

function formatStatus(status: string): string {
	switch (status) {
		case "active":
			return colors.success("active");
		case "pending":
			return colors.warn("pending");
		case "expired":
			return colors.error("expired");
		case "cancelled":
			return colors.dim("cancelled");
		default:
			return status;
	}
}

function formatCfStatus(status: string | null | undefined): string {
	if (!status) return colors.dim("-");
	switch (status) {
		case "active":
			return colors.success("active");
		case "pending":
			return colors.warn("pending");
		case "moved":
			return colors.warn("moved");
		case "deleted":
			return colors.error("deleted");
		default:
			return status;
	}
}

function formatDate(dateValue: string | Date): string {
	try {
		const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
		return date.toISOString().split("T")[0] || "";
	} catch {
		return String(dateValue);
	}
}

function truncate(str: string, max: number): string {
	if (str.length <= max) return str;
	return `${str.slice(0, max - 3)}...`;
}
