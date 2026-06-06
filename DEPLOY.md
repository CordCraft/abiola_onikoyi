# Deploying abiolaonikoyi.com

This site is a Next.js 16 app. The public portfolio is static; the private
`/dashboard` area is gated by a single-user login and stores project updates in
a Postgres database. Local development uses SQLite; production uses Neon Postgres.

## One-time setup

### 1. Create free accounts
- **Vercel** — https://vercel.com (hosting)
- **Neon** — https://neon.tech (Postgres database)
- *(optional)* **GitHub** — to store the code and enable auto-deploys

### 2. Create the production database (Neon)
1. In Neon, create a project. Copy the **connection string** (looks like
   `postgresql://USER:PASSWORD@HOST/dbname?sslmode=require`).

### 3. Switch Prisma to Postgres
In `prisma/schema.prisma`, change the datasource provider:
```prisma
datasource db {
  provider = "postgresql"   // was "sqlite"
  url      = env("DATABASE_URL")
}
```
Then push the schema to Neon:
```bash
DATABASE_URL="<your-neon-url>" npx prisma db push
```

### 4. Generate your admin credentials
Pick a username and a strong password, then generate the hash:
```bash
node -e "console.log(require('bcryptjs').hashSync('YOUR_PASSWORD', 12))"
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # SESSION_SECRET
```

### 5. Deploy to Vercel
Using the CLI:
```bash
npx vercel        # link/create the project
npx vercel --prod # deploy to production
```
Then in **Vercel → Project → Settings → Environment Variables**, add (paste the
hash with normal `$`, no escaping):
- `DATABASE_URL` = your Neon connection string
- `ADMIN_USERNAME` = your username
- `ADMIN_PASSWORD_HASH` = the bcrypt hash from step 4
- `SESSION_SECRET` = the random string from step 4

Redeploy after setting env vars.

### 6. Connect the domain
1. Vercel → Project → **Settings → Domains** → add `abiolaonikoyi.com` (and
   `www.abiolaonikoyi.com`).
2. Vercel shows the DNS records to set. At your domain registrar, add them
   (typically an `A` record for the apex and a `CNAME` for `www`).
3. Wait for DNS to propagate; Vercel auto-provisions HTTPS.

## Updating content
- **Public portfolio:** edit `src/content/profile.ts` and redeploy.
- **Private projects/updates:** log in at `/dashboard` and manage them there —
  no redeploy needed.
