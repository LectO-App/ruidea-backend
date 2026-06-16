# Registration UX — Design Spec

> Scope: the user registration / passport-application flow.
> Backend entrypoint today: `POST /` in `routes/inscripcion.js`, schema in `validation/schemas.js`, model in `models/modeloUsuario.js`.
> Audience: people with learning disabilities — dyslexia, dyscalculia, dysgraphia (disortografía), dyspraxia, ADHD — and the parents/guardians who apply on behalf of minors.

---

## 0. Governing principle

Every friction in a generic form is **multiplied** for this audience. A 14-field wall is annoying for a typical user; for someone with ADHD it's abandonment, for dyspraxia it's physical strain, for dyslexia it's visual stress, for dyscalculia a rigid date field is a wall.

**Design for the hardest case and everyone else gets a pleasant experience for free.** A learning-disability passport whose own application form is a cognitive, motor, and reading obstacle course is a contradiction. The form should *be* the first accommodation the passport promises.

**Product realization:** DISFAM serves children. Many applicants are minors, filled in by a parent/guardian. The first question is likely *"¿El pasaporte es para ti o para alguien que cuidas?"* — that branch reshapes name, DOB, consent, and account ownership. Ignoring it forces parents to fight the field labels.

---

## 1. Structural moves (the 80% of the win)

| Move | Why it matters *here specifically* |
|---|---|
| **Split "create account" from "fill application."** Email + password (or magic link) creates a saved account in ~15s. The long passport data is filled afterward, resumable. | ADHD/executive-function: a 10-minute atomic form has brutal drop-off. A 15s commitment + "finish whenever" is completable. |
| **One question (or one tight group) per screen** — conversational, not a scroll-wall. | Removes choice overload; single focus per screen. The biggest ADHD/dyslexia accommodation. |
| **Autosave every field to a draft, debounced.** Never lose data — not on refresh, not on a phone call, not on a server 500. | This audience gets interrupted by definition. Lost progress = they don't come back. |
| **"Save & continue later" via magic link.** | Lets a parent go find the diagnosis PDF without losing their place. |
| **Final review screen** before submit, with edit-in-place per section. | Lets people check work calmly; reduces anxiety on an official application. |
| **Progress + honest time estimate** ("Paso 2 de 5 · ~2 min restantes"). | Predictability lowers anxiety; ADHD benefits from a visible finish line. |
| **Question every required field.** Do you truly need `lugarNacimiento` *and* `paisResidencia` *and* `localidadResidencia` at signup? | Shortest path to "pleasant" is "shorter." Every removed field lifts completion. |

**Backend implication:** the atomic `POST /` (`routes/inscripcion.js:35`) becomes `POST /draft` (creates a `pendiente` record from step 1, auto-session) + `PATCH /inscripcion/:id` per step with **partial** Zod schemas. The model already has `estado: 'pendiente'`, so a half-filled record is natural state, not an error.

---

## 2. Audience-specific design (per condition)

### Dyslexia
- Off-white/cream background, dark-gray (not pure-black) text — reduces glare/visual stress. Never pure `#000` on `#FFF`.
- Left-aligned, never justified. Line-height ≥1.5, generous letter/word spacing.
- Short sentences, one idea per line, sentence case (never ALL CAPS — destroys word-shape recognition).
- Pair every label/status with an icon — never color or text alone.
- Offer a **read-aloud** button per section; honor the OS. Consider an OpenDyslexic / Atkinson Hyperlegible font *toggle* (never forced).
- Never reject free text on spelling.

### ADHD
- One thing per screen. Strip every non-essential element per step — no sidebars, upsells, "did you know."
- Immediate feedback on every action (positive validation).
- Visible progress + autosave so an attention lapse costs nothing.
- No timeouts. If sessions expire, the draft must survive.

### Dyspraxia (motor coordination)
- Large targets (≥44px; WCAG 2.2 minimum 24px) with generous spacing — no two tappable things crammed together.
- **No drag-only interactions.** Document upload must accept click-to-browse (WCAG 2.2 §2.5.7).
- Keep the primary button far from destructive/back actions to avoid mis-taps.
- Allow typing for DOB; never force precise calendar-clicking through decades.

