# CloudOps Rota — Setup Guide
**Free hosting on GitHub Pages + Google Drive storage**

---

## What You Get (100% Free)
| Component | Free Service | Cost |
|-----------|-------------|------|
| Hosting | GitHub Pages | £0 |
| Data storage | Google Drive (your existing account) | £0 |
| Authentication | Google OAuth 2.0 | £0 |
| Calendar export | .ics files (Outlook, iPhone, Google) | £0 |
| **Total** | | **£0/month** |

---

## Step 1 — Create a GitHub Account & Repo

1. Go to **https://github.com** → Sign up (free)
2. Click **New repository**
3. Name it: `cloudops-rota`
4. Set to **Public** (required for free GitHub Pages)
5. Click **Create repository**

---

## Step 2 — Set Up Google Cloud (for Drive + OAuth)

This takes ~10 minutes and is completely free.

### 2a. Create a Google Cloud Project
1. Go to **https://console.cloud.google.com**
2. Click **Select a project** → **New Project**
3. Name: `CloudOps Rota` → **Create**

### 2b. Enable the Google Drive API
1. In the left menu → **APIs & Services** → **Library**
2. Search for **Google Drive API** → Click it → **Enable**

### 2c. Create OAuth Credentials
1. **APIs & Services** → **Credentials**
2. Click **+ Create Credentials** → **OAuth 2.0 Client ID**
3. If prompted, configure the **OAuth consent screen** first:
   - User Type: **External**
   - App name: `CloudOps Rota`
   - Support email: your email
   - Add scope: `../auth/drive.file`
   - Add test users: add each team member's Google email
   - Save and continue
4. Back to **Create OAuth 2.0 Client ID**:
   - Application type: **Web application**
   - Name: `CloudOps Rota`
   - Authorised JavaScript origins:
     ```
     http://localhost:3000
     https://YOUR-GITHUB-USERNAME.github.io
     ```
   - Click **Create**
5. **Copy the Client ID** — it looks like: `123456789-abc...xyz.apps.googleusercontent.com`

---

## Step 3 — Configure the App

1. In the project folder, copy `.env.example` to `.env`:
   ```
   cp .env.example .env
   ```

2. Edit `.env` and paste your Client ID:
   ```
   REACT_APP_GOOGLE_CLIENT_ID=123456789-abc...xyz.apps.googleusercontent.com
   ```

3. Edit `package.json` — update the `homepage` field:
   ```json
   "homepage": "https://YOUR-GITHUB-USERNAME.github.io/cloudops-rota"
   ```

---

## Step 4 — Install & Build

You need **Node.js** (free from https://nodejs.org — LTS version).

```bash
# Navigate to the project folder
cd cloudops-rota

# Install dependencies (~2 minutes)
npm install

# Test it locally first
npm start
# Opens http://localhost:3000 in your browser
# Test login: MBA47 / manager123

# When ready, build for production
npm run build
```

---

## Step 5 — Deploy to GitHub Pages (Free Hosting)

```bash
# Install the GitHub Pages deploy tool
npm install --save-dev gh-pages

# Push your code to GitHub first
git init
git add .
git commit -m "Initial CloudOps Rota deployment"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/cloudops-rota.git
git push -u origin main

# Deploy to GitHub Pages
npm run deploy
```

Wait ~2 minutes, then visit:
**https://YOUR-GITHUB-USERNAME.github.io/cloudops-rota**

---

## Step 6 — Share with Your Team

Give each engineer their login credentials:

| Name | Username | Password | Role |
|------|----------|----------|------|
| Meetul Bhundia | MBA47 | manager123 | Manager |
| Mahir | MAH01 | eng123 | Engineer |
| Darshana | DAR02 | eng123 | Engineer |
| Marc | MAR03 | eng123 | Engineer |

**To change passwords:** Edit the `AUTH` object in `src/App.js`:
```js
const AUTH = { MBA47: 'your_new_pw', MAH01: 'eng_pw', ... };
```
Then run `npm run deploy` again.

---

## Step 7 — First Login & Drive Setup

1. Visit your GitHub Pages URL
2. Click **Connect Google Drive** (first time only — takes ~30 seconds)
3. Log in with your Google account
4. Grant permission to `drive.file` (the app only accesses files IT creates)
5. Then sign in with your CloudOps credentials (MBA47 / manager123)

**All data is now auto-saved to Google Drive** at `My Drive/CloudOps-Rota/`

---

## Adding New Engineers (Up to 6)

1. Log in as MBA47 (manager)
2. Go to **Settings** → **+ Add Engineer**
3. Enter their name → username is auto-generated (e.g. `SAJ04`)
4. Add their credentials to the `AUTH` object in `src/App.js`
5. Re-deploy: `npm run deploy`

---

## Calendar Export (Outlook, iPhone, Google)

- Go to **Who's On Call** or **My Shift**
- Click **Export .ics** button
- **Outlook:** File → Open & Export → Import/Export → Import iCalendar
- **iPhone:** Open the .ics file → Add to Calendar
- **Google Calendar:** Settings → Import → Upload .ics

---

## Re-deploying After Changes

Whenever you make changes:
```bash
git add .
git commit -m "Update: describe your change"
git push
npm run deploy
```

---

## Troubleshooting

**"Google Drive not connecting"**
→ Check your Client ID in `.env` is correct
→ Make sure `http://localhost:3000` AND your GitHub Pages URL are both in Authorised JavaScript Origins

**"Page not found on GitHub Pages"**
→ In your repo Settings → Pages → Source must be set to `gh-pages` branch

**"App shows blank page"**
→ Check the `homepage` in `package.json` matches your GitHub Pages URL exactly

---

## File Structure

```
cloudops-rota/
├── public/
│   ├── index.html
│   └── manifest.json
├── src/
│   ├── App.js              ← Main app (all pages & logic)
│   ├── App.css             ← All styles
│   ├── index.js            ← Entry point
│   ├── hooks/
│   │   └── useGoogleDrive.js  ← Google Drive API integration
│   └── utils/
│       └── defaults.js     ← Data defaults & rota generator
├── .env.example            ← Copy to .env with your credentials
├── .gitignore
└── package.json
```

---

## Data Stored in Google Drive

All data lives in `My Drive/CloudOps-Rota/` as JSON files:

| File | Contents |
|------|---------|
| `users.json` | Team members & roles |
| `rota.json` | Generated rota schedule |
| `holidays.json` | Holiday requests & approvals |
| `incidents.json` | Incident log |
| `timesheets.json` | Hours per engineer |
| `upgrades.json` | Upgrade day events |
| `wiki.json` | Knowledge base articles |
| `glossary.json` | Term definitions |
| `contacts.json` | Team contacts |
| `payconfig.json` | Pay rates |

---

*Built for Cloud Run Operations Team · Meetul Bhundia (MBA47) · April 2026*
