# RUIDEA — Security Remediation Notes

Companion to `SECURITY_ASSESSMENT.md`. Summarizes what the code changes deliver and the
**operational steps a human must still perform** (secrets, infra, legal) that cannot be
done in code.

## New environment variables (backend)

| Var | Purpose | Notes |
|---|---|---|
| `JWT_SECRET` | Signs session + email/reset/render tokens | **Must differ** from `SECURITY_KEY`. Required (the app throws without it). |
| `CORS_ORIGINS` | Comma-separated allowlist of frontend origins | e.g. `https://pasaporte.dea.ong`. No trailing slash. |
| `NODE_ENV` | `production` enables Secure + SameSite=None cookies | Must be `production` in prod for cross-site cookies to work. |
| `FRONTEND_URL` | Base URL used in verification / password-reset email links AND the passport QR code | e.g. `https://pasaporte.dea.ong` (prod) or `http://localhost:3000` (dev). Defaults to prod. |
| `LOG_LEVEL` | pino log level | defaults to `info`. |

`SECURITY_KEY` (the old shared API key) is **no longer used** by the backend and can be
retired once the frontend no longer sends it (already removed there).

Cross-site cookies require **HTTPS on both** the API and the frontend in production, and
the frontend must call the API with credentials (already configured via axios
`withCredentials`).

## Cross-domain auth model (how it now works)

1. Login/register/admin-login → server sets an **httpOnly** `token` cookie (the session
   JWT, signed with `JWT_SECRET`) and returns a **CSRF token** in the response body.
2. The SPA stores the CSRF token and sends it as `X-CSRF-Token` on every mutating
   request. The server compares it to the CSRF claim inside the (unforgeable) JWT.
3. `/usuario/me` and `/admin/me` re-issue the CSRF token so it survives reloads.

## Operational hand-off (NOT done in code — do these)

### 1. Rotate every secret (assume all compromised)
These shipped in the Docker image and/or the frontend git history:
- `DB_CONNECTION` — **rotate the Mongo Atlas `admin` password**, update the URI.
- `AZURE_STORAGE_CONNECTION_STRING` — **rotate the storage account key**.
- `SECURITY_KEY`, `SMTP_KEY`, `VERIFY_PASSWORD`, `USER_ADMIN`/`CLAVE_HASHEADA_ADMIN`.
- Set a brand-new `JWT_SECRET` (independent of all the above).
Inject all of these via the platform secret store (App Service settings / Key Vault),
**never** via `.env` baked into the image. `.env` is now in `.dockerignore`.

### 2. Purge `frontend/.env` from git history
`git rm --cached` was done (it is now untracked), but the live key remains in history:
```
git filter-repo --path .env --invert-paths   # or BFG
git push --force            # coordinate with the team; rewrites history
```
Then confirm `REACT_APP_SERVER_KEY` is gone from all refs. (It is already removed from
the working tree and no longer used by the app.)

### 3. Lock down Azure Blob Storage
- Set the `ruidea` container access level to **private** (no anonymous read). The backend
  now serves documents via short-lived SAS URLs (`functions/blob.js`), which require this.
- Audit/lock or delete the legacy `ruideaalmacenamiento` container referenced by the old
  migration scripts (now removed from the repo).
- Enable **Microsoft Defender for Storage** (malware scanning) on the account (§11/§3.1).

### 4. Per-verifier credentials (product decision)
The shared `VERIFY_PASSWORD` flow still works, but you can now issue scoped, revocable
keys per relying party:
```
node scripts/create-verifier.js "Aeropuerto de Barajas"
```
Relying parties send the key as `X-Verifier-Key`. Decide whether to migrate verifiers off
the shared password and then unset `VERIFY_PASSWORD`.

### 5. One-time data migrations
- **Passport counter**: the atomic counter seeds itself from the current max on first
  acceptance — no action needed, but you may pre-seed with
  `db.counters.insertOne({_id:'passport', seq:<currentMax>})`.
- **Existing uploaded docs**: old blobs were keyed by email; the new download path reads
  `archivoBlob` on the user record. Back-fill `archivoBlob` for existing users if you want
  their legacy documents downloadable through the new authenticated route.

### 6. Formal data-protection review
Consent is now persisted (`aceptoSolicitud` + `fechaConsentimiento`) and deletions remove
blobs, but a lawful-basis / retention / processor-agreement review (Azure, Office365)
should run in parallel (§8.2).

## Deploy ordering (to avoid an outage)
1. Deploy the **backend** with the new env vars set (rotated secrets, `JWT_SECRET`,
   `CORS_ORIGINS`, `NODE_ENV=production`, `FRONTEND_URL`).
2. Deploy the **frontend** (it no longer needs `REACT_APP_SERVER_KEY`).
Because auth moved from a shared header to session cookies, both sides must be on the new
version together; there is no mixed-mode compatibility.
