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
- **🔔 Auto-Reminders** — Sends reminders to users who haven't submitted
- **⏭️ Skip/OOO Mode** — Users can skip standups with a reason
- **📝 Notes & Blockers** — Add additional context or blockers to your status
- **💬 Slash Commands** — `/daily` to trigger on-demand, `/daily status` to view
- **🔐 Admin Dashboard** — Web UI with JWT + TOTP authentication
- **📊 Team Dashboard** — Real-time view of who's submitted and who's pending
- **👥 User Management** — Enable/disable users, refresh mappings, per-user testing
- **🛡️ Security** — Slack request signature verification, rate limiting, input validation

## 🏗️ Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Cron Jobs     │────▶│  Express Server │────▶│    MongoDB      │
│ (Daily+Remind)  │     │   (API + UI)    │     │   (Storage)     │
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
│   ├── env.ts            # Environment validation
│   └── logger.ts         # Pino logger
├── db/
│   └── mongo.ts          # MongoDB connection
├── middleware/
│   ├── auth.ts           # JWT authentication
│   ├── slack-verify.ts   # Slack signature verification
│   └── rate-limit.ts     # Rate limiting
├── validation/
│   └── schemas.ts        # Zod validation schemas
├── models/               # Mongoose schemas
│   ├── pending-selection.model.ts
│   ├── daily-status.model.ts
│   ├── enabled-user.model.ts
│   └── settings.model.ts
├── services/
│   ├── linear.service.ts # Linear API client
│   ├── slack.service.ts  # Slack messaging
│   ├── user.service.ts   # User management
│   └── history.service.ts
├── scheduler/
│   └── daily-prompt.ts   # Cron job logic
└── routes/
    ├── slack.routes.ts   # Slack webhooks + slash commands
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

# Schedule (9 AM Mon-Fri)
CRON_SCHEDULE=0 9 * * 1-5

# Admin Auth
ADMIN_TOTP_SECRET=JBSWY3DPEHPK3PXP  # Generate with: npx otplib-cli generate
JWT_SECRET=your-super-secret-jwt-key  # Long random string
JWT_EXPIRES_IN=24h                     # Token expiration (default: 24h)

# Reminder (optional)
REMINDER_DELAY_HOURS=2                 # Hours after daily prompt (default: 2)

# Logging (optional)
LOG_LEVEL=info                         # debug, info, warn, error
```

### 3. Setup Slack App

Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps) with these OAuth scopes:

**Bot Token Scopes:**
- `chat:write` — Send messages
- `users:read` — List users
- `users:read.email` — Access emails for mapping
- `im:write` — Open DMs
- `commands` — Slash commands

**URLs to configure:**
- Interactivity URL: `https://your-domain.com/slack/interactions`
- Slash Commands:
  - `/daily` → `https://your-domain.com/slack/commands`
  - `/skip` → `https://your-domain.com/slack/commands`

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

The admin UI (`/admin`) provides three tabs:

### Dashboard Tab
- **Stats** — Total users, submitted count, pending count
- **Submitted Today** — Who submitted with ticket details
- **Pending** — Who hasn't submitted yet (with "Send Reminder" button)
- Auto-refreshes every 30 seconds

### Users Tab
| Action | Description |
|--------|-------------|
| **Add User** | Add by email (auto-resolves Linear/Slack IDs) |
| **Test** | Send prompt to individual user |
| **Enable/Disable** | Toggle user participation |
| **Refresh** | Re-sync Linear/Slack IDs |
| **Remove** | Delete user from system |

### Settings Tab
| Setting | Description |
|---------|-------------|
| **Schedule** | Cron expression + timezone |
| **Trigger Now** | Manually send prompts to all users |
| **Channel ID** | Slack channel for status posts |

## 💬 Slash Commands

| Command | Description |
|---------|-------------|
| `/daily` | Get your ticket selection prompt |
| `/daily status` | View your submitted status for today |
| `/skip [reason]` | Skip today's standup with optional reason |

## 📅 Cron Schedule Examples

| Schedule | Cron Expression |
|----------|-----------------|
| 9 AM Mon-Fri | `0 9 * * 1-5` |
| 9 AM Sun-Thu | `0 9 * * 0-4` |
| 10:30 AM Daily | `30 10 * * *` |
| 8 AM & 2 PM | `0 8,14 * * 1-5` |

## 🔧 API Endpoints

### Public
- `GET /` — Health check
- `GET /slack/health` — Slack route health

### Slack Webhooks
- `POST /slack/interactions` — Handle button clicks, modal submissions
- `POST /slack/commands` — Handle slash commands

### Admin API (requires JWT)
- `POST /admin/api/auth` — TOTP → JWT token
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
- `GET /admin/api/status/today` — Team dashboard data
- `GET /admin/api/status/:email/history` — User's history

## 🚢 Deployment

### Heroku

```bash
# Create app
heroku create your-app-name

# Set environment variables
heroku config:set LINEAR_API_KEY=xxx
heroku config:set SLACK_BOT_TOKEN=xxx
heroku config:set JWT_SECRET=your-secret-key
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
   - Submit, Add Notes, and Skip buttons

3. **User Selection** — User can:
   - Check tickets and submit
   - Add notes/blockers via modal
   - Skip with a reason

4. **Channel Post** — Bot posts the selection (with notes/blockers if any) to the team channel

5. **Reminder** — If user hasn't submitted X hours later, sends a reminder

6. **History** — Selections are stored for "yesterday's focus" in the next prompt

## 🔒 Security Features

- **Slack Signature Verification** — All Slack requests are verified
- **JWT Authentication** — Stateless admin sessions with configurable expiry
- **TOTP 2FA** — Time-based one-time passwords for admin login
- **Rate Limiting** — API and auth endpoints are rate-limited
- **Input Validation** — All inputs validated with Zod schemas
- **Graceful Shutdown** — Clean handling of SIGTERM/SIGINT

## 📄 License

MIT

---

Built with ☕ and TypeScript
