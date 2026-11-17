# Shaadi HQ

Shaadi HQ is a family wedding planning app. The Next.js website talks to a Go API, which stores wedding workspaces and their records in MongoDB. Google sign-in controls access; each wedding has its own data and admin team.

## Features

### Separate wedding workspaces

- The workspace picker at `/` lists the weddings your Google account can access.
- `/sharma-wedding` is the Sharma family workspace. `/upadhyay-wedding` is initialized for the bride's family. A signed-in admin can create more workspaces.
- Each wedding has its own route, records, budget, guest groups, room assignments, drivers, schedule, notifications, family access and admins.
- Main admins can edit a wedding's display name and heading. The route slug stays fixed after creation.
- Main admins can transfer the main admin role to another admin. Add the person as an admin first.
- Existing MongoDB records without a `weddingId` are assigned to `sharma-wedding` during API startup. The records stay in the database and are not copied to the Upadhyay workspace.

### Sign-in and access

- Sign in with a verified Google account. The browser saves the Google ID token in local storage so refreshing the page does not return to sign-in until the token expires or the user signs out.
- Admins can grant or revoke family access and admin access for a wedding. Access lists are wedding-specific.
- Family members can use planning features. Only admins can view or change budget records.
- The main admin is protected from removal until the role is transferred. At least one admin must remain.

### Overview and tasks

- Overview shows open tasks, the next deadline, upcoming events, and the tracked budget (admins only).
- Create tasks with an area, due date, description, assigned-by name, and an assignee selected from people who have signed in to the workspace.
- Anyone with workspace access can update task status and shared notes. Tasks can be searched by title, area, owner, assignee, creator, or notes, and filtered by status.
- Edit or delete tasks. Due tasks appear in the overview and Notifications page.

### Budget

- Admin-only budget items include an event, owner/vendor, amount, and the Google account that recorded the spend.
- Add sub-budget spend details under an overall expense. The tracked total sums top-level expenses only; sub-budget amounts are displayed as a breakdown and are excluded from that total.
- Search budget item names, vendors, spend details, and creator names. Edit and delete records; deleting a top-level item also deletes its sub-budget details.

### Guests, stays, and transport

- Organize guest groups and hotel/room assignments with contacts, notes, and essentials.
- Mark a room assignment checked in or undo check-in. The record shows who checked the guest in and when.
- Track drivers and vehicles, with availability states such as Free, Going to pickup, Carrying guests, and Returning.
- Drivers can optionally share phone location from the Transport page. The browser sends updates while the page is open and location sharing is enabled; it is not background tracking.

### Schedule and guest page

- Add and edit wedding events with category, start/end time, venue, and notes.
- Preview the public guest schedule from a workspace. It shows that wedding's events and does not require guest sign-in.
- The API seeds the Sharma schedule when those event records are absent. Other workspaces start with their own empty schedule.

### Notifications and appearance

- Create shared updates such as cloth pickup or choreographer arrival. Updates appear in the wedding's Notifications feed.
- Due tasks appear as reminders. The open app refreshes the feed and can show browser alerts after permission is granted. Browser alerts require the app to be open; they are not push notifications.
- Dark mode and the sign-in token are saved in browser local storage.

### Operations and diagnostics

- The API logs MongoDB connection success at startup and logs each API method, path, status code, and duration. Query strings are omitted from request logs.
- `GET /health` returns the API health status.
- Backend and frontend unit tests are included.

## Project layout

```text
ShaadiHQ/
├── backend/
│   ├── cmd/
│   │   ├── build.cmd       # Rebuilds the Windows API executable
│   │   └── shaadi_hq.exe   # Built Windows API binary
│   ├── main.go             # Go API and MongoDB integration
│   ├── main_test.go        # Go unit tests
│   ├── go.mod
│   └── .env                # Local backend configuration (create this)
├── frontend/
│   ├── app/                # Next.js pages, styles, helpers, and tests
│   ├── package.json
│   └── .env.local          # Local frontend configuration (create this)
└── README.md
```

## Requirements

- Windows, macOS, or Linux.
- Go 1.27.4 or newer (the backend module targets Go 1.27.4).
- Node.js and npm (Node 20 or newer recommended for this Next.js app).
- A MongoDB deployment and database user with read/write permissions.
- A Google OAuth 2.0 Client ID configured for the website's JavaScript origins.

## Configure Google sign-in

Create or select a Google OAuth 2.0 Web application client. Add the local website origin under **Authorized JavaScript origins**, normally `http://localhost:3000`. If you open the site from another device, add the exact LAN origin too, such as `http://192.168.1.40:3000`. Use the same client ID in both environment files below.

For a deployed site, add its exact HTTPS origin to the OAuth client and set the deployed frontend URL as the backend `CORS_ORIGIN`.

## Run locally

### 1. Configure the Go API

In PowerShell from the project root:

```powershell
Copy-Item backend/.env.example backend/.env
notepad backend/.env
```

Set `MONGODB_URI`, `GOOGLE_CLIENT_ID`, and at least one `ADMIN_EMAILS` address. See [backend/.env.example](backend/.env.example) for all available values. `FAMILY_EMAILS` is optional; admins can add family accounts from the Admin access page.

Start the API from the backend directory so it reads `backend/.env`:

```powershell
Set-Location backend
go run .
```

The API listens at `http://localhost:8080` by default. It pings MongoDB and initializes the default wedding workspaces before accepting requests.

