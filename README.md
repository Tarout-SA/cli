# Tarout CLI

[![npm version](https://img.shields.io/npm/v/@tarout/cli.svg)](https://www.npmjs.com/package/@tarout/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

The official command-line interface for [Tarout](https://tarout.sa) — the Saudi cloud platform built for coding agents. Your agent writes code and defines infrastructure; Tarout provisions it instantly.

## Installation

```bash
curl -fsSL https://tarout.sa/install.sh | sh
```

Or with other package managers:

```bash
# Using npm
npm install -g @tarout/cli

# Using yarn
yarn global add @tarout/cli

# Using pnpm
pnpm add -g @tarout/cli

# Using bun
bun add -g @tarout/cli
```

## Quick Start

```bash
# 1. Login via browser (opens authentication page)
tarout login

# 2. Deploy from your project root
tarout deploy --wait

# The first deploy prompts to create or link an app when needed.
```

## Commands

### Authentication

| Command | Description |
|---------|-------------|
| `tarout login` | Authenticate via browser |
| `tarout logout` | Sign out and clear credentials |
| `tarout whoami` | Show current user, organization, and environment |

```bash
# Login with a custom API URL (e.g. staging)
tarout login --api-url https://staging.tarout.sa
```

### Applications

| Command | Description |
|---------|-------------|
| `tarout apps list` | List all applications |
| `tarout apps create <name>` | Create a new application |
| `tarout apps delete <app>` | Delete an application |
| `tarout apps info <app>` | Show application details |
| `tarout apps open <app>` | Open application URL in browser |

```bash
# List apps as JSON
tarout apps list --json

# Create an app
tarout apps create my-api

# Delete without confirmation
tarout apps delete my-api --yes
```

### Deployment

| Command | Description |
|---------|-------------|
| `tarout deploy [app]` | Deploy an application |
| `tarout deploy:status <app>` | Check deployment status |
| `tarout deploy:cancel <app>` | Cancel running deployment |
| `tarout deploy:list <app>` | List recent deployments |

```bash
# Deploy the linked application
tarout deploy --wait

# Deploy and wait for completion
tarout deploy my-app --wait

# Check deployment status
tarout deploy:status my-app
```

### Logs

| Command | Description |
|---------|-------------|
| `tarout logs <app>` | View application logs |

```bash
# Stream logs continuously
tarout logs my-app --follow

# Filter by log level
tarout logs my-app --level error

# Logs from last hour
tarout logs my-app --since 1h

# Last 100 lines
tarout logs my-app --lines 100
```

### Environment Variables

| Command | Description |
|---------|-------------|
| `tarout env <app> list` | List environment variables (masked) |
| `tarout env <app> set <KEY=value>` | Set an environment variable |
| `tarout env <app> unset <KEY>` | Remove an environment variable |
| `tarout env <app> pull` | Download variables as .env file |
| `tarout env <app> push` | Upload variables from .env file |

```bash
# Set a variable
tarout env my-app set DATABASE_URL=postgres://...

# Set multiple variables
tarout env my-app set API_KEY=xxx SECRET=yyy

# Download to .env file
tarout env my-app pull

# Upload from .env file
tarout env my-app push
```

### Databases

| Command | Description |
|---------|-------------|
| `tarout db list` | List all databases |
| `tarout db create [name]` | Create a new database |
| `tarout db delete <db>` | Delete a database |
| `tarout db info <db>` | Show connection details |
| `tarout db connect <db>` | Open database shell |

```bash
# Create PostgreSQL database
tarout db create mydb --type postgres

# Create MySQL database
tarout db create mydb --type mysql

# Get connection string
tarout db info mydb

# Connect directly (opens psql/mysql client)
tarout db connect mydb
```

### Domains

| Command | Description |
|---------|-------------|
| `tarout domains list [app]` | List domains |
| `tarout domains add <app> <domain>` | Add custom domain |
| `tarout domains remove <domain>` | Remove domain |
| `tarout domains verify <domain>` | Check DNS configuration |

```bash
# Add custom domain
tarout domains add my-app api.example.com

# Verify DNS is configured correctly
tarout domains verify api.example.com
```

### Organizations & Environments

| Command | Description |
|---------|-------------|
| `tarout orgs list` | List organizations |
| `tarout orgs switch <org>` | Switch active organization |
| `tarout envs list` | List environments |
| `tarout envs switch <env>` | Switch environment (production/staging) |

```bash
# Switch organization
tarout orgs switch "Acme Corp"

# Switch to staging environment
tarout envs switch staging
```

## Global Flags

These flags work with all commands:

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON (machine-readable) |
| `--yes, -y` | Skip all confirmation prompts |
| `--quiet, -q` | Minimal output (errors only) |
| `--verbose, -v` | Extra debug information |
| `--no-color` | Disable colored output |

## AI & Automation Usage

The CLI is designed to be 100% AI-friendly and scriptable:

```bash
# Get JSON output for parsing
tarout apps list --json

# Non-interactive operations (no prompts)
tarout apps delete my-app --yes

# Quiet mode for scripts
tarout deploy my-app --quiet

# Pipe-friendly
APP_ID=$(tarout apps list --json | jq -r '.[0].id')
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 3 | Authentication error (not logged in) |
| 4 | Resource not found |
| 5 | Permission denied |

### JSON Output Format

All `--json` output follows a consistent structure:

```json
// Success
{ "success": true, "data": { ... } }

// Error
{ "success": false, "error": { "code": "NOT_FOUND", "message": "..." } }

// List operations
{ "success": true, "data": [...], "meta": { "total": 10 } }
```

## Configuration

Configuration is stored at `~/.tarout/config.json`:

```json
{
  "currentProfile": "default",
  "profiles": {
    "default": {
      "token": "cli_xxx...",
      "apiUrl": "https://app.tarout.sa",
      "organizationId": "...",
      "organizationName": "My Org",
      "environmentId": "...",
      "environmentName": "production",
      "userId": "...",
      "userEmail": "user@example.com"
    }
  }
}
```

## Requirements

- Node.js 18.0.0 or higher
- A Tarout account ([sign up](https://tarout.sa))

## Support

- Documentation: [tarout.sa/docs](https://tarout.sa/docs)
- Issues: [GitHub Issues](https://github.com/tarout/platform/issues)
- Discord: [Join our community](https://discord.gg/2tBnJ3jDJc)

## License

MIT - see [LICENSE](./LICENSE) for details.
