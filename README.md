# 📋 Daily Status Bot

A Slack bot that integrates with Linear to collect and share daily team status updates.

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=flat&logo=mongodb&logoColor=white)
![Slack](https://img.shields.io/badge/Slack-4A154B?style=flat&logo=slack&logoColor=white)
![Linear](https://img.shields.io/badge/Linear-5E6AD2?style=flat&logo=linear&logoColor=white)

## ✨ Features

- **🎯 Daily Ticket Selection** — Sends interactive Slack DMs with checkboxes for selecting today's focus
- **📅 Yesterday's Focus** — Shows what you worked on yesterday for context
- **🔄 Linear Cycle Aware** — Only shows tickets from your active Linear cycle (sprint)
- **📢 Team Channel Updates** — Posts daily status to a designated Slack channel
- **⏰ Smart Scheduling** — Configurable cron schedule with timezone support
- **🔐 Admin Dashboard** — Web UI with TOTP authentication for managing users and settings
- **👥 User Management** — Enable/disable users, refresh mappings, per-user testing

## 🏗️ Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Cron Job      │────▶│  Express Server │────▶│    MongoDB      │
│  (Scheduler)    │     │   (API + UI)    │     │   (Storage)     │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
           ┌─────────────────┐       ┌─────────────────┐
           │   Linear API    │       │   Slack API     │
           │  (Tickets)      │       │  (Messaging)    │
           └─────────────────┘       └─────────────────┘
```

## 📁 Project Structure

```
src/
├── index.ts              # Entry point
├── config/
│   └── env.ts            # Environment validation
├── db/
│   └── mongo.ts          # MongoDB connection
├── models/               # Mongoose schemas
│   ├── pending-selection.model.ts
│   ├── user-mapping.model.ts
│   ├── daily-status.model.ts
│   ├── enabled-user.model.ts
│   └── settings.model.ts
├── services/
│   ├── linear.service.ts # Linear API client
│   ├── slack.service.ts  # Slack messaging
│   ├── user.service.ts   # User mapping
│   └── history.service.ts
├── scheduler/
│   └── daily-prompt.ts   # Cron job logic
└── routes/
    ├── slack.routes.ts   # Slack webhooks
    └── admin.routes.ts   # Admin API + UI
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- MongoDB database
- Linear workspace with API access
- Slack workspace with bot permissions

### 1. Clone & Install

```bash
git clone https://github.com/IsmailKharoub/daily-status-bot.git
cd daily-status-bot
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Linear
LINEAR_API_KEY=lin_api_xxxxx

# Slack
SLACK_BOT_TOKEN=xoxb-xxxxx
SLACK_SIGNING_SECRET=xxxxx
SLACK_DAILY_CHANNEL_ID=C0XXXXXXXXX

# MongoDB
MONGODB_URI=mongodb+srv://...

# Server
PORT=3000

# Schedule (9 AM Sun-Thu)
CRON_SCHEDULE=0 9 * * 0-4

# Admin (generate with: npx otplib-cli generate)
ADMIN_TOTP_SECRET=JBSWY3DPEHPK3PXP
```

### 3. Setup Slack App

Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps) with these OAuth scopes:

- `chat:write` — Send messages
- `users:read` — List users
- `users:read.email` — Access emails for mapping
- `im:write` — Open DMs

Set the Interactivity URL to: `https://your-domain.com/slack/interactions`

### 4. Run

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

### 5. Access Admin UI

1. Visit `https://your-domain.com/admin`
2. Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.)
3. Enter the 6-digit code to login

## 🎮 Admin Dashboard

The admin UI (`/admin`) provides:

| Feature | Description |
|---------|-------------|
| **Schedule** | View/edit cron schedule and timezone |
| **Trigger Now** | Manually trigger prompts for all users |
| **Settings** | Update Slack channel ID |
| **User Management** | Add, remove, enable/disable users |
| **Per-User Test** | Send prompt to individual user |
| **Refresh** | Re-sync Linear/Slack IDs |

## 📅 Cron Schedule Examples

| Schedule | Cron Expression |
|----------|-----------------|
| 9 AM Mon-Fri | `0 9 * * 1-5` |
| 9 AM Sun-Thu | `0 9 * * 0-4` |
| 10:30 AM Daily | `30 10 * * *` |
| 8 AM & 2 PM | `0 8,14 * * 1-5` |

## 🔧 API Endpoints

### Slack Webhooks
- `POST /slack/interactions` — Handle button clicks

### Admin API (requires auth)
- `GET /admin/api/users` — List users
- `POST /admin/api/users` — Add user
- `DELETE /admin/api/users/:email` — Remove user
- `POST /admin/api/users/:email/toggle` — Enable/disable
- `POST /admin/api/users/:email/refresh` — Refresh IDs
- `GET /admin/api/schedule` — Get schedule
- `POST /admin/api/schedule` — Update schedule
- `POST /admin/api/trigger` — Trigger all users
- `POST /admin/api/trigger/:email` — Trigger specific user
- `GET /admin/api/settings` — Get settings
- `POST /admin/api/settings` — Update settings

## 🚢 Deployment

### Heroku

```bash
# Create app
heroku create your-app-name

# Set environment variables
heroku config:set LINEAR_API_KEY=xxx
heroku config:set SLACK_BOT_TOKEN=xxx
# ... set all other env vars

# Deploy
git push heroku main
```

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
COPY public ./public
EXPOSE 3000
CMD ["npm", "start"]
```

## 📝 How It Works

1. **Daily Prompt** — At scheduled time, bot fetches each enabled user's incomplete tickets from their active Linear cycle

2. **Slack DM** — Sends an interactive message showing:
   - Yesterday's focus (if any)
   - Checkbox list of today's tickets

3. **User Selection** — User checks the tickets they'll work on and clicks Submit

4. **Channel Post** — Bot posts the selection to the team channel

5. **History** — Selections are stored for "yesterday's focus" in the next prompt

## 📄 License

MIT

---

Built with ☕ and TypeScript

