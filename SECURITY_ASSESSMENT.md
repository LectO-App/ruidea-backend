# RUIDEA — Technical & Security Assessment

**Date:** 2026-06-12
**Scope:** `ruidea-backend` (Express/Mongo API) and `ruidea-frontend` (CRA React app)
**Author:** Engineering review

> **Context that sets the severity bar.** RUIDEA is a registration/credentialing system that issues
> a personal "passport" record. It stores **sensitive personal data**, plus full identity PII (name,
> date of birth, document number, country, phone, email) and **uploaded source documents** (identity
> documents and supporting attachments). The records are shared with third-party relying parties for
> verification. For data of this class, several of the findings below are not "tech debt" — they are
> reportable personal-data breaches waiting to happen, with regulatory and contractual exposure
> attached.

This document is an inventory of problems found by reading the code. It does **not** make any code
changes. Each finding has a severity, a location, an explanation, and a recommendation. A
prioritized remediation roadmap is at the end.

Severity legend: 🔴 Critical (exploitable now, high impact) · 🟠 High · 🟡 Medium · ⚪ Low / hygiene

---

## 1. Authentication & Authorization

### 1.1 🔴 The only API "auth" is a static shared key that is published to the public
- **Where:** `middlewares/request-auth.js`; `frontend/src/axios.js:11`
- The middleware authorizes any request whose `authkey` header equals `process.env.SECURITY_KEY`.
  That is the entire access-control model — there is no per-user identity on the server.
- The same key is injected into the browser bundle as `REACT_APP_SERVER_KEY`. Anything prefixed
  `REACT_APP_` is compiled into the public JavaScript. **The master key is therefore readable by
  anyone who opens the site in a browser.**
- Consequence: every "protected" route is effectively public to anyone who reads the bundle.

### 1.2 🔴 The API key is *also* the JWT signing secret → forge any password reset / email confirm
- **Where:** `functions/sendEmail.js` (signs with `SECURITY_KEY`), `routes/usuario.js:136` (`/change-password`), `routes/emailVerification.js:11` (`/confirm/:token`)
- Password-reset and email-verification tokens are signed with the same `SECURITY_KEY` that is
  public (see 1.1). An attacker can mint a valid reset token for **any** user `_id` and call
  `/change-password` to set a new password. This is **silent, full account takeover of every user
  in the registry**, including admins-as-users.
- Recommendation: separate secrets per purpose; never ship any signing secret to the client; move
  to real server-issued sessions/tokens bound to an authenticated principal.

### 1.3 🔴 Admin authentication is the same shared key + a client-set cookie
- **Where:** `routes/admin.js:14` (`/admin/login`), `frontend/src/components/admin/adminAuth.js`
- `/admin/login` compares against `USER_ADMIN` / `CLAVE_HASHEADA_ADMIN`, but every admin data route
  (`/respuesta`, `/solicitudes`, `/modificarSolicitud`, `/excel`, …) is gated **only** by the
  public `authkey`. The frontend "admin" gate is a cookie `admin=true` that anyone can set in
  devtools. There is no server-side admin authorization at all.
- Consequence: anyone can list all applications, accept/reject them, edit records, and export the
  full user spreadsheet.

### 1.4 🔴 Client-side "auth" is decorative
- **Where:** `frontend/src/auth.js`, `frontend/src/protected.route.js`
- `login()` sets `authenticated = true` unconditionally; `isAuthenticated()` only reads a
  client-set cookie `logged-in`. A user "logs in" by virtue of the login request not throwing; the
  returned record is trusted. Anyone can set the cookie and reach `/dashboard`.
- The real data is fetched by `id` from a cookie (see 1.5), so the cosmetic gate doesn't even
  matter for data access.

### 1.5 🔴 No object-level authorization — IDOR everywhere
- **Where:** `routes/usuario.js:36` (`/estado/:id`), `routes/admin.js:151` (`/solicitudes/:id`), `frontend/src/components/Form.js:26`, `frontend/src/components/Dashboard.js:36`
- The dashboard and the edit form simply read whatever `id` is in the `id` cookie and fetch the
  full record. Nothing checks that the caller owns that record. Change the cookie / the URL param
  to any other `_id` (or enumerate ObjectIds) and you read or edit anyone's application.

### 1.6 🔴 The public passport-verification endpoint returns the entire user record
- **Where:** `routes/usuario.js:11` (`/verificar/:numeroDocumento/:numeroPasaporte`), rendered by `frontend/src/components/Verificar.js`
- The "share my passport" link (`/verificar/{documento}/{pasaporte}`) is intended to be public, but
  the backend responds with `usuario: usuarioSolicitado` — the **whole Mongo document**, including
  the bcrypt password hash, email, phone, and all PII — when the frontend only needs name, country,
  document number, category details, passport number.
- Passport numbers are assigned sequentially starting at 1001 (`routes/admin.js:56`), so the space
  is trivially enumerable; combined with document numbers this exposes the registry. The full set of
  record fields, including the sensitive ones, is published to anyone with the link.

