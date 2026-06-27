# Deploying abiolaonikoyi.com (Netlify)

This site is a Next.js 16 app. The public portfolio is static; the private
`/dashboard` area is gated by a single-user login and stores project updates in
a Postgres database. Local development uses SQLite; production uses Neon Postgres.

Hosting: **Netlify** (free tier). The `netlify.toml` in this repo configures the
Next.js runtime plugin and Node version — no manual build settings needed.

## One-time setup

### 1. Create free accounts
- **GitHub** — https://github.com (stores the code; Netlify deploys from it)
- **Netlify** — https://netlify.com (hosting)
- **Neon** — https://neon.tech (Postgres database)

### 2. Push the code to a private GitHub repo
```bash
gh repo create abiolaonikoyi-site --private --source=. --push
# or create the repo in the GitHub UI and: git remote add origin … && git push -u origin main
```

### 3. Create the production database (Neon)
In Neon, create a project and copy the **connection string**
(`postgresql://USER:PASSWORD@HOST/dbname?sslmode=require`).

### 4. Switch Prisma to Postgres
In `prisma/schema.prisma`, change the datasource provider:
```prisma
datasource db {
  provider = "postgresql"   // was "sqlite"
  url      = env("DATABASE_URL")
}
```
Then push the schema to Neon (one time, and after any schema change):
```bash
DATABASE_URL="<your-neon-url>" npx prisma db push
```

### 5. Generate your admin credentials
Pick a username and a strong password, then generate the values:
```bash
node -e "console.log(require('bcryptjs').hashSync('YOUR_PASSWORD', 12))"          # ADMIN_PASSWORD_HASH
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"       # SESSION_SECRET
```

### 6. Create the Netlify site
1. Netlify → **Add new site → Import an existing project** → pick the GitHub repo.
2. Netlify auto-detects Next.js (via `netlify.toml`). Leave build settings as-is.
3. Before the first deploy, add **Environment variables**
   (Site configuration → Environment variables). Paste the hash with normal `$`
   (no escaping — escaping is only needed in a local `.env`):
   - `DATABASE_URL` = your Neon connection string
   - `ADMIN_USERNAME` = your username
   - `ADMIN_PASSWORD_HASH` = the bcrypt hash from step 5
   - `SESSION_SECRET` = the random string from step 5
4. Deploy. Future `git push`es auto-deploy.

### 7. Connect the domain
1. Netlify → **Domain management → Add a domain** → `abiolaonikoyi.com`.
2. Either delegate DNS to Netlify (point your registrar's nameservers to
   Netlify DNS), or add the records Netlify shows at your current registrar
   (an `A`/`ALIAS` for the apex + a `CNAME` for `www`).
3. Netlify auto-provisions HTTPS once DNS resolves.

## Notes
- **Security holds even if the proxy doesn't run:** every `/dashboard` page and
  admin action independently calls `verifySession()`, so the private area is
  protected at the data layer regardless of edge/middleware behavior.
- **Prisma client** is generated automatically during the build
  (`prisma generate` runs via the `build` and `postinstall` scripts).

## Updating content
- **Public portfolio:** edit `src/content/profile.ts`, commit, and push (Netlify
  auto-deploys).
- **Private projects/updates:** log in at `/dashboard` and manage them there —
  no redeploy needed.