### Dyscalculia
- Be radically forgiving with number/date formats. Accept `600123123`, `600 12 31 23`, `+34…` and auto-format. Same for document number.
- DOB as Día (input) / Mes (dropdown of month *names*) / Año (input) — not a numeric puzzle.
- Never require the user to compute or format anything.

### Dysgraphia / disortografía
- Autocomplete everything autocompletable (country, locality) so they type less and can't "misspell."
- Don't block dictation/speech-to-text with restrictive validation.
- Never reject a name/place for not matching a regex.

---

## 3. Field-by-field ideal treatment

| Field | Do this |
|---|---|
| **nombre / apellidos** | `autocomplete="given-name"` / `family-name`. Allow accents, ñ, hyphens, spaces. No regex name-validation. |
| **fechaNacimiento** | `autocomplete="bday"`. Día (input) · Mes (dropdown of names) · Año (input). **Never** a calendar opening on today that pages back 40 years. Validate plausibility; branch to guardian flow if minor. |
| **correoElectronico** | `type=email inputmode=email autocomplete=email`, lowercase-normalize. **Typo detection** ("¿Quisiste decir gmail.com?"). **Async availability** via existing `comprobar-mail`, debounced, announced with `aria-live`. |
| **numeroTelefono** | `intl-tel-input` + libphonenumber, default +34, validate, store E.164. `autocomplete=tel`. |
| **paisResidencia** | Searchable dropdown with flags, default España, `autocomplete=country-name`. Free text → data chaos. |
| **localidadResidencia** | Autocomplete cascading from country (Spanish municipality list / Places). |
| **lugarNacimiento** | Same autocomplete — *and first confirm you need it at signup.* |
| **numeroDocumento** | **Type selector** (DNI / NIE / Pasaporte) → show a format example → **validate the DNI/NIE check letter live** (Spanish docs have a checksum; catch it now, not at application rejection). |
| **diagnostico** (5 booleans) | `<fieldset><legend>`. Large tappable **cards**, not tiny checkboxes. Helper: "Puedes marcar más de uno." Add **"Aún no tengo diagnóstico / está en proceso."** Explain *why you ask and who sees it* inline. Decide with product whether ≥1 is required. |
| **password** | `type=password autocomplete=new-password`, **reveal toggle**, strength meter, **min-length only — no composition rules**, allow paste, support password managers. No "confirm password" if reveal exists. (Or go passwordless / magic link for this audience.) |
| **aceptoRecibirInfo** | Unticked, clearly optional, visually separated from legal consent. |
| **aceptoSolicitud** | **GDPR explicit consent for special-category health data** — unticked, unbundled, real privacy-policy link, plain-language "what this means." |

---

## 4. Validation & error microcopy

- **Validate on blur, not on submit.** Backend already returns per-field `errors[]` (`middlewares/validate.js:9`) — surface them inline, next to the field, never as one top banner or toast.
- **Positive validation**: calm green check when a field becomes valid. "Yes, that's right" reassurance matters as much as catching errors.
- **Errors are kind, specific, plain.** Not "Datos inválidos" → "Falta el año de nacimiento." Not "No se pudo completar el registro" (`inscripcion.js:57`) → either a fixable field error or "Algo falló de nuestro lado — tus datos están guardados, vuelve a intentarlo." **Never lose their input on a server error.**
- **`aria-describedby`** links every hint and error to its input; async results go through `aria-live="polite"`.
- Disable submit while pending; show loading state; make it **idempotent** server-side so a double-tap (dyspraxia) doesn't create two records.

---

## 5. The document upload — give it real love

Today: PDF-only, 10 files, drag-implied, separate authenticated step (`/subir-archivos`, `inscripcion.js:63`).