### 1.7 🔴 Routes with no auth middleware at all
- `DELETE /usuario/:id` (`routes/usuario.js:155`) — **delete any user, unauthenticated.**
- `POST /inscripcion/subir-archivos/:email` (`routes/inscripcion.js:46`) — upload files into any
  email's folder, unauthenticated (see §3).
- `GET /inscripcion/link-archivos/:id` (`routes/inscripcion.js:142`) — get a public download URL for
  any user's documents, unauthenticated (see §3).
- `POST /usuario/forgot-password`, `/change-password`, `/emailVerification/*` — intentionally
  unauthenticated but unprotected by rate limiting (see §4).

### 1.8 🟠 Shared "verify password" exposes a passport→document lookup service
- **Where:** `routes/usuario.js:20` (`/verificarCheckPassword`)
- A single global `VERIFY_PASSWORD` (same for every relying party) gates a lookup that returns a
  user's `numeroDocumento` from their `numeroPasaporte`. One leaked string turns the system into a
  bulk passport-number → document-number resolver. Should be per-verifier credentials, scoped, logged,
  and rate-limited.

---

## 2. Sensitive Data Exposure

### 2.1 🔴 The master key is committed to the frontend git repository
- **Where:** `frontend/.env` is tracked in git and present across many historical commits
  (`d9f9bd9`, `9359233`, `880c5eb`, …), despite `.env` being listed in `.gitignore` (it was added
  to the ignore list after it had already been committed).
- `REACT_APP_SERVER_KEY` (= `SECURITY_KEY` = JWT secret, see §1) lives in the repo history forever.
  Rotating the key is necessary but not sufficient — history must be scrubbed and the key rotated
  everywhere it's used (API, JWT signing).

### 2.2 🔴 Password hashes returned to clients
- `GET /usuario/login` returns `usuario` with the hash (`routes/usuario.js:56`).
- `GET /usuario/estado/:id`, `GET /inscripcion/` (all users), `POST /admin/solicitudes/:id`, and
  `/verificar/...` all return full documents including `password`.
- `POST /usuario/change-password` returns the **old** hash explicitly:
  `res.send({ newUser, oldPass })` (`routes/usuario.js:149`).
- Recommendation: a serialization layer that strips `password` and other internal fields from every
  response; never select the hash unless doing a comparison.

### 2.3 🔴 Identity PII passed through a third-party URL query string
- **Where:** `routes/usuario.js:86` (`/descargar/:type/:id`)
- The PDF/JPG passport is generated by Puppeteer navigating to
  `https://ruidea-template.netlify.app/?apellidos=...&nombre=...&fechaNacimiento=...&numeroDocumento=...&numeroPasaporte=...`.
  Full identity is placed in a URL to an **external host**, where it lands in Netlify access logs,
  any proxy in between, and server logs. Render the template from a first-party, authenticated
  source and pass data via POST body or a short-lived signed token, not query params.

