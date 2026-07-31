# TEMPLATE — reusable photographer portfolio CMS

**Read this section first.** This is a client-agnostic fork of the Sawyer Peralta build
(`/Users/jacklogan/Desktop/sawyer-portfolio 5`), made 2026-07-26 so a new client build
doesn't start from zero. Everything below the original handoff header is accurate
*engineering* documentation for the shared codebase — architecture, gotchas, deployment
steps all still apply. What's different in this copy:

- **No `.env` file.** Sawyer's live credentials (`GITHUB_TOKEN` especially) were never
  copied here on purpose — a new client's env vars must be generated fresh, live, during
  their onboarding call, per the standing decision that every client gets their own
  Netlify + GitHub accounts (see memory `sawyer-portfolio-cms-business`).
- **No `.git` history / no remote.** This folder is `git init`'d fresh with zero remote —
  there is no way to accidentally push here and hit Sawyer's real repo.
- **`content/*.json` reset to placeholders** (about/home/settings) — bracketed text like
  `[PHOTOGRAPHER NAME]` marks what needs the new client's real info. `taxonomy.json` was
  **kept as-is** (Sports > Pro/College/HS > Football/Basketball/Track/etc. + a "Beyond The
  Action" personal branch) since it's a genuinely reusable default for any sports
  photographer, not personal to Sawyer — rename via the CMS if a client's categories differ.
- **`assets/photos/meta.json` reset to `{"photos": []}`**, all 49 of Sawyer's real photos
  removed. The client uploads their own real photos live via the CMS — that's what it's for.
- **Hardcoded HTML swapped to bracketed placeholders** (`[PHOTOGRAPHER NAME]`,
  `[INSTAGRAM_URL]`, `[CONTACT_EMAIL]`, `[CONTACT_PHONE]`, domain refs in
  meta tags/robots.txt/sitemap.xml) — titles/meta tags/OG tags are static HTML, not driven
  by the JSON content system, so these need a manual pass per client before it's SEO/social-
  share ready. Do a project-wide find-and-replace on the bracketed tokens first thing.
- **Visual design (`styles.css`) was NOT touched** — colors/type are still Sawyer's. Per the
  standing decision, don't ship a client's site looking like a copy of Sawyer's (or of any
  other client's, since some of these prospects compete with each other) — reskin colors/
  type as part of every new build, not just the content.

**Next steps when a client says yes:** `cp -r` this folder to a new client-named folder,
find-and-replace the bracketed placeholders, reskin `styles.css`, then follow the existing
**New Client Setup Checklist** (published artifact, ask Claude to pull it back up) for the
live onboarding call — GitHub repo creation, Netlify import, the 5 env vars, domain, live
test submission. Add the new client as a row in `client-site-tracker.xlsx` immediately after.

## ⚠️ Bump `?v=` when you edit script.js or admin-loader.js

The page files load `script.js?v=N` / `admin-loader.js?v=N`. That query string is a
**manual** cache-buster — nothing bumps it automatically. Edit the JS without bumping it and
returning visitors (and your own browser) keep executing the **old cached file** while the
new one sits on disk looking correct. This cost real debugging time on 2026-07-26: a newly
added function read as `undefined` in the page even though it was plainly in the file.
Netlify serves these with long cache lifetimes, so on a live client site the stale window is
much worse than it is locally. Same rule applies to `styles.css` (currently unversioned —
a hard reload is the local workaround, but consider versioning it too before a client edit).

## ⚠️ Every save costs money — read before adding any save path (learned 2026-07-29)

**Every commit to `main` is one Netlify production deploy, and one deploy costs 15 credits.**
Nothing else on the bill comes close: on Sawyer's live site, 53 deploys burned 795 credits in
a single billing period while bandwidth, web requests and compute together came to ~13. Plans
are 300 credits/month on Free and 1,000 on Personal ($9) — so **Personal is only ~66 saves a
month**, and a photographer filling a fresh gallery will blow through that.

Not theoretical: Sawyer's account dropped to ~205 deploy-capable credits with three weeks left
in the period. When credits run out the site stays up serving the last successful deploy, but
**new saves silently stop going live** — no error in the CMS, which looks exactly like a bug.
Know that failure mode before debugging code that's fine.

Rules that follow, all already implemented in this template:

1. **Never write two files in two commits when one will do.** `putFiles(files, message)` in
   `_lib/github.js` commits any number of writes (and deletions, via `sha: null`) atomically.
   Every save path in this template is now exactly one commit. Four were not, and each cost
   30 credits instead of 15 until it was fixed on 2026-07-29 — **add** and **replace** a photo
   (`putFile` then `updateJson`), **delete** a photo (`deleteFile` then `updateJson`, in
   `content.js`), and the **About portrait** (`/api/photos` then `/api/content` from
   `admin.js`). Note the trap: the multi-select delete was correctly batched while single
   delete was not, so the expensive path was the one a client uses most. If you add a save
   path, count its commits before shipping it.
2. **Batch every multi-item operation.** Adding or deleting N photos is one commit, never N.
3. **A batch's images can't all ride in one request.** Netlify caps a function request body at
   6MB and rejects anything larger *before the function runs*, returning a bare `400` with no
   JSON body — so none of your own error wording reaches the user, and it looks like a mystery
   failure. Web-sized photos are ~0.9MB once base64'd, so the real ceiling is **about 6 photos
   per request**, nothing like a photo-count limit such as `MAX_BATCH_SIZE`. Do not trust a
   count-based limit to keep you under a byte-based cap.
4. **So large batches upload in two phases** (`handleUploadBlobs` → `handleCommitBatch` in
   `photos.js`): images become git blobs across as many requests as needed, touching no branch,
   then one small metadata-only request commits them all. Any number of photos stays **one
   commit, one deploy**. The mechanism is `putFiles` accepting `{path, sha}` for an
   already-uploaded blob alongside `{path, content, encoding}` for inline files. Blobs that
   never get committed are unreferenced and GitHub garbage-collects them, so a failed batch
   leaves nothing behind.
5. **Chunking can't rescue a single file that busts the cap alone** — `admin.js` catches that
   up front and names the photo instead of letting Netlify return the same opaque 400.

When adding any feature: a new "save" button is a recurring cost, and the CMS gives the client
no signal that clicking it spends money. A client trying three cover photos to see which looks
best costs 45 credits. Worth saying out loud during handoff.

**Buy credits rather than upgrading tiers when a client runs low.** Purchased credits (~$10 per
1,000) carry **no expiration date**, while monthly plan credits expire at the end of the billing
period. Sawyer's site hit 40 remaining credits mid-session on 2026-07-29 with three weeks left
in the period; a $10 top-up cleared it and the balance rolls over indefinitely.

## Contact marquee (added 2026-07-26)

A scrolling strip of clickable contact links sits directly above the footer on all 5 pages.

- Content is generated at runtime by `renderContactMarquee()` in `script.js` from
  `content/settings.json` — email, phone, Instagram, TikTok, plus a fixed "Book a shoot"
  link. **No admin.js changes were needed**: it reads the same fields the CMS Settings modal
  already edits, so a client adding a phone number in Settings adds it to the strip.
- Values that are blank, or still hold a bracketed placeholder like `[CONTACT_EMAIL]`, are
  skipped. If fewer than 2 real items exist the whole strip hides itself, so a
  half-configured site never scrolls placeholder text across its footer.
- The loop is pure CSS: the track holds the same set of links **twice** and animates to
  `translateX(-50%)`, so half the track is exactly one set and it's seamless at any width
  with zero per-frame JS. The duplicate set is `aria-hidden` and `tabindex="-1"` so screen
  readers and keyboard users don't get every link twice.
- JS measures one set's width and sets `--cm-duration` for a constant ~55px/sec regardless
  of how many links the client filled in; it re-measures on `document.fonts.ready` since
  webfonts change the width.
- Pauses on hover and on keyboard focus — these are links people need to click, so a moving
  target would be hostile. Under `prefers-reduced-motion` it renders one static centered row.
- It themes automatically off the existing CSS variables, so it works with any THEMES.md
  palette with no extra work.

## Reveal-on-scroll + magnetic buttons (added 2026-07-26)

Two small motion touches, both decorative and both defensively built.

**Reveal on scroll** fades section-level blocks (`.section-head`, `.promo-band`,
`.about-copy`, `.contact-direct`) up as they enter view. Deliberately NOT the hero (it's
above the fold — fading it in just delays the first thing anyone sees) and NOT individual
photos (a grid of independently fading tiles reads as jank, not craft).

**A client's content must never be able to get stuck invisible**, so the hiding is defended
four ways — don't remove any of these without understanding what it protects:

1. The `opacity: 0` rule is scoped to `html.js-anim`, a class `script.js` adds itself. No JS,
   a blocked script, or an error before that line means everything renders normally.
2. Only elements `primeReveals()` explicitly tags get hidden. Anything rendered later
   (gallery tiles after a filter) has no `data-reveal` and is visible immediately.
3. A 4-second failsafe reveals everything regardless of what the IntersectionObserver did.
4. `admin-loader.js` sets `html.is-admin` when a session is active, switching reveals off
   entirely — `admin.js` makes elements `contentEditable`, and a mid-fade or
   not-yet-scrolled-to element is a bad thing to try to click into and edit.

`primeReveals()` runs at script-execution time rather than after load on purpose: `script.js`
is a synchronous tag at the end of `<body>`, so the static DOM exists but nothing has painted
yet. Tagging after page load instead causes a visible flash of content that then hides itself.

**Magnetic buttons** (`.btn`, `.nav-book`) drift slightly toward the cursor. Transform-only,
so it can't shift layout; disabled on coarse pointers and under reduced motion.

**Verified 2026-07-26**: hidden while below the fold, reveals on scroll-in, neighbours stay
hidden; content stays visible both with `js-anim` absent and in admin mode; magnetic moves on
hover and returns on leave; under reduced motion nothing is tagged and magnetic is inert. The
CSS `prefers-reduced-motion` block can only be exercised with a real OS setting, so those
rules were inspected directly rather than triggered.

---

# Original handoff brief (Sawyer's build) — architecture reference below still applies

Read this before doing anything. It's written for an agent with no prior context on this project.

## What this is

A static photography portfolio site (originally built for Sawyer Peralta, a high school
sports photographer in Kansas), with a custom-built, dependency-free CMS so the photographer
can edit almost the entire live site themselves with no coding.

No framework, no build step, no `package.json` for the frontend. The Netlify Functions are Node built-ins only — zero npm dependencies anywhere in this repo.

**Status: live and fully working.** Deployed at `https://picsbyperaltasportfolio.netlify.app` (Netlify project `picsbyperaltasportfolio`, connected to GitHub repo `jacklogan0309-hash/sawyer-portfolio`, private). All 5 required environment variables are set. This isn't a deployment guide for a not-yet-shipped site — it's a reference for the site as it actually exists.

## Architecture

**Public site**: static HTML/CSS/JS (`index.html`, `gallery.html`, `about.html`, `contact.html`, `404.html`, `styles.css`, `script.js`). Content lives in JSON, not markup — `script.js` fetches `assets/photos/meta.json`, `content/about.json`, `content/home.json`, `content/contact-page.json`, `content/settings.json`, `content/taxonomy.json` at page load and renders everything from that data: the bento grid, the gallery tree, About/Home/Booking page text, the booking form's service-type pills, and footer/contact links.

**Admin backend**: 3 Netlify Functions under `netlify/functions/`, all Node built-ins (`crypto.scryptSync` for password hashing, HMAC for session signing — no bcrypt/JWT libraries):
- `auth.js` — `GET` session check, `POST {action:"login"|"logout"}`. Login/session env vars are `.trim()`'d before comparison (see Gotchas — this was a real bug).
- `content.js` — authenticated read-modify-write for `about.json` / `settings.json` / `meta.json` / `taxonomy.json` / `home.json` / `contact-page.json` via GitHub's Contents API. All 6 files go through the same `FILE_PATHS`/`COMMIT_LABELS` maps — adding a new editable JSON file means adding one entry to each.
- `photos.js` — authenticated photo upload / replace-by-slug, stamps a `v` timestamp on the meta.json entry for cache-busting (see Gotchas), updates the matching `meta.json` entry (unless `skipMeta` is set, used for the About-page portrait which isn't a gallery photo).
- `_lib/session.js` — cookie sign/verify (HMAC-SHA256, strict hex-format validation, `timingSafeEqual`) + scrypt password check.
- `_lib/github.js` — GitHub Contents API wrapper (`getFile`/`putFile`/`deleteFile`/`updateJson`), handles the required current-file `sha` on writes with one retry on 409/422. `GITHUB_TOKEN`/`GITHUB_REPO` are `.trim()`'d here too.

Every save is one GitHub commit to `main`; Netlify auto-deploys on push (~30–60 seconds). There's no separate publish step — the admin UI tells the user a save may take up to a minute to show live.

**Inline edit mode**: `admin-loader.js` is loaded on all pages (after `script.js`, both as plain synchronous `<script>` tags — order matters, see Gotchas). It checks `/api/auth`; if authenticated, it injects `admin.css` + `admin.js`, which overlays edit affordances directly onto the DOM `script.js` already rendered. Logged-out visitors get one small stub + one session check and the page is otherwise identical to the plain static site.

### What's editable through the CMS

- **Photos** (any gallery page): add (one or many at once), delete, drag-reorder within a category, edit caption/category/featured-homepage-slot, replace the image file. **Captions are optional** — a photo saved without one renders with no caption overlay at all (not an empty bar), and its `alt` text falls back to the category so the tile and lightbox stay accessible. Slugs fall back to a timestamp when there's no caption to derive one from.
- **Section cover photos**: on any category page (e.g. Football), a "Change cover photo" button on the hero lets Sawyer pick which existing photo represents that section — used both as that page's hero image and as the tile icon shown wherever the section is listed on a parent page (`taxonomy.json`'s `coverSlug` field, resolved by `pickRepresentativePhoto()` in `script.js`).
- **Section names**: the root "Gallery" title (`taxonomy.json`'s `rootLabel`), every branch name (Sports, Beyond The Action, High School, ...), and every leaf category name (Football, Basketball, ...) — click-to-edit via a "Save Section Names" button, batched per page view.
- **Home page text**: hero eyebrow/title/sub, both blue promo-band kickers/headings/copy, Recent Favorites header (`content/home.json`).
- **About page**: heading, bio paragraphs, portrait photo (`content/about.json`).
- **Booking page**: kicker/title/copy, and the "What are you looking for?" pills — add/remove/rename freely (`content/contact-page.json`'s `serviceOptions` array, rendered by `renderServiceOptions()` in `script.js`).
- **Site settings**: Instagram/TikTok URLs, contact email/phone, footer text (`content/settings.json`, via the Settings modal in the admin bar).

**Auth**: single username/password pair, no registration, no Netlify Identity, no Git Gateway (both were considered and rejected early on — Git Gateway is deprecated/not recommended per Netlify's docs). Credentials live only as Netlify environment variables (`ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` — a salted scrypt hash generated locally via `scripts/hash-password.js`, never the plaintext password). Login page is `login.html`, deliberately not linked from the public nav.

**Images**: resized/compressed client-side via `<canvas>` (max 2400px long edge for gallery photos, 1600px for the About portrait, ~85% JPEG quality) before upload, both for upload speed and to keep each image well under Netlify Functions' 6MB request-body limit. Note that resizing alone does **not** make a multi-photo batch fit — ~6 web-sized photos is the whole 6MB budget, which is why batches upload in phases (see the deploy-cost section at the top). Verified to correctly respect EXIF orientation (a real rotated-JPEG test round-tripped correctly — browsers' `Image`/`drawImage` are EXIF-aware here, no manual orientation-correction code needed).

**Reordering**: native HTML5 drag-and-drop. Photos in `meta.json` are one flat array; dragging within a filtered category view maps back to real indices in the full array, so reordering one category never disturbs another's order.

## Deployment reference (already done — for reference or a from-scratch redo only)

1. GitHub repo: `jacklogan0309-hash/sawyer-portfolio` (private, `main`).
2. Netlify: "Import from Git" → this repo. Build settings come from `netlify.toml` (no build command, publish `.`, functions dir `netlify/functions`, `/api/*` redirected to functions).
3. 5 environment variables set in Netlify (Site settings → Environment variables):
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD_HASH` — from `node scripts/hash-password.js "the-password"`, run locally.
   - `SESSION_SECRET` — random string (`openssl rand -hex 32`).
   - `GITHUB_TOKEN` — fine-grained PAT, scoped to just this repo, Contents read/write only. Never passes through an agent/assistant.
   - `GITHUB_REPO` — `jacklogan0309-hash/sawyer-portfolio`.
4. Changing the admin password: re-run `scripts/hash-password.js`, paste the new hash over `ADMIN_PASSWORD_HASH`, redeploy.

## Known trade-offs (accepted, not bugs)

- Each save is its own GitHub commit, and **every commit to `main` is a Netlify production deploy that costs credits** — see "Deploy cost" below before adding any new save path. Multi-item operations must be batched into one commit.
- ~30–60 second deploy lag after every save, stated plainly in the admin UI.
- No login rate limiting / lockout on `auth.js`. scrypt's cost provides some natural per-attempt friction, but there's no cap on attempts. Accepted risk for a single-admin, unlinked-login-page site — revisit if the login URL ever leaks or gets probed.
- No Content-Security-Policy header. `netlify.toml` has `X-Frame-Options`/`X-Content-Type-Options`/`Referrer-Policy` but deliberately no CSP — getting one right requires auditing every script/font source and admin.js's dynamic `<script>`/`<link>` injection, and a wrong CSP silently breaks the admin login. Worth doing carefully later, not blindly.
- `robots.txt`/`sitemap.xml`/OG-image URLs are hardcoded to `picsbyperaltasportfolio.netlify.app` — **must be updated if a custom domain is ever connected.**

## Constraints / things not to change without being asked

- Don't restructure the JSON schema (`meta.json` / `about.json` / `home.json` / `contact-page.json` / `settings.json` / `taxonomy.json`) — `script.js` and `admin.js` both assume the current field names and shapes. If a field name must change, update it in `script.js`, `admin.js`, and `content.js`'s `FILE_PATHS` together.
- Don't reintroduce hardcoded photo/bio/marketing-copy HTML into the page files — content lives in JSON, not markup, so admin.js's inline editing keeps working.
- Don't add `admin-loader.js`/`admin.js` behavior that changes what a logged-out visitor sees or fetches — the public design and payload must stay byte-identical to today for anyone not logged in.
- `google-apps-script/` (contact-form-to-Sheets logging) is unrelated to the CMS — leave it alone unless asked.

## Gotchas for future edits

- `admin-loader.js` and `script.js` must both be plain synchronous `<script>` tags, in that order, with no `defer`. `script.js` sets `window.__sitePageReady` inside its own `DOMContentLoaded` listener; `admin-loader.js` waits for that listener to have already fired before checking the flag.
- `script.js` has no IIFE wrapper — its functions are bare top-level declarations, which is what lets `admin.js` call things like `window.renderGallery` directly to refresh the page after a save instead of re-fetching (re-fetching would show stale data during the ~30–60s deploy lag).
- The GitHub PAT (`GITHUB_TOKEN`) must stay a fine-grained token scoped to just this one repo with Contents-only permission — not a broad personal token.
- **Always `.trim()` env vars read in Netlify Functions.** A real bug shipped and burned a debugging session: a trailing newline/space from copy-pasting a value into Netlify's UI silently broke every comparison (`ADMIN_PASSWORD_HASH`, `GITHUB_TOKEN`) with no useful error. `auth.js` and `_lib/github.js` now trim defensively; keep that pattern for any new env var.
- **Replacing an image at the same filename needs a cache-buster.** `meta.json` photo entries and `about.json`'s portrait carry a `v`/`portraitV` timestamp, appended as `?v=` by `photoImgSrc()`/`renderAbout()` in `script.js`. Any new code path that overwrites an existing image file must bump this field or the browser/CDN will keep serving the stale cached image with no visible error.
- **`taxonomy.json`'s top-level object has more than just `tiles`** (`rootLabel`, and `coverSlug`/`label` on individual nodes). Always save the *whole* parsed object (`taxonomyData` in `admin.js`), never reconstruct `{ tiles: taxonomyTiles }` — that exact bug shipped once and would have silently dropped `rootLabel` on the next cover-photo save.
- `.tile-label` spans have a nested `.tile-label-text` child specifically so admin.js can make the text (not the arrow icon) contentEditable — don't collapse them back into one span.

## Pre-launch checklist status

Done: OG/Twitter meta tags on all 4 real pages, `robots.txt`, `sitemap.xml`, branded `404.html`, baseline security headers, unused legacy assets removed (`gen_assets.py`, unused thumb/hero SVGs from an earlier design iteration), EXIF orientation verified.

Not done / Jack's call: custom domain (site is on the `.netlify.app` subdomain), analytics (nothing set up — Sawyer has no way to see traffic), CSP header, login rate limiting, the two mislabeled test photos above.
