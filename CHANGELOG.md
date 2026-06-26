# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.14.0]

### Changed

- **Add-ons are no longer sold standalone — every tier upgrades the plan instead.**
  Previously only the free tier redirected resource gates to a plan upgrade while
  paid tiers could buy (or auto-buy) a matching add-on. Now all tiers behave the
  same: an org uses only the resource slots its plan already grants, and any
  `db.*` / `storage.*` / `domain.*` / `email_service.*` entitlement gate resolves
  by prompting a plan upgrade (`tarout billing upgrade`).
  - `tarout db create` / `tarout deploy --database` no longer auto-buy a managed
    db add-on when a paid org has no open slot — they surface the upgrade prompt
    (interactive) or the structured `NEEDS_UPGRADE` envelope (agent/JSON).
- **`tarout agent init`** no longer writes the "Denied by auto mode classifier" /
  buy-add-on-vs-upgrade paragraph into the generated `CLAUDE.md`; the CLI surfaces
  the (plan-upgrade-only) `NEEDS_UPGRADE` guidance at runtime instead.

## [0.1.0] - 2025-01-15

### Added

- **Authentication**
  - Browser-based login flow (`tarout login`)
  - Logout command (`tarout logout`)
  - Show current user/org/env (`tarout whoami`)

- **Application Management**
  - List applications (`tarout apps list`)
  - Create applications (`tarout apps create`)
  - Delete applications (`tarout apps delete`)
  - View application details (`tarout apps info`)
  - Open app in browser (`tarout apps open`)

- **Deployment**
  - Deploy applications (`tarout deploy`)
  - Check deployment status (`tarout deploy:status`)
  - Cancel deployments (`tarout deploy:cancel`)
  - List deployment history (`tarout deploy:list`)

- **Logs**
  - View application logs (`tarout logs`)
  - Real-time log streaming (`--follow`)
  - Filter by log level (`--level`)
  - Time-based filtering (`--since`)

- **Environment Variables**
  - List variables (`tarout env <app> list`)
  - Set variables (`tarout env <app> set`)
  - Unset variables (`tarout env <app> unset`)
  - Pull to .env file (`tarout env <app> pull`)
  - Push from .env file (`tarout env <app> push`)

- **Database Management**
  - List databases (`tarout db list`)
  - Create databases (`tarout db create`)
  - Delete databases (`tarout db delete`)
  - View connection info (`tarout db info`)
  - Connect to database shell (`tarout db connect`)
  - Support for PostgreSQL, MySQL, and Redis

- **Domain Management**
  - List domains (`tarout domains list`)
  - Add custom domains (`tarout domains add`)
  - Remove domains (`tarout domains remove`)
  - Verify DNS configuration (`tarout domains verify`)

- **Organization & Environment**
  - List organizations (`tarout orgs list`)
  - Switch organizations (`tarout orgs switch`)
  - List environments (`tarout envs list`)
  - Switch environments (`tarout envs switch`)

- **AI-Friendly Features**
  - JSON output mode (`--json`)
  - Non-interactive mode (`--yes`)
  - Quiet mode (`--quiet`)
  - Verbose mode (`--verbose`)
  - Consistent exit codes
  - Structured error messages with suggestions