### 2. Configure and run the website

In a second PowerShell window from the project root:

```powershell
Copy-Item frontend/.env.example frontend/.env.local
notepad frontend/.env.local
Set-Location frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to the same value as the backend's `GOOGLE_CLIENT_ID`. Set `NEXT_PUBLIC_API_URL` in `frontend/.env.local` to the Go API base URL (for example, `http://localhost:8080`). The frontend strips trailing slashes from this value. Restart `npm run dev` after changing it.

## Build and run the Windows backend executable

From the project root, run the build script:

```powershell
.\backend\cmd\build.cmd
```

The script can also be run directly from `backend/cmd`. It builds the Go module and writes `shaadi_hq.exe` beside the script. Go must be installed and available on `PATH`.

The executable looks for `.env` in its current directory, then beside the executable, then one directory above the executable. So it works both from `backend` and from `backend/cmd`:

```powershell
.\cmd\shaadi_hq.exe
```

## Deploy the Go backend to Render

Render runs the Go service on Linux, so configure the web service with **Root Directory** `backend` and use Go commands directly instead of the Windows-only `cmd/build.cmd` script:

```text
Build Command: go build -buildvcs=false -o ./cmd/shaadi_hq .
Start Command: ./cmd/shaadi_hq
```

The binary is intentionally named without `.exe` because Render's Go runtime is Linux. In Render's Environment settings, provide `MONGODB_URI`, `GOOGLE_CLIENT_ID`, and `ADMIN_EMAILS` (for the initial admin bootstrap). Set `MONGODB_DATABASE` if needed. The API reads Render's `PORT` environment variable automatically; set `CORS_ORIGIN` to the deployed frontend origin.

The Go executable runs only the API. The Next.js frontend still needs to be started separately with `npm run dev`, or built and served with `npm run build` and `npm start`.

### Production configuration

Production does not need an `.env` file. The backend reads configuration from the process environment; `.env` is only a local convenience. Configure `MONGODB_URI` and `GOOGLE_CLIENT_ID` in your backend hosting provider's environment/secrets settings. Also set `ADMIN_EMAILS` for the initial admin bootstrap, and set `MONGODB_DATABASE`, `CORS_ORIGIN`, and `PORT` when your deployment needs values other than their defaults. Set `NEXT_PUBLIC_API_URL` in the frontend hosting environment to the deployed Go API base URL and set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to the Google Web Client ID. Next.js embeds `NEXT_PUBLIC_*` values at build time, so configure them before building/rebuilding the frontend. Do not bake database credentials or OAuth secrets into the executable or container image.

## Environment variables

| Variable | Used by | Required | Purpose |
| --- | --- | --- | --- |
| `MONGODB_URI` | Backend | Yes | MongoDB connection string. Keep credentials private. |
| `MONGODB_DATABASE` | Backend | No | Database name; defaults to `shaadi_hq`. |
| `GOOGLE_CLIENT_ID` | Backend | Yes | Validates Google ID tokens. |
| `ADMIN_EMAILS` | Backend | First setup | Comma-separated initial Sharma admins; also bootstraps the initial Upadhyay main admin. |
| `FAMILY_EMAILS` | Backend | No | Comma-separated initial Sharma family accounts. |
| `CORS_ORIGIN` | Backend | No | Allowed frontend origin; defaults to `http://localhost:3000`. |
| `PORT` | Backend | No | API port; defaults to `8080`. |
| `NEXT_PUBLIC_API_URL` | Frontend | Yes in production | Go API base URL; local development defaults to `http://localhost:8080`. Set it before the Next.js build. |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Frontend | Yes | Client ID used by the Google sign-in button. |

MongoDB connection strings, OAuth secrets, and `.env` files must not be committed. The checked-in `.env.example` files contain placeholders only.

## API overview

All authenticated API requests use `Authorization: Bearer <Google ID token>`. Requests to a wedding route also include `X-Wedding-Slug`; the API checks that the signed-in account has access to that wedding before reading or changing its records.

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /health` | Public | API health status. |
| `GET /api/public/events` | Public | Guest schedule for the selected wedding; uses `X-Wedding-Slug` when provided. |
| `GET /api/weddings` | Signed in | List wedding workspaces the account can access. |
| `POST /api/weddings` | Signed in | Create a separate wedding workspace and set its initial main admin. |
| `GET /api/me` | Workspace member | Current account, role, and wedding settings. |
| `/api/tasks` | Workspace member | List, create, update, and delete tasks. |
| `/api/event`, `/api/guests`, `/api/stays`, `/api/transport`, `/api/notifications` | Workspace member | Wedding events, guest groups, stays, drivers, and family updates. |
| `/api/budget` | Workspace admin | List, create, update, and delete top-level budget items and sub-budget details. |
| `/api/admins`, `/api/family-members` | Workspace admin | Manage wedding-specific access lists. |
| `PATCH /api/weddings/{slug}` | Main admin | Change the wedding display name and heading. |
| `PATCH /api/weddings/{slug}/main-admin` | Main admin | Transfer the main admin role to an existing or newly added admin. |

## Tests and checks

Run these from their respective folders:

```powershell
# Backend unit tests
Set-Location backend
go test ./...

# Frontend unit tests and TypeScript check
Set-Location ../frontend
npm test
npm run typecheck

# Production frontend build
npm run build
```

Add a focused unit test alongside each new backend or frontend behavior.




