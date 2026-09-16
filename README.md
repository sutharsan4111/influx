# ITSM Portal

An internal IT Service Management portal that unifies Zoho Desk ticketing, cloud infrastructure operations, and SSL/certificate monitoring behind a single Angular + Express application, backed by PostgreSQL.

## Overview

The app is a single Node/Express server (`server.js`) that serves a REST API under `/api/*` and hosts the built Angular single-page app (`ticket-portal`). Authentication is handled via Microsoft Entra ID (Azure AD) through MSAL, combined with server-issued JWT access/refresh tokens.

## Core Features

- **Ticketing** — creates, lists, assigns, and tracks tickets synced with Zoho Desk (`/api/tickets`, `/api/zoho`), including a recycle bin for soft-deleted tickets and a project workspace view.
- **Dashboard** — at-a-glance ticket and operations metrics.
- **CloudOps** — cloud project and asset tracking (`/api/cloudops`).
- **Azure Backup monitoring** — collects and reports Azure Recovery Services backup status via a PowerShell-based collector (`azure-backup-collector.js`, requires PowerShell Core + Az modules).
- **Infrastructure / Certificates** — SSL certificate tracking and automation, plus iHub certificate management (`/api/ssl`, `/api/automation-ssl`, `/api/ihub`, `/api/ihub-certificate`).
- **Admin** — user and role management, feature toggles (`/api/admin`, `/api/users`).
- **Monitoring & Alerting** — Prometheus/Alertmanager webhook ingestion with Microsoft Teams notifications (`/api/monitoring`, `/api/webhook`).
- **Feedback** — in-app feedback submission routed to email.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Angular 17 (standalone components) |
| Backend | Node.js + Express |
| Database | PostgreSQL (`pg`), with SQL migrations in [migrations/](migrations/) |
| Auth | Azure AD / MSAL (`@azure/msal-browser`, `@azure/msal-angular`) + JWT (`jsonwebtoken`, `bcrypt`) |
| Integrations | Zoho Desk API, Azure (`@azure/identity`), Microsoft Teams webhooks, Prometheus/Alertmanager, Nodemailer |
| Deployment | Docker / Docker Compose |

## Project Structure

```
src/app/
  admin/              Admin, SSL, iHub, infrastructure, user roles
  azure-backup/        Azure backup monitoring UI + service
  cloudops/             CloudOps projects and assets
  create-ticket/        New ticket form
  dashboard/            Dashboard views
  login/                Login (MSAL + credential)
  project-workspace/    Project workspace view
  recycle-bin/          Soft-deleted tickets
  tickets/              Ticket list/detail
  services/, shared/     Shared services, guards, interceptors
server.js              Express API + static server (all /api/* routes)
db.js                  PostgreSQL connection pool
azure-backup-collector.js  Azure backup data collection (PowerShell)
migrations/            SQL schema migrations
```

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL database
- (Optional, for Azure Backup collection) PowerShell Core with `Az.Accounts`, `Az.RecoveryServices`, `Az.Resources` modules

### Setup

```bash
npm install
```

Create a `.env` file in the project root with the required variables (see [Environment Variables](#environment-variables) below).

Run database migrations against your PostgreSQL instance using the SQL files in [migrations/](migrations/), in order.

### Development

```bash
npm run dev     # builds the Angular app, then starts the Express server on PORT (default 3000)
```

Or run the pieces separately:

```bash
npm run watch   # Angular build in watch mode
npm start       # start the Express server (serves the last built dist/)
```

### Production Build

```bash
npm run build:prod
npm start
```

### Docker

```bash
docker compose up --build
```

Serves the app on `http://localhost:3000`.

## Environment Variables

Configured via `.env` (not committed):

| Variable | Purpose |
|---|---|
| `PORT` | Server port |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | JWT signing secrets |
| `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `CLIENT_ID`, `CLIENT_SECRET`, `TENANT_ID` | Azure AD / MSAL and Azure resource access |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_OAUTH_TOKEN`, `ZOHO_ORG_ID`, `ZOHO_BASE_URL`, `ZOHO_DEPARTMENT_ID`, `ZOHO_ASSIGNEE_ID`, `ZOHO_TICKET_WEBHOOK_SECRET` | Zoho Desk ticket sync |
| `MONITORING_API_KEY`, `ALERTMANAGER_WEBHOOK_SECRET`, `ALERTMANAGER_FALLBACK_EMAIL`, `AUTOMATION_PROMETHEUS_URL` | Monitoring/alerting integration |
| `CLOUDOPS_TEAMS_WEBHOOK_URL` | Microsoft Teams notifications |
| `FEEDBACK_FROM_EMAIL`, `FEEDBACK_TARGET_EMAIL` | Feedback email routing |
| `ADMIN_EMAIL_ALLOWLIST` | Emails allowed admin access |
| `PORTAL_BASE_URL` | Public URL of the portal (used in generated links/emails) |
| `ENABLE_ALERT_JOBS`, `ENABLE_ZOHO_OUTBOUND` | Feature flags for background jobs and outbound Zoho sync |

## Scripts

| Command | Description |
|---|---|
| `npm start` | Start the Express server |
| `npm run dev` | Build Angular app then start the server |
| `npm run build` | Angular development build |
| `npm run build:prod` | Angular production build |
| `npm run watch` | Angular build in watch mode |
| `npm test` | Run Angular unit tests |
