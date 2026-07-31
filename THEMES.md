# Theme presets

Four ready-to-paste palettes so client sites don't all look like Sawyer's. The whole
visual identity (every color, both fonts) runs through the `:root` block at the
top of `styles.css` — swapping a theme is: paste the block below over it, and update the
Google Fonts `<link>` line in **all 6 HTML files** (`index`, `gallery`, `about`, `contact`,
`404`, `login`) to match. Nothing else needs to change; every rule in the stylesheet
references these variables, never a hardcoded color.

Pick whichever mood actually fits the photographer's real work — don't default to #1 just
because it's first. `--paper`/`--paper-soft` stay identical across all four on purpose —
they're the theme-independent light color used anywhere text sits directly on the
always-dark hero/category-hero photo scrim (see the comment above `.hero-bg::after` in
`styles.css`), not the page's day/night theme. This was a real bug found and fixed while
testing Theme 3 below (2026-07-26): the hero and category-hero titles were wired to the
themed `--cream` variable instead, so they went dark-on-dark-scrim the moment a theme
flipped `--cream` to a dark value. Already fixed at the source — `.intro-title`,
`.intro-eyebrow`, `.intro-sub`, `.hero-socials a`, `.hero-content .btn`,
`.category-hero-title`, and `.category-hero-note` all correctly use `--paper`/`--paper-soft`
now, verified against all four palettes below. Don't revert them back to `--cream` if you're
editing this file's styles later.

After pasting a theme, also update `assets/mark.svg`'s two fill colors to match, and swap
the client's initials/mark in for the placeholder aperture icon.

---

## 1. Quiet Editorial (current default — warm, dark, understated)

Moody and restrained, no accent color, lets photos carry all the energy. Good fit for a
photographer whose work is already dramatic/high-contrast and doesn't need the site
competing with it.

```css
:root {
  --umber: #1C1B18;
  --umber-dark: #2A2822;
  --umber-deeper: #100F0D;
  --cream: #EFEAE0;
  --ink: #EFEAE0;
  --ink-soft: rgba(239, 234, 224, 0.72);
  --cream-soft: rgba(239, 234, 224, 0.68);
  --paper: #F7F4EC;
  --paper-soft: rgba(247, 244, 236, 0.72);
  --hairline: rgba(239, 234, 224, 0.14);
  --baby-blue: #A9D8E8;
  --baby-blue-light: #E3F4FA;

  --font-display: "Bebas Neue", "Archivo Black", Impact, sans-serif;
  --font-body: "Inter", "Helvetica Neue", Arial, sans-serif;

  --nav-height: 76px;
  --edge: clamp(20px, 5vw, 64px);
}
```
Font link: `family=Bebas+Neue&family=Inter:wght@400;500`

---

## 2. Cool Contrast (deep navy, icy blue, sharper/athletic)

Cooler and punchier than the default — a heavier condensed display font gives it more
aggression. Good fit for high-action sports shooters (football, wrestling, track) who want
something that reads faster/harder than the quiet editorial mood.

```css
:root {
  --umber: #10141C;
  --umber-dark: #1B212C;
  --umber-deeper: #080A0F;
  --cream: #EAF2F7;
  --ink: #EAF2F7;
  --ink-soft: rgba(234, 242, 247, 0.72);
  --cream-soft: rgba(234, 242, 247, 0.68);
  --paper: #F7F4EC;
  --paper-soft: rgba(247, 244, 236, 0.72);
  --hairline: rgba(234, 242, 247, 0.14);
  --baby-blue: #6FA8C9;
  --baby-blue-light: #C9E4F0;

  --font-display: "Anton", "Archivo Black", Impact, sans-serif;
  --font-body: "Inter", "Helvetica Neue", Arial, sans-serif;

  --nav-height: 76px;
  --edge: clamp(20px, 5vw, 64px);
}
```
Font link: `family=Anton&family=Inter:wght@400;500`

---

## 3. Bright Daylight (inverted — light background, serif display)

Fully inverted from the other three: light paper background, dark ink text, elegant serif
headlines instead of a condensed poster font. Airy and warm rather than moody. Good fit for
a photographer leaning more toward senior portraits/lifestyle than hard action, or anyone
who explicitly doesn't want a "dark mode" site.

```css
:root {
  --umber: #F7F4EC;
  --umber-dark: #EDE8DC;
  --umber-deeper: #E3DCCB;
  --cream: #1C1B18;
  --ink: #1C1B18;
  --ink-soft: rgba(28, 27, 24, 0.72);
  --cream-soft: rgba(28, 27, 24, 0.68);
  --paper: #F7F4EC;
  --paper-soft: rgba(247, 244, 236, 0.72);
  --hairline: rgba(28, 27, 24, 0.14);
  --baby-blue: #C97B5C;
  --baby-blue-light: #F0DCD0;

  --font-display: "Fraunces", Georgia, serif;
  --font-body: "Inter", "Helvetica Neue", Arial, sans-serif;

  --nav-height: 76px;
  --edge: clamp(20px, 5vw, 64px);
}
```
Font link: `family=Fraunces:wght@600;700&family=Inter:wght@400;500`

This is the theme that originally surfaced the `--paper` bug described above (full
inversion is the case most likely to expose a spot that assumed light-text-on-dark) — it's
fixed now and this theme has been verified end-to-end (homepage hero + a gallery category
page, both screenshotted with real console checks, no errors). Still worth a quick visual
pass after pasting on anything genuinely new you add later, for the same reason.

---

## 4. Bold Accent (dark, near-black, one loud color)

Same dark-mode structure as the default, but trades "no accent color" for one confident,
saturated accent used hard on CTAs/links/active states. Good fit for a photographer with an
energetic personal brand who wants the site to feel less restrained.

```css
:root {
  --umber: #1A1A1A;
  --umber-dark: #262626;
  --umber-deeper: #0D0D0D;
  --cream: #F5F5F0;
  --ink: #F5F5F0;
  --ink-soft: rgba(245, 245, 240, 0.72);
  --cream-soft: rgba(245, 245, 240, 0.68);
  --paper: #F7F4EC;
  --paper-soft: rgba(247, 244, 236, 0.72);
  --hairline: rgba(245, 245, 240, 0.14);
  --baby-blue: #FF6B35;
  --baby-blue-light: #FFD9C4;

  --font-display: "Archivo Black", Impact, sans-serif;
  --font-body: "Inter", "Helvetica Neue", Arial, sans-serif;

  --nav-height: 76px;
  --edge: clamp(20px, 5vw, 64px);
}
```
Font link: `family=Archivo+Black&family=Inter:wght@400;500`

---

## Rule of thumb across multiple clients

Don't assign themes in order (1, 2, 3, 4, repeat) — that's still a pattern someone could
notice if two clients compare notes. Pick based on the individual photographer's actual
shooting style and personality, and if you're building for two clients in the same weekend,
deliberately don't hand them adjacent-looking themes.