### 2.4 🟡 Excel export dumps the full database including all PII
- **Where:** `routes/admin.js:160` (`/excel`)
- Exports every user (name, document, DOB, email, phone, country, status, reviewer's note) to an
  `.xlsx`. Gated only by the public key. Needs real admin auth, access logging, and ideally
  justification/scoping.

---

## 3. Uploaded Documents (identity documents + supporting attachments)

This is the most sensitive data in the system and it is the least protected.

### 3.1 🔴 Upload endpoint is unauthenticated and unvalidated
- **Where:** `routes/inscripcion.js:46` (`/subir-archivos/:email`)
- No auth. No file-type allowlist on the server (the PDF-only check exists **only** in the browser,
  `Paso4.js`, and is trivially bypassed). No size limit, no count limit, no content inspection, no
  malware scanning. `express-fileupload` is configured with defaults and accepts anything.
- Files are zipped verbatim and stored. No server-side treatment of any kind.

### 3.2 🔴 Documents are stored in a public-read blob container under guessable names
- **Where:** `routes/inscripcion.js:70` (`blobName = ${email}/${ISO-timestamp} - ${email}.zip`), `routes/inscripcion.js:164` (returns `https://ruidea.blob.core.windows.net/ruidea/{name}`)
- The returned URL is a **plain anonymous blob URL** — no SAS token, no signature, no expiry. This
  only works because the container is public-read (confirmed by `scripts/get-files.js`, which
  downloads with a bare GET and no credentials). The blob name is the user's own email plus a
  low-entropy timestamp.
- Combined with the listable container (the app itself calls `listBlobsSegmentedWithPrefix` with an
  empty prefix), **every uploaded document is enumerable and downloadable by anyone.**
- Recommendation (urgent): set the container to private; serve documents only through an
  authenticated backend route that verifies ownership and streams the file or issues a short-lived
  SAS URL.

### 3.3 🟠 No deletion path for documents → deletion requests can't be honored
- `DELETE /usuario/:id` removes the Mongo record but nothing removes the blobs. Deleted users leave
  their uploaded documents in storage indefinitely. Data-deletion requests cannot be honored.

### 3.4 🟠 Upload is fire-and-forget and races user creation
- **Where:** `frontend/src/components/Paso5.js:42-56`
- `uploadFiles()` calls `axiosInstance.post(...)` **without returning/awaiting it**, then the code
  proceeds to create the user. Upload failures are silent (no error handling, no UI feedback), and
  the upload races the registration. Files are keyed by email, so a later email change orphans them
  and breaks `link-archivos`' substring matching.

---

## 4. Web/API Hardening

### 4.1 🟠 CORS open to the world
- **Where:** `app.js:12` — `cors({ origin: "*" })`. Should be an allowlist of the real frontends.

### 4.2 🟠 No rate limiting anywhere
- Login, `forgot-password`, `change-password`, `verificarCheckPassword`, and the enumeration-prone
  verify/estado endpoints are all brute-forceable. Add `express-rate-limit` (and ideally lockouts on
  auth endpoints).

### 4.3 🟠 No input validation; NoSQL-injection surface
- Request bodies are trusted and spread directly into Mongo queries and `$set` updates
  (`/login` builds a query from `req.body.user`; `/actualizar`, `/modificarSolicitud` set fields
  from the body). A crafted object (e.g. `{ "$gt": "" }`) can manipulate queries. Add a validation
  layer (`zod`/`joi`/`celebrate`) and cast/whitelist fields.

### 4.4 🟡 No security headers
- No `helmet`. Add standard headers (HSTS, X-Content-Type-Options, frame options, etc.).

### 4.5 🟡 Verbose error leakage
- Many handlers do `res.json({ message: err })` / return raw error objects (and `/verificarCheckPassword`
  even echoes `req.body`). Leaks stack/internal detail. Return generic messages; log details server-side.

### 4.6 ⚪ Leftover debug/dangerous routes
- `POST /emailVerification/prueba` (`routes/emailVerification.js:38`) — sends mail to a hardcoded
  gmail; remove.
- `POST /inscripcion/borrar` (`routes/inscripcion.js:225`) — `deleteMany()` with no filter wipes the
  whole collection; gated only by the public key. Remove or lock behind real admin + confirmation.

---

## 5. Data Model & Correctness

### 5.1 🟠 `numeroPasaporte` assignment has a race condition and no uniqueness
- **Where:** `routes/admin.js:43-56`, `routes/admin.js:107-140`; `models/modeloUsuario.js:32` (unique index commented out)
- The next passport number is computed as `countDocuments({estado:'aceptado'}) + 1001`. Two
  concurrent acceptances produce **duplicate passport numbers**, and the schema does not enforce
  uniqueness. Use an atomic counter (a dedicated counters collection with `$inc`, or a sequence).

### 5.2 🟡 Rejection emails never include the reviewer's message
- **Where:** `functions/sendEmail.js:64-69` — the `rechazado` branch does
  `Usuario.find({...})` (returns an **array**) then reads `userR.mensajeMedico` (undefined on an
  array). The "revision" branch fetches `user` but never uses it. The reviewer's message is silently
  dropped from the email.

### 5.3 🟡 Email-template HTML injection via reviewer's message
- The `mensajeMedico` (free text from a reviewer) is interpolated raw into email HTML. Even though
  it's currently always undefined (5.2), once fixed it should be HTML-escaped to avoid injection.

### 5.4 🟡 Inconsistent and missing validation on write
- `/actualizar` and `/modificarSolicitud` reset `password` from the body on every edit (re-hashing
  whatever is sent, possibly empty), reset `fechaCreacion`, and force `estado`. There's no
  validation that required fields are present or well-formed, and the category sub-object shape is
  copied field-by-field with the typo'd key `disortografía` (accented) — easy to get wrong.

### 5.5 ⚪ Schema/usage drift
- `linkArchivos` is set to `''` by the client and never used meaningfully; `aceptoRecibirInfo` is
  collected but never acted upon; `aceptoSolicitud` is never persisted (consent record for the
  privacy policy is not stored — a compliance gap).

---

## 6. Performance & Scalability

### 6.1 🟠 `link-archivos` lists the entire blob container on every call
- **Where:** `routes/inscripcion.js:148` — `listBlobsSegmentedWithPrefix('ruidea', '')` enumerates
  **all** blobs, then substring-matches the email in JS. O(total files) per request, doesn't page
  past the first segment (so it silently misses files once the container grows), and substring
  matching means `a@x.com` matches `aa@x.com`. Store the blob path on the user record instead.

### 6.2 🟡 Unbounded full-collection reads
- `GET /inscripcion/` and `/admin/solicitudes` (empty condition) and `/excel` do `Usuario.find()`
  with no pagination or projection. Fine at small scale, will degrade and ships the password hash
  with every row. Add pagination + field projection.

### 6.3 🟡 Puppeteer launched per request
- `/descargar/:type/:id` launches a fresh Chromium per call. Heavy and slow under any concurrency;
  no timeout/pool. Consider a shared browser instance or a queue, and a hard timeout.

---

## 7. Dependencies & Infrastructure

### 7.1 🟠 End-of-life / outdated runtimes and libraries
- **Backend:** Node 16 (EOL, no security patches) pinned in `package.json` and `Dockerfile`;
  `puppeteer@3.0.4` (2020); `mongoose@5` with deprecated connect options (`useCreateIndex`,
  `useFindAndModify`); `mongodb@3`.
- **Frontend:** `react-scripts@3.4.1` and `axios@0.19.2` (both have known advisories), React 16.
- Recommendation: upgrade Node to current LTS, bump Puppeteer/Mongoose, run `npm audit` on both and
  schedule regular updates.

### 7.2 🟡 Dead / wrong dependencies
- Backend declares `aws-sdk`, `ssh2-sftp-client`, `archiver`, and the bogus `fs@0.0.1-security`
  package — none used in the live code paths (AWS/FTP are commented-out legacy in `inscripcion.js`).
  Frontend declares `puppeteer@^5.2.1` (a server library, ~no business in a CRA app) and
  `react-google-picker`. Remove to shrink install/attack surface.
- `package.json` sets `packageManager: pnpm` but a `package-lock.json` exists and the Dockerfile
  runs `npm install`. Pick one toolchain and commit a single lockfile.

### 7.3 🟡 Container/build hygiene
- `Dockerfile` runs `npm install --production` (no `npm ci`, no lockfile guarantee) and `COPY . .`
  (copies `.env`, `.git`, local `user-files/`, `zip-files/` if present — `.dockerignore` covers some
  but verify). Pin to `npm ci`, ensure secrets and local data are never in the image.
- No healthcheck, runs as root, `EXPOSE $PORT` won't interpolate at build time (cosmetic).

### 7.4 ⚪ One-off migration scripts left in the repo with hardcoded infra
- `scripts/get-files.js` hardcodes `https://ruidea-backend.herokuapp.com/...` and calls the
  unauthenticated `link-archivos`. These bulk tools (download all docs, re-zip, re-upload) are
  powerful and should live outside the deployed service or behind strong controls.

---

## 8. Observability, Logging & Compliance

### 8.1 🟠 No audit logging
- For sensitive personal data, who-accessed/modified-what must be logged. There is no structured
  logging at all (only `console.log`). No audit trail for admin decisions, document access, or data
  exports.

### 8.2 🟠 Data-protection gaps (non-code, but driven by the code)
- No record of consent (`aceptoSolicitud` not persisted), no retention policy, no deletion mechanism
  (see 3.3), sensitive personal data stored unencrypted at the field level, data shipped to a
  third-party host (2.3), and an open breach surface across §1–§3. A data-protection review (lawful
  basis, retention, processor agreements with Azure/Netlify/Office365) should run in parallel
  with the technical fixes.

---

## 9. Code Quality (lower priority, but worth scheduling)

- No tests anywhere in either repo. No CI. No linting enforced (`/* eslint-disable */` at the top of
  several frontend files).
- `var` + redeclared variables inside `switch` cases (`routes/admin.js`), inconsistent
  async/callback mixing (`Usuario(user).save(cb)` alongside `await`), no central error handler in
  Express, Spanish/English mixed naming, large copy-pasted email HTML blobs (could be templated).
- Frontend trusts server responses implicitly, deletes `password` client-side (`Form.js:28`) instead
  of the server never sending it, and keeps identity in cookies without flags (`httpOnly`/`secure`
  not set; they're readable JS cookies by design here, which is part of the auth problem).

---

## 10. Second-pass findings (added 2026-06-12)

These were found in a follow-up sweep focused on the recent commits (`add Dockerfile, new
storage and scripts`, `add features to verificarCheckPassword`) and areas the first pass touched
only lightly. A few of them also **correct** earlier statements — see §10.8.

### 10.1 🔴 Live production secrets are baked into the Docker image
- **Where:** `Dockerfile` (`COPY . .`, no `.env` exclusion), `.dockerignore`, `.env`
- `.env` is correctly git-ignored, but **`.dockerignore` does not list it** (it covers
  `node_modules`, `.git`, `zip-files`, `user-files`, `*.zip` — not `.env`). The Dockerfile does
  `COPY . .`, so the local `.env` is copied verbatim into the image, and `package.json`'s
  `push-prod` script (`az acr build … --registry ruidea`) pushes that image to a container registry.
- The `.env` currently on disk contains **all** live production secrets in cleartext:
  `DB_CONNECTION` (Mongo Atlas URI with `admin:` password), `SECURITY_KEY` (= JWT secret, see §1.2),
  `AZURE_STORAGE_CONNECTION_STRING` (full-access storage `AccountKey`), `CLAVE_HASHEADA_ADMIN`,
  `VERIFY_PASSWORD`, `SMTP_KEY`. Anyone who can pull the image (registry access, a leaked layer, a
  CI cache) gets the **entire** secret set — DB, blob storage, JWT signing, admin.
- **Recommendation:** add `.env` (and `*.env`) to `.dockerignore` immediately; inject secrets at
  runtime via the platform's secret store, never via `COPY`; rebuild and repush; and rotate every
  secret listed above (they must be assumed compromised — see §10.8 on the rotation list).

### 10.2 🟠 `/forgot-password` is a user-enumeration oracle (and leaks the error object)
- **Where:** `routes/usuario.js:124`
- `const user = await Usuario.findOne(...); await sendPasswordResetEmail(email, user._id);` — when the
  email is **not** registered, `user` is `null`, `user._id` throws, the `catch` returns **HTTP 500**
  with the raw `err` in the body. A registered email returns **HTTP 200** (`"Email … enviado!"`).
  The status-code difference is a clean oracle for "is this person in the registry?" — and given the
  nature of the data, mere membership is itself sensitive.
- (Note: this does **not** crash the server — the `try/catch` contains it — but it does leak `err`.)
- **Recommendation:** guard `if (!user)` and return the **same** generic 200 response whether or not
  the address exists; never echo `err` to the client.

### 10.3 🟠 Frontend ships full URLs — including reset tokens and document numbers — to Google Analytics
- **Where:** `frontend/src/App.js:27-28` (`ReactGA.pageview(window.location.pathname + window.location.search)`), routes at `frontend/src/App.js:57,60,63`
- Every navigation sends the full path+query to Google Analytics. Sensitive routes include
  `/verificar/:nroDocumento/:nroPasaporte` (document number **and** passport number),
  `/cambiarContraseña/:token` (the password-reset JWT — which is *forgeable*, §1.2, and now also
  *logged at Google*), and `/verificarEmail/:token`. This is sensitive PII and live auth
  tokens handed to a third-party processor, in plain violation of data-minimization.
- `public/index.html:7` additionally pulls webfonts from `fonts.googleapis.com`, leaking IP/UA to
  Google on every page; minor next to the above but the same class of issue.
- **Recommendation:** strip sensitive path/query segments before any `pageview`, or drop client-side
  GA entirely for authenticated/verify/reset flows; self-host fonts.

### 10.4 🟡 `verificarCheckPassword` distinguishes "right shared password" from "wrong" (and compares non-constant-time)
- **Where:** `routes/usuario.js:20-33`
- The handler returns **401** when `password !== VERIFY_PASSWORD`, but **400** (`{existe:false}`) when
  the password is correct yet the passport isn't found. That status split lets an attacker confirm
  they hold the correct global `VERIFY_PASSWORD` without knowing any real passport number — turning
  the shared-secret weakness of §1.8 into something testable. The comparison is also a plain `===`
  (not constant-time), and the `catch` still echoes `req.body` (already noted in §4.5).
- **Recommendation:** return an identical generic response for both wrong-password and
  not-found; compare with `crypto.timingSafeEqual`; move to per-verifier credentials (§1.8).

### 10.5 🟡 Bulk PII export/migration scripts live in the deployed repo
- **Where:** `scripts/get-files.js`, `scripts/create-zips.js`, `scripts/upload-to-blob.js` (added in `0f85b90`)
- These pull **every** user's uploaded documents down to local disk
  (`./user-files`), re-zip them, and re-upload to blob storage, leaving cursor/progress JSON
  (`zip-creation-cursor.json`, `upload-progress.json`) behind. `get-files.js` still points at the
  unauthenticated `…/inscripcion/link-archivos` endpoint (§1.7/§3.2) and references a **second**
  storage host, `ruideaalmacenamiento.blob.core.windows.net` — implying a storage migration; the
  **old** container may still exist with all documents and the same public-read exposure (§3.2).
  These tools are a one-command full-registry exfiltration kit shipped inside the service image.
- **Recommendation:** move migration tooling out of the deployed repo; confirm the legacy
  `ruideaalmacenamiento` container is locked down or deleted; ensure `user-files/`, `zip-files/`,
  and the cursor files never reach the image (they're in `.dockerignore`/`.gitignore` — verify).

### 10.6 🟡 `/descargar/:type/:id` dereferences a possibly-null user
- **Where:** `routes/usuario.js:75-84`
- `const user = await Usuario.findById(req.params.id)` then immediately reads
  `user.fechaNacimiento`/`user.apellidos`. A bad/unknown id throws inside the (un-try/caught) handler
  → 500. Minor robustness/enumeration nit; also note `pais` was added to the third-party template
  URL, extending the PII-in-URL leak of §2.3.
- **Recommendation:** null-check and 404; render the template first-party (§2.3).

### 10.7 ⚪ Dockerfile/email nits
- `Dockerfile` still uses `npm install --production`, not `npm ci` (§7.3 stands for the new file);
  `EXPOSE $PORT` does not interpolate at build time (cosmetic, §7.3). The base image moved to
  `node:16-bookworm` with **system** Chromium (`PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium`,
  `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true`) — an improvement over bundling `puppeteer@3`'s Chromium,
  though Node 16 is still EOL (§7.1).
- The legacy FTP block commented out in `routes/inscripcion.js` still contains cleartext credentials
  in source/history; delete it.

### 10.8 Corrections to the first-pass write-up
- **§2.1 is about the *frontend* repo and is accurate there. The *backend* `.env` is NOT committed**
  — it is git-ignored and absent from history (`git ls-files`/`git log -- .env` are empty). The
  backend secret-exposure path is the Docker image instead (§10.1), not git. Earlier sweep notes
  claiming the backend `.env` is "in git history" are wrong.
- **§Phase 0 rotation list is incomplete.** It names `SECURITY_KEY`, `SMTP_KEY`, `VERIFY_PASSWORD`,
  and admin creds, but must also include **`DB_CONNECTION` (Mongo admin password)** and the
  **`AZURE_STORAGE_CONNECTION_STRING` account key** — both are in the same `.env` that ships in the
  image (§10.1) and both grant full data access.
- `/forgot-password` does **not** crash the process (it has a `try/catch`); treat it as an
  enumeration + error-leak issue (§10.2), not a DoS.

---

## 11. Third-pass findings (added 2026-06-12)

A deeper read of the route bodies, the upload path, and the frontend build surfaced exploit
primitives and correctness bugs the earlier passes named only in the abstract. These are concrete,
testable, and several escalate existing findings from "weak" to "trivially bypassable."

### 11.1 🔴 NoSQL operator injection turns `verificarCheckPassword` into a registry dump
- **Where:** `routes/usuario.js:21-29`
- `pasaporte` comes from the JSON body and is passed straight into
  `Usuario.findOne({ numeroPasaporte: pasaporte })`. Mongoose casts **per operator**, so a body of
  `{ "pasaporte": { "$gte": 1001 }, "password": "<VERIFY_PASSWORD>" }` is a valid query and returns
  the **first accepted user**, handing back their `numeroDocumento` — without the attacker knowing
  **any** real passport number. `{ "$ne": null }` works the same way. Combined with the shared
  `VERIFY_PASSWORD` (§1.8) and the right-password oracle (§10.4), one leaked string becomes a
  pull-any-record primitive, not just a passport→document resolver.
- The same operator-injection shape applies to `/login`'s `req.body.user` (`routes/usuario.js:50-51`)
  and to every `$set`/`findOne` built from a request body (§4.3) — login is only spared because
  `bcrypt.compare` still needs the real password. This concretizes §4.3's general warning.
- **Recommendation:** validate/cast `pasaporte` to a Number (and every body field to its expected
  scalar type) before querying; reject objects. A schema validator (`zod`/`celebrate`) at the route
  boundary closes the whole class.

### 11.2 🟠 Unauthenticated outbound-email abuse (spam relay, SMTP-reputation burn, harassment)
- **Where:** `routes/usuario.js:124` (`/forgot-password`), `routes/emailVerification.js:29`
  (`/resend/:id`), `routes/emailVerification.js:38` (`/prueba`)
- All three send mail through the project's authenticated SMTP account, are **unauthenticated**, and
  have **no rate limit**. `/forgot-password` mails any address in the body; `/resend/:id` mails the
  verification link to any user id; `/prueba` fires on every call. An attacker can loop these to:
  exhaust the SMTP quota (denial of the real reset/verify flow), get the sending domain
  **blacklisted** (so legitimate mail stops arriving), or **harass** specific registrants with a
  flood of "reset your password" mail. This is the abuse/cost/reputation framing behind the bare "no
  rate limit" notes in the appendix.
- **Recommendation:** rate-limit per IP and per target address, add a CAPTCHA/throttle on
  `forgot-password`/`resend`, and delete `/prueba` (§4.6).

### 11.3 🟠 Blob-name injection via the unsanitized `:email` path param
- **Where:** `routes/inscripcion.js:51,70` — `blobName = ${email}/${ISO} - ${email}.zip`
- The `:email` route param is attacker-controlled and concatenated **directly** into the Azure blob
  path with no validation that it is an email or free of `/`. Because the upload is unauthenticated
  (§3.1) and the container is public-read/listable (§3.2), an attacker can: write blobs under
  **arbitrary path prefixes** in the container, and craft a name whose substring matches a victim's
  email so that the victim's `link-archivos` (which does a naive `name.includes(email)` substring
  match, §6.1) resolves to the **attacker's** uploaded file — a document-swap / poisoning primitive
  against what a relying party downloads. The low-entropy timestamp portion compounds the
  guessability already noted in §3.2.
- **Recommendation:** never derive a storage key from client input; key blobs by the server-side
  record `_id`, validate the param, and store the resulting blob path on the user document (also
  fixes §6.1).

### 11.4 🟠 Unauthenticated upload is a memory-exhaustion / zip-bomb DoS
- **Where:** `routes/inscripcion.js:46-79`; `app.js:11` (`fileUpload()` with defaults)
- `express-fileupload` is configured with **no `limits`** (no size, no file count), and the handler
  buffers every uploaded file in memory, then runs `JSZip` `DEFLATE` **level 9** to a `nodebuffer` —
  the most CPU- and memory-intensive setting — synchronously per request. With no auth and no rate
  limit, a few large or numerous concurrent uploads exhaust process memory or peg the event loop and
  take the API down. A compressible payload (zip-bomb-style input) amplifies it further.
- **Recommendation:** set `fileUpload({ limits: { fileSize, files }, abortOnLimit: true })`, enforce
  a server-side type allowlist (§3.1), require auth, rate-limit, and stream rather than buffer.

### 11.5 🟠 The live API key is committed to the frontend repo *today* (not just in history)
- **Where:** `frontend/.env` — **tracked at HEAD** (`git ls-files --error-unmatch .env` succeeds),
  last modified in feature commit `53f17e9`, despite being listed in `.gitignore` (added after the
  file was already tracked).
- This sharpens §2.1: it is not only a history-scrub problem. `git rm --cached frontend/.env` is
  needed **now**, in addition to purging history. The file contains the **live** values currently
  serving production: `REACT_APP_SERVER_KEY=0#2BPClI!evtqq2h@EHbR|A@` (= `SECURITY_KEY` = the JWT
  signing secret of §1.2) and `REACT_APP_GA_KEY`. Anyone with read access to the repo (or the public
  bundle, §1.1) holds the master key and can forge tokens (§1.2). Rotation per §10.8 still applies.

### 11.6 🟡 Production build ships source maps → full original source is public
- **Where:** `frontend/build/static/js/*.chunk.js.map` (one `.map` per chunk); CRA default
  `GENERATE_SOURCEMAP=true`, no override in `.env`/`package.json`
- The built bundle includes complete source maps. If `build/` is what is deployed (the app targets
  `ruidea.azurewebsites.net`), anyone can reconstruct the **entire original frontend source** —
  component logic, every endpoint and request shape, the admin flow, and the embedded
  `REACT_APP_SERVER_KEY` — directly from the live site. This makes the static-key model (§1.1) and
  the endpoint inventory effortless to map.
- **Recommendation:** build with `GENERATE_SOURCEMAP=false` for production (or strip `.map` files
  before deploy); none of this matters until the auth model is fixed, but it lowers the bar for an
  attacker today.

### 11.7 🟡 `/inscripcion/actualizar` corrupts state on every self-edit (lockout + status loss)
- **Where:** `routes/inscripcion.js:172-201`; `frontend/src/components/Paso5.js:65` calls it from the
  edit flow
- Each profile edit unconditionally `$set`s `password: bcrypt.hash(user.password)`,
  `fechaCreacion: Date.now()`, and **`estado: 'pendiente'`**. Consequences: (a) an **accepted** user
  who edits anything is silently knocked back to `pendiente` while **keeping** their old
  `numeroPasaporte` — an inconsistent record that still verifies; (b) the password is re-hashed from
  whatever the client sends — if the form omits or blanks it, the account is **re-hashed to an
  empty/garbage password and the user is locked out**; (c) `correoElectronico` can be changed here,
  which orphans the email-keyed blobs (§3.4/§6.1). This is the concrete failure mode behind §5.4.
- **Recommendation:** never write `password` unless the user is intentionally changing it; don't
  reset `estado`/`fechaCreacion` on edit; validate the body.

### 11.8 🟡 Login ignores `emailVerificado` and `estado` — verification/approval is cosmetic
- **Where:** `routes/usuario.js:47-59`; `frontend/src/components/Login.js:30-31`
- `/login` checks only the bcrypt password; it never consults `emailVerificado` or `estado`. A user
  who never confirmed their email, or whose application was **rejected**, can still authenticate and
  reach the dashboard. The whole email-verification subsystem (§1.2, §5) therefore gates nothing on
  the login path. (Frontend simply sets the `logged-in`/`id` cookies on `correcto:true`.)
- **Recommendation:** enforce `emailVerificado === true` (and an appropriate `estado`) server-side at
  login, with a clear error for each case.

### 11.9 ⚪ Auth cookies carry no flags and the admin gate is a forgeable boolean
- **Where:** `frontend/src/components/Login.js:30-31`, `Paso5.js:95-96`,
  `components/admin/adminAuth.js:18`, `AdminLogin.js:26`
- `logged-in`, `id`, and `admin` are set with `{ expires: 0 }` and **no `secure`, `httpOnly`, or
  `sameSite`** — readable and writable by any script (so any XSS steals the `id` that drives the IDOR
  of §1.5) and sent over plain HTTP if ever reached that way. `admin=true` is a client-set literal
  (§1.3): `document.cookie="admin=true"` in devtools is the entire admin gate. This is the concrete
  cookie-hygiene gap behind §9; it cannot be fixed by flags alone — it needs the real server-side
  sessions of Phase 1.

---

## 12. Remediation Roadmap (suggested order)

### Phase 0 — Stop the bleeding (hotfix branch, days)
1. **Rotate** `SECURITY_KEY`, `SMTP_KEY`, `VERIFY_PASSWORD`, **`DB_CONNECTION` (Mongo admin
   password)**, the **`AZURE_STORAGE_CONNECTION_STRING` account key**, and admin creds; split the JWT
   signing secret from any client-visible value. `git rm --cached frontend/.env` (it is still tracked
   at HEAD, §11.5) **and** purge it from history, and add `.env` to the backend `.dockerignore` so
   secrets stop shipping in the image (§10.1).
2. **Lock the blob container to private**; stop returning raw blob URLs — stream documents through an
   authenticated, ownership-checked backend route (or per-request SAS).
3. **Add auth** to `DELETE /usuario/:id`, `subir-archivos`, `link-archivos`; **remove** `/borrar`
   and `/prueba`.
4. **Strip `password`** (and internal fields) from every response; remove `oldPass` from
   `change-password`; trim `/verificar` to the minimum public fields.
5. **Validate `change-password` / `confirm` tokens** properly and ensure they can't be forged once
   secrets are split.
6. **Cast/validate body fields to scalars** on `verificarCheckPassword` and `login` to kill the
   NoSQL operator-injection dump (§11.1); cap `express-fileupload` with `limits` + `abortOnLimit`
   and rate-limit the unauthenticated email routes (§11.2, §11.4).

### Phase 1 — Real auth & access control (1–2 weeks)
7. Server-issued sessions or short-lived JWTs bound to the authenticated user; per-record
   authorization checks (kill the IDOR/IODR patterns in §1.5–1.6).
8. Distinct, server-enforced **admin role**; remove the client-cookie admin gate and the shared
   `authkey` model entirely.
9. Per-verifier credentials (or signed, scoped tokens) for the passport-verification flow; add rate
   limiting + audit logging.

### Phase 2 — Hardening & correctness (1–2 weeks)
10. Input validation everywhere (`zod`/`joi`), allowlist CORS, `helmet`, rate limiting, generic error
   responses, central error handler.
11. Server-side upload validation (type/size/count) + malware scanning (Azure Defender for Storage).
12. Fix the passport-number counter (atomic), the rejection-email bug, HTML-escaping, and consent
    persistence. Add document deletion on record removal.
13. Move passport rendering first-party; remove identity from URLs.

### Phase 3 — Platform, perf, quality (ongoing)
14. Upgrade Node to LTS, bump Puppeteer/Mongoose/react-scripts/axios; `npm audit` both repos; prune
    dead deps; unify package manager + Dockerfile (`npm ci`).
15. Fix `link-archivos` (store blob path on the record), paginate/project list endpoints, pool/queue
    Puppeteer.
16. Add structured logging + audit trail; introduce tests + CI + lint.
17. Run a formal data-protection review in parallel.

---

## Appendix — Endpoint inventory & auth status

| Method | Path | Auth in code | Notes |
|---|---|---|---|
| POST | `/usuario/verificar/:doc/:pasaporte` | shared key | returns full record incl. hash (1.6) |
| POST | `/usuario/verificarCheckPassword` | shared `VERIFY_PASSWORD` | passport→document lookup (1.8) |
| GET | `/usuario/estado/:id` | shared key | IDOR, returns hash (1.5, 2.2) |
| POST | `/usuario/login` | shared key | returns full record incl. hash (2.2) |
| GET | `/usuario/count` | shared key | |
| GET | `/usuario/descargar/:type/:id` | shared key | PII in third-party URL (2.3) |
| POST | `/usuario/forgot-password` | none | no rate limit (4.2) |
| POST | `/usuario/change-password` | token (forgeable) | returns old hash (1.2, 2.2) |
| DELETE | `/usuario/:id` | **none** | delete any user (1.7) |
| GET | `/inscripcion/` | shared key | all users incl. hashes (2.2, 6.2) |
| POST | `/inscripcion/` | shared key | create user |
| POST | `/inscripcion/subir-archivos/:email` | **none** | unvalidated upload (3.1) |
| GET | `/inscripcion/link-archivos/:id` | **none** | public blob URL, lists whole container (3.2, 6.1) |
| PUT | `/inscripcion/actualizar` | shared key | resets password/estado from body (5.4) |
| POST | `/inscripcion/comprobar-mail` | shared key | email existence oracle |
| POST | `/inscripcion/borrar` | shared key | `deleteMany()` no filter (4.6) |
| DELETE | `/inscripcion/:id` | shared key | |
| POST | `/admin/login` | shared key + creds | (1.3) |
| POST | `/admin/respuesta` | shared key | accept/reject, no admin role (1.3) |
| POST | `/admin/solicitudes` | shared key | list all |
| POST | `/admin/modificarSolicitud` | shared key | |
| POST | `/admin/solicitudes/:id` | shared key | IDOR (1.5) |
| GET | `/admin/excel` | shared key | full DB export (2.4) |
| POST | `/emailVerification/confirm/:token` | token (forgeable) | (1.2) |
| POST | `/emailVerification/resend/:id` | none | no rate limit |
| POST | `/emailVerification/prueba` | none | debug route, hardcoded email (4.6) |