- **Accept images, not just PDF.** Most people have a *photo* of a paper report (JPG/PNG/HEIC). PDF-only is a real barrier on a phone. Accept images (convert server-side if you want PDFs internally).
- **Click *or* drag** (WCAG 2.2 §2.5.7 — never drag-only).
- **Thumbnail previews, per-file progress, remove button, size/format limits stated up front.**
- **Frame it**: "Sube tu informe de diagnóstico — esto es lo que revisará el equipo médico." Reassure about privacy/security of health docs right there.
- Make it an explicit, signposted **final step of the flow**, not a mysterious post-signup chore.
- Mobile: "Take a photo" / camera capture affordance.

---

## 6. Consent, trust & emotional safety

Health PII for a vulnerable group on an official document — trust is the product.

- **Explain before asking**: a one-line "por qué te lo pedimos / quién lo verá" near sensitive fields (diagnosis, documents, ID number).
- **Unbundle consent**: marketing ≠ data-processing consent. Neither pre-ticked.
- **Privacy reassurance** visibly near the sensitive steps, not buried in a footer.
- **Warm, non-clinical tone.** This audience often has bruising experiences with bureaucratic forms; the copy should feel like an ally.

---

## 7. The ending should feel like an achievement

Registration currently returns `{ usuario, csrfToken }` and silently fires an email. Replace with a **real completion moment**:

- "¡Listo, María! Tu solicitud está en camino." (use their first name)
- **What happens next + timeline**: verify email → medical review → passport issued, with rough timing.
- A gentle celebration (motion, honoring `prefers-reduced-motion`) — finishing this *is* a milestone for someone who struggled through it.
- Return a `nextStep`/`estado` field from the API so the frontend renders this instead of guessing.

---

## 8. Engineering / code-side enablers

- **Backend**: `POST /draft` + `PATCH /:id` with per-step partial schemas; standardize all responses to `{ message, ... }` JSON (today some endpoints `res.send('Subida')`, `inscripcion.js:65/89/104`); idempotency key; keep email send fire-and-forget (already good); rate-limit registration (middleware exists).
- **Validation libs**: DNI/NIE checksum (client + server), libphonenumber, email MX/typo check.
- **Accessibility baseline = WCAG 2.2 AA.** New 2.2 criteria tailor-made for this audience:
  - **3.3.8 Accessible Authentication** — no cognitive-function test; allow password managers & paste. Argues for magic-link / passwordless.
  - **3.3.7 Redundant Entry** — never ask the same thing twice; carry data across steps.
  - **2.5.7 Dragging** & **2.5.8 Target Size** — see above.
  - **3.2.6 Consistent Help** — a persistent "¿Necesitas ayuda?" in the same place every step.
- Semantic HTML: real `<label for>`, `<fieldset>/<legend>` for diagnosis & consent groups, `<button>` for buttons, logical tab order, visible focus, Enter advances.
- 16px+ inputs (no iOS zoom), sticky primary CTA on mobile, single-column always.
- **Form/funnel analytics**: track drop-off per field and per step. You *will* find non-obvious friction — measure, don't guess.
- **Test with real users who have these conditions.** A 5-person usability session with dyslexic/ADHD participants out-performs any checklist.

---

## Prioritized roadmap

1. **Split account-creation from application + autosave/resumable draft** (backend `POST /draft` + `PATCH`, frontend stepped flow). Biggest completion lever and the precondition for everything else.
2. **One-group-per-screen flow** with progress, back-without-loss, review screen.
3. **Audience-grade accessibility pass**: dyslexia typography/contrast, dyspraxia targets/no-drag, forgiving inputs for dyscalculia/dysgraphia, WCAG 2.2 AA incl. accessible auth.
4. **Field-level upgrades**: DOB segmented, country/locality autocomplete, intl phone, DNI checksum, email typo+availability, password reveal/strength.
5. **Document upload overhaul**: accept images, click-or-drag, previews/progress, framed and reassured.
6. **Validation & microcopy rewrite**: on-blur, positive validation, kind specific errors, never lose data.
7. **Completion moment + "what's next" + standardized JSON responses.**
8. **Guardian/minor branch** (product decision, possibly step 0).
9. **Instrument funnel analytics + run usability tests** with real users.
</content>
</invoke>
