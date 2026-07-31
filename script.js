// Sawyer Peralta portfolio — nav toggle, sport filter, lightbox, and
// content rendering. The gallery, bento grid, about bio, and footer
// links are NOT hardcoded in the HTML — they're built at page-load
// time from JSON files in assets/photos/meta.json and content/*.json.
// That's what lets the /admin editor (Decap CMS) change the site:
// it edits those JSON files, and this script is what turns them into
// the actual page every time someone visits.
//
// Render functions take a plain object/array and a container and set
// container.innerHTML — they don't touch `document` directly, which
// keeps them testable from Node without a real browser/DOM.

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function photoImgSrc(photo) {
  // Most entries just point at assets/photos/<slug>.jpg. If a photo
  // was uploaded through the CMS's image widget it may carry an
  // explicit "image" path instead — prefer that when present.
  const base = photo.image || `assets/photos/${photo.slug}.jpg`;
  // Replacing a photo keeps the same filename, so without a
  // cache-busting param browsers/CDNs keep showing the old bytes
  // indefinitely — "v" is bumped by the admin CMS on every replace.
  return photo.v ? `${base}?v=${photo.v}` : base;
}

// Every place a photo renders with object-fit:cover (hero, bento,
// favorites, gallery grid, category hero, tile icons) crops toward
// the center by default, which can cut off a head or an important
// detail. focusX/focusY (0-100, set via the admin CMS) override where
// that crop centers — omitted or exactly 50/50 means "use the normal
// centered crop," so this is fully backward compatible with every
// existing photo that's never had a focus point set.
// Wide contexts (homepage hero, category hero banner) crop to a much
// shorter, wider box than everything else (thumbnails, tiles,
// gallery grid), so the same focus point rarely works for both — a
// photo framed for a square thumbnail often has too much headroom
// cropped out of a short wide banner. heroFocusX/heroFocusY are a
// second, optional focus point set specifically for those wide
// contexts; falling back to the regular focusX/focusY keeps every
// photo that's never had a wide focus point set working as before.
function wideFocus(photo) {
  const x = typeof photo.heroFocusX === 'number' ? photo.heroFocusX : photo.focusX;
  const y = typeof photo.heroFocusY === 'number' ? photo.heroFocusY : photo.focusY;
  return [x, y];
}

function photoObjectPositionAttr(focusX, focusY) {
  const x = typeof focusX === 'number' ? focusX : 50;
  const y = typeof focusY === 'number' ? focusY : 50;
  if (x === 50 && y === 50) return '';
  return ` style="object-position: ${x}% ${y}%"`;
}

function photoIdSlug(photo) {
  // Used for the #photo-<id> anchor/DOM id. Existing photos always
  // have a slug. A brand-new photo added through the CMS might not —
  // fall back to the uploaded filename (without extension) so the
  // page still works before anyone fills in a slug by hand.
  if (photo.slug) return photo.slug;
  if (photo.image) {
    const file = photo.image.split('/').pop() || '';
    return file.replace(/\.[a-zA-Z0-9]+$/, '') || 'photo';
  }
  return 'photo';
}

function renderBento(container, photos) {
  if (!container) return;
  const bySlot = {};
  photos.forEach((p) => {
    if (p.bentoSlot) bySlot[p.bentoSlot] = p;
  });
  const html = 'abcdefgh'
    .split('')
    .filter((slot) => bySlot[slot])
    .map((slot) => {
      const p = bySlot[slot];
      const cap = escapeHtml(p.caption);
      // Bento lives on the homepage; the photo it points at lives on
      // the separate gallery page (see gallery.html), so this is
      // always a cross-page link, never an in-page anchor.
      return `<a class="bento-item item-${slot}" href="gallery.html#photo-${photoIdSlug(p)}" data-sport="${escapeHtml(p.category)}">
        <img src="${photoImgSrc(p)}" alt="${cap || escapeHtml(p.category)}"${photoObjectPositionAttr(p.focusX, p.focusY)}>
        ${cap ? `<span class="cap">${cap}</span>` : ''}
      </a>`;
    })
    .join('\n');
  container.innerHTML = html;
}

function renderFavorites(container, photos) {
  if (!container) return;
  const bySlot = {};
  photos.forEach((p) => {
    if (p.bentoSlot) bySlot[p.bentoSlot] = p;
  });
  const html = 'abcdefgh'
    .split('')
    .filter((slot) => bySlot[slot])
    .map((slot) => {
      const p = bySlot[slot];
      const cap = escapeHtml(p.caption);
      return `<a class="favorite-item" href="gallery.html#photo-${photoIdSlug(p)}">
        <img src="${photoImgSrc(p)}" alt="${cap || escapeHtml(p.category)}" loading="lazy"${photoObjectPositionAttr(p.focusX, p.focusY)}>
        ${cap ? `<span class="cap">${cap}</span>` : ''}
      </a>`;
    })
    .join('\n');
  container.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Gallery tree (gallery.html) — the gallery is a small browsable tree,
// not one flat list: Gallery -> Sports -> High School -> Football ->
// (photos), etc. Which level is showing is driven by ?path=a/b/c in the
// URL plus content/taxonomy.json. Every level below the top is a fresh
// page load, not an in-page filter switch — simpler and more reliable
// than faking several levels of filtering on one page.
// ---------------------------------------------------------------------------

function placeholderIconSvg() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3.5"/><path d="M8 5l1.5-2h5L16 5"/></svg>';
}

function assignTaxonomyPaths(nodes, prefix) {
  nodes.forEach((node) => {
    node.path = prefix ? `${prefix}/${node.slug}` : node.slug;
    if (node.children) assignTaxonomyPaths(node.children, node.path);
  });
}

function findPathForCategory(nodes, categorySlug) {
  for (const node of nodes) {
    if (node.category === categorySlug) return node.path;
    if (node.children) {
      const found = findPathForCategory(node.children, categorySlug);
      if (found) return found;
    }
  }
  return null;
}

// Walks a node's descendants for the photo it should use as its cover
// image (used both as the category-hero background and as the tile
// icon shown for this node in its parent's grid). Priority: an
// explicit admin-picked coverSlug wins, then a hand-picked "Featured
// tile" photo, then just the first one found.
function pickRepresentativePhoto(node, photos) {
  if (node.coverSlug) {
    const chosen = photos.find((p) => p.slug === node.coverSlug);
    if (chosen) return chosen;
  }
  if (node.category) {
    const inCategory = photos.filter((p) => p.category === node.category);
    return inCategory.find((p) => p.bentoSlot) || inCategory[0] || null;
  }
  if (node.children) {
    for (const child of node.children) {
      const rep = pickRepresentativePhoto(child, photos);
      if (rep) return rep;
    }
  }
  return null;
}

function renderTileGrid(container, nodes, photos) {
  if (!container) return;
  container.innerHTML = nodes
    .map((node) => {
      const label = escapeHtml(node.label);
      const href = `gallery.html?path=${encodeURIComponent(node.path)}`;
      // A placeholder section has no category to pull a photo from, so
      // it normally shows the "coming soon" tile. An explicitly chosen
      // cover photo is the exception: it's the only way to give a
      // section like Projects or Senior Photos a real title card
      // before any photos have been filed under it.
      const rep = (!node.placeholder || node.coverSlug) ? pickRepresentativePhoto(node, photos) : null;
      if (!rep) {
        // Nothing shot for this branch yet (a placeholder category, or
        // a real sport like Soccer that hasn't happened yet) — still a
        // real, clickable link, just styled to say "nothing here yet."
        return `<a class="placeholder-tile" href="${href}">
          ${placeholderIconSvg()}
          <span class="tile-label"><span class="tile-label-text">${label}</span></span>
        </a>`;
      }
      return `<a class="category-tile" href="${href}">
        <img src="${photoImgSrc(rep)}" alt="${label}" loading="lazy"${photoObjectPositionAttr(rep.focusX, rep.focusY)}>
        <span class="tile-label"><span class="tile-label-text">${label}</span><span class="arrow" aria-hidden="true">&rarr;</span></span>
      </a>`;
    })
    .join('\n');
}

function renderPlaceholderIcons(container, count) {
  if (!container) return;
  const tile = () => `<div class="placeholder-tile">
    ${placeholderIconSvg()}
    <span class="tile-label">Coming soon</span>
  </div>`;
  container.innerHTML = Array.from({ length: count }, tile).join('\n');
}

// Returns the photos in this leaf's category, so the caller can decide
// whether to render the grid or an empty state.
function renderCategoryHero(container, node, photos) {
  if (!container) return [];
  const inCategory = photos.filter((p) => p.category === node.category);
  const rep = pickRepresentativePhoto(node, photos);
  const bg = rep
    ? `<div class="category-hero-bg"><img src="${photoImgSrc(rep)}" alt=""${photoObjectPositionAttr(...wideFocus(rep))}></div>`
    : `<div class="category-hero-bg is-placeholder">${placeholderIconSvg()}</div>`;
  container.innerHTML = `
    ${bg}
    <div class="category-hero-content">
      <h1 class="category-hero-title">${escapeHtml(node.label)}</h1>
      ${rep ? '' : '<p class="category-hero-note">Photos coming soon</p>'}
    </div>
  `;
  return inCategory;
}

function renderCrumbTrail(container, trail) {
  if (!container) return;
  container.innerHTML = trail
    .map((step, i) => {
      if (i === trail.length - 1) return `<span class="crumb-current">${escapeHtml(step.label)}</span>`;
      const href = step.path ? `gallery.html?path=${encodeURIComponent(step.path)}` : 'gallery.html';
      return `<a href="${href}">${escapeHtml(step.label)}</a>`;
    })
    .join('<span class="crumb-sep">/</span>');
}

// A light parallax drift on the category hero's photo as the page
// scrolls — purely decorative, so it just no-ops on a placeholder hero
// (no <img> to move).
function wireParallax(root) {
  const img = root.querySelector('.category-hero-bg img');
  if (!img) return;
  const update = () => {
    img.style.transform = `translateY(${window.scrollY * 0.2}px)`;
  };
  window.addEventListener('scroll', update, { passive: true });
  update();
}

async function initGalleryTree(root) {
  const treeRoot = root.querySelector('.taxonomy-root');
  if (!treeRoot) return;

  const crumbContainer = root.querySelector('.crumb-trail');
  const branchView = root.querySelector('.branch-view');
  const titleEl = root.querySelector('.tree-title');
  const tilesContainer = root.querySelector('.category-tiles-slot');
  const heroSlot = root.querySelector('.category-hero-slot');
  const gridSection = root.querySelector('.leaf-grid-section');
  const galleryContainer = root.querySelector('.gallery-grid');

  let taxonomy, photoData;
  try {
    [taxonomy, photoData] = await Promise.all([
      fetchJson('content/taxonomy.json'),
      fetchJson('assets/photos/meta.json'),
    ]);
  } catch (err) {
    console.error('[site] gallery tree failed to load:', err);
    if (tilesContainer) tilesContainer.innerHTML = '<p style="opacity:.6">Photos failed to load. Try refreshing the page.</p>';
    return;
  }

  const tiles = taxonomy.tiles || [];
  const photos = Array.isArray(photoData) ? photoData : (photoData.photos || []);
  assignTaxonomyPaths(tiles, '');

  // A bare #photo-slug link (from the homepage's Recent Favorites) has
  // no idea which branch its photo lives under — resolve it and jump
  // straight to the right leaf page, hash intact.
  if (!location.search && location.hash.startsWith('#photo-')) {
    const slug = location.hash.slice('#photo-'.length);
    const photo = photos.find((p) => photoIdSlug(p) === slug);
    const path = photo ? findPathForCategory(tiles, photo.category) : null;
    if (path) {
      location.replace(`gallery.html?path=${encodeURIComponent(path)}${location.hash}`);
      return;
    }
  }

  const pathParam = new URLSearchParams(location.search).get('path') || '';
  const pathParts = pathParam ? pathParam.split('/').filter(Boolean) : [];

  const rootLabel = taxonomy.rootLabel || 'Gallery';
  let node = null;
  let unknownPath = false;
  const trail = [{ label: rootLabel, path: '' }];
  let nodes = tiles;
  let prefix = '';
  for (const part of pathParts) {
    const found = (nodes || []).find((n) => n.slug === part);
    if (!found) { unknownPath = true; node = null; break; }
    prefix = prefix ? `${prefix}/${part}` : part;
    trail.push({ label: found.label, path: prefix });
    node = found;
    nodes = found.children;
  }

  renderCrumbTrail(crumbContainer, unknownPath ? trail.slice(0, 1) : trail);

  const current = (!unknownPath && node) ? node : { children: tiles, label: rootLabel, isRoot: true };

  if (current.category) {
    branchView.hidden = true;
    heroSlot.hidden = false;
    const inCategory = renderCategoryHero(heroSlot, current, photos);
    wireParallax(root);

    gridSection.hidden = false;
    const existingEmptyState = gridSection.querySelector('.empty-state');
    if (existingEmptyState) existingEmptyState.remove();
    if (inCategory.length) {
      galleryContainer.hidden = false;
      renderGallery(galleryContainer, inCategory);
      wireLeafPageInteractions(root);
    } else {
      galleryContainer.hidden = true;
      galleryContainer.innerHTML = '';
      gridSection.insertAdjacentHTML('beforeend', '<p class="empty-state">No photos here yet — check back soon.</p>');
    }
  } else {
    branchView.hidden = false;
    heroSlot.hidden = true;
    gridSection.hidden = true;
    titleEl.textContent = current.label || 'Gallery';
    if (current.placeholder) {
      renderPlaceholderIcons(tilesContainer, 3);
    } else {
      renderTileGrid(tilesContainer, current.children || [], photos);
    }
  }
}

// Lightbox + hash-based scroll/highlight for a leaf page's photo grid.
// No filter tabs here anymore — switching categories is a real page
// navigation now (see renderTileGrid/renderCrumbTrail), not an in-page
// filter switch.
function wireLeafPageInteractions(root) {
  const items = root.querySelectorAll('.gallery-item');
  if (!items.length) return;

  if (location.hash.startsWith('#photo-')) {
    const target = document.getElementById(location.hash.slice(1));
    if (target) {
      target.scrollIntoView({ block: 'center' });
      target.classList.add('is-highlighted');
      window.setTimeout(() => target.classList.remove('is-highlighted'), 1600);
    }
  }

  const lightbox = root.querySelector('.lightbox');
  if (!lightbox) return;
  const lightboxImg = lightbox.querySelector('img');
  const closeBtn = lightbox.querySelector('.lightbox-close');

  items.forEach((item) => {
    item.addEventListener('click', () => {
      const img = item.querySelector('img');
      lightboxImg.setAttribute('src', img.getAttribute('src'));
      lightboxImg.setAttribute('alt', img.getAttribute('alt'));
      lightbox.hidden = false;
    });
  });

  const closeLightbox = () => { lightbox.hidden = true; };
  closeBtn.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLightbox();
  });
}

function renderGallery(container, photos) {
  if (!container) return;
  container.innerHTML = photos
    .map((p) => {
      const cap = escapeHtml(p.caption);
      return `<button type="button" class="gallery-item" id="photo-${photoIdSlug(p)}" data-sport="${escapeHtml(p.category)}">
        <img src="${photoImgSrc(p)}" alt="${cap || escapeHtml(p.category)}" loading="lazy"${photoObjectPositionAttr(p.focusX, p.focusY)}>
        ${cap ? `<span class="cap">${cap}</span>` : ''}
      </button>`;
    })
    .join('\n');
}

function renderAbout(root, about) {
  if (!about) return;
  const portrait = root.querySelector('#about-portrait');
  if (portrait && about.portrait) {
    // Same cache-busting concern as photoImgSrc — the portrait always
    // lives at the same filename, so a replace needs a fresh query
    // param or browsers/CDNs keep serving the old cached image.
    portrait.setAttribute('src', about.portraitV ? `${about.portrait}?v=${about.portraitV}` : about.portrait);
  }
  const heading = root.querySelector('#about-heading');
  if (heading && about.heading) {
    heading.textContent = about.heading;
  }
  const bioContainer = root.querySelector('#about-bio');
  if (bioContainer && Array.isArray(about.bio)) {
    bioContainer.innerHTML = about.bio.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
  }
}

// Homepage marketing copy (hero, About teaser, Recent Favorites
// header, Book promo) — was hardcoded HTML until the admin CMS needed
// a hook to edit it, same pattern as renderAbout: each field is
// optional and only overwrites the HTML's existing fallback text when
// present, so the page still reads fine even if home.json 404s.
function renderHome(root, home) {
  if (!home) return;
  const setText = (id, value) => {
    const el = root.querySelector(id);
    if (el && value) el.textContent = value;
  };
  setText('#hero-eyebrow', home.heroEyebrow);
  setText('#hero-title', home.heroTitle);
  setText('#hero-sub', home.heroSub);
  setText('#about-promo-kicker', home.aboutPromoKicker);
  setText('#about-promo-heading', home.aboutPromoHeading);
  setText('#about-promo-copy', home.aboutPromoCopy);
  setText('#favorites-kicker', home.favoritesKicker);
  setText('#favorites-title', home.favoritesTitle);
  setText('#favorites-copy', home.favoritesCopy);
  setText('#book-promo-kicker', home.bookPromoKicker);
  setText('#book-promo-heading', home.bookPromoHeading);
}

// Booking page (contact.html) kicker/title/copy — same
// optional-overwrite-of-the-HTML-fallback pattern as renderHome.
function renderContactPage(root, data) {
  if (!data) return;
  const setText = (id, value) => {
    const el = root.querySelector(id);
    if (el && value) el.textContent = value;
  };
  setText('#contact-kicker', data.kicker);
  setText('#contact-title', data.title);
  setText('#contact-copy', data.copy);
}

// Booking page's "What are you looking for?" pills — a real radio
// input per option (adjacent to its <label> so the existing
// `.pill-radio:checked + .pill-label` CSS keeps working) wrapped in a
// stable per-option span the admin CMS can hang a delete button off
// of. Built from content/contact-page.json's serviceOptions so Sawyer
// can add/remove/rename them without touching this markup.
function renderServiceOptions(root, options) {
  const container = root.querySelector('#service-pill-group');
  if (!container || !Array.isArray(options)) return;
  const usedSlugs = new Set();
  container.innerHTML = options
    .map((label) => {
      let slug = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'option';
      while (usedSlugs.has(slug)) slug += '-2';
      usedSlugs.add(slug);
      const id = `service-${slug}`;
      const safeLabel = escapeHtml(label);
      return `<span class="pill-item">
        <input type="radio" name="serviceType" id="${id}" value="${safeLabel}" class="visually-hidden pill-radio">
        <label for="${id}" class="pill-label"><span class="pill-label-text">${safeLabel}</span></label>
      </span>`;
    })
    .join('\n');
}

// Homepage hero background — 1 to 3 photos split evenly behind the
// headline (see .hero-bg img's flex:1 1 0 in styles.css, which
// adapts to however many images are actually here). Falls back to
// the two <img> tags already in index.html if settings.json's
// heroImages is missing/empty, same "don't overwrite a good fallback
// with nothing" rule as every other render function here.
function renderHeroImages(root, images, photos) {
  const container = root.querySelector('#hero-bg-container');
  if (!container || !Array.isArray(images) || !images.length) return;
  container.innerHTML = images
    .map((src) => {
      // heroImages only stores the path, not the photo's own
      // metadata, so its focus point (if any) has to be looked up
      // back on the matching meta.json entry by slug.
      const match = String(src).match(/([^/]+)\.jpg/);
      const photo = match && photos ? photos.find((p) => p.slug === match[1]) : null;
      const posAttr = photo ? photoObjectPositionAttr(...wideFocus(photo)) : '';
      return `<img src="${escapeHtml(src)}" alt=""${posAttr}>`;
    })
    .join('');
}

// Scrolling contact strip above the footer. Built entirely from
// settings.json so it stays CMS-editable — adding a phone number in the
// Settings modal adds it to the strip, with no code change.
//
// The whole animation is CSS (see .contact-marquee in styles.css); the
// only thing measured here is the width of one set, so the strip scrolls
// at the same visual speed whether the client filled in two links or five.
function renderContactMarquee(root, settings) {
  const wrap = root.querySelector('#contact-marquee');
  const track = wrap && wrap.querySelector('[data-marquee-track]');
  if (!wrap || !track) return;

  // A blank value, or one still holding a bracketed template placeholder
  // like "[CONTACT_EMAIL]", must not get scrolled across the footer.
  const isReal = (v) => {
    const s = String(v == null ? '' : v).trim();
    return s !== '' && !/^\[.*\]$/.test(s);
  };

  const items = [{ label: 'Book a shoot', href: 'contact.html' }];

  if (isReal(settings.contactEmail)) {
    items.push({ label: settings.contactEmail, href: `mailto:${settings.contactEmail}` });
  }
  if (isReal(settings.contactPhoneDisplay) && isReal(settings.contactPhoneHref)) {
    items.push({ label: settings.contactPhoneDisplay, href: `tel:${settings.contactPhoneHref}` });
  }
  if (isReal(settings.instagramUrl)) {
    items.push({ label: 'Instagram', href: settings.instagramUrl, external: true });
  }
  if (isReal(settings.tiktokUrl)) {
    items.push({ label: 'TikTok', href: settings.tiktokUrl, external: true });
  }

  // One lone "Book a shoot" isn't worth a whole scrolling strip — the
  // footer already has that link. Stay hidden until there's real content.
  if (items.length < 2) {
    wrap.hidden = true;
    return;
  }

  const setHtml = items.map((i) => {
    const ext = i.external ? ' target="_blank" rel="noopener"' : '';
    return `<a class="cm-item" href="${escapeHtml(i.href)}"${ext}>${escapeHtml(i.label)}</a>` +
           `<span class="cm-sep" aria-hidden="true">&#9670;</span>`;
  }).join('');

  // Two identical sets: translateX(-50%) then lands exactly one set over,
  // which is what makes the loop seamless without measuring anything.
  track.innerHTML =
    `<div class="cm-set">${setHtml}</div>` +
    `<div class="cm-set" aria-hidden="true">${setHtml}</div>`;

  // The duplicate is decorative — keep it out of the tab order so keyboard
  // users don't hit every contact link twice.
  track.querySelectorAll('.cm-set[aria-hidden="true"] a')
    .forEach((a) => a.setAttribute('tabindex', '-1'));

  wrap.hidden = false; // must be visible before measuring, or width is 0

  const setSpeed = () => {
    const set = track.firstElementChild;
    if (!set) return;
    const w = set.scrollWidth;
    if (w > 0) track.style.setProperty('--cm-duration', (w / 55).toFixed(2) + 's');
  };

  setSpeed();
  // Re-measure once webfonts land — they change the strip's width, and
  // with it the duration needed to hold a constant scroll speed.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(setSpeed).catch(() => {});
  }
}

/* ---------- Motion: reveal-on-scroll + magnetic buttons ----------
   Both are strictly decorative. The hard rule here is that a client's
   content must NEVER be able to get stuck invisible, so the hiding is
   defended four separate ways:
     1. The `opacity: 0` rule only applies under `html.js-anim`, and that
        class is added by this file. No JS (or a JS error before this
        point) means everything renders fully visible.
     2. Only elements this file explicitly tags get hidden. Anything
        re-rendered later (gallery tiles after a filter, say) has no
        data-reveal attribute and is therefore visible immediately.
     3. A 4-second failsafe reveals everything regardless of what the
        IntersectionObserver did or didn't do.
     4. Admin mode switches it off entirely — admin.js makes elements
        contentEditable, and a half-faded element is a bad thing to try
        to edit. admin-loader.js sets `html.is-admin` for that.
*/

const MOTION_REDUCED =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Section-level blocks only. Deliberately not the hero (it's above the
// fold — fading it in just delays the first thing anyone sees) and not
// individual photos (a grid of independently fading tiles reads as jank,
// not craft).
const REVEAL_SELECTOR = '.section-head, .promo-band, .about-copy, .contact-direct';

// Runs the moment this file executes. script.js is a plain synchronous
// tag at the end of <body>, so the static DOM is fully parsed but nothing
// has painted yet — tagging here means no flash of visible content that
// then hides itself, which is what happens if you tag after page load.
function primeReveals() {
  if (typeof document === 'undefined' || MOTION_REDUCED) return;
  const els = document.querySelectorAll(REVEAL_SELECTOR);
  if (!els.length) return;

  let tagged = 0;
  els.forEach((el) => {
    if (el.closest('.hero')) return;
    el.setAttribute('data-reveal', '');
    tagged++;
  });
  if (tagged) document.documentElement.classList.add('js-anim');
}

function initReveals(root) {
  const els = root.querySelectorAll('[data-reveal]');
  if (!els.length) return;

  const showAll = () => els.forEach((el) => el.classList.add('is-in'));

  if (MOTION_REDUCED || typeof IntersectionObserver === 'undefined') {
    showAll();
    return;
  }

  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-in');
      io.unobserve(entry.target);
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });

  els.forEach((el) => io.observe(el));

  // Failsafe (see rule 3 above) — content visibility is never left to
  // depend on an observer firing correctly.
  setTimeout(showAll, 4000);
}

// Buttons drift slightly toward the cursor. Transform-only, so it can't
// shift layout or move the real click target far from the pointer.
function initMagnetic(root) {
  if (MOTION_REDUCED) return;
  if (typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches) return;

  root.querySelectorAll('.btn, .nav-book').forEach((el) => {
    let raf = null;

    el.addEventListener('pointerenter', () => { el.style.transition = ''; });

    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        el.style.transform = `translate(${(dx * 0.24).toFixed(1)}px, ${(dy * 0.3).toFixed(1)}px)`;
      });
    });

    el.addEventListener('pointerleave', () => {
      if (raf) cancelAnimationFrame(raf);
      el.style.transition = 'transform 0.45s cubic-bezier(.2,.9,.2,1)';
      el.style.transform = '';
      setTimeout(() => { el.style.transition = ''; }, 470);
    });
  });
}

if (typeof document !== 'undefined') primeReveals();

function renderSettings(root, settings, photos) {
  if (!settings) return;

  const igLink = root.querySelector('#footer-instagram');
  if (igLink && settings.instagramUrl) {
    igLink.setAttribute('href', settings.instagramUrl);
  }

  const heroIgLink = root.querySelector('#hero-instagram');
  if (heroIgLink && settings.instagramUrl) {
    heroIgLink.setAttribute('href', settings.instagramUrl);
  }

  const ttLink = root.querySelector('#footer-tiktok');
  if (ttLink && settings.tiktokUrl) {
    ttLink.setAttribute('href', settings.tiktokUrl);
  }

  const heroTtLink = root.querySelector('#hero-tiktok');
  if (heroTtLink && settings.tiktokUrl) {
    heroTtLink.setAttribute('href', settings.tiktokUrl);
  }

  renderHeroImages(root, settings.heroImages, photos);

  const copyright = root.querySelector('#footer-copyright');
  if (copyright && settings.footerText) {
    copyright.textContent = settings.footerText;
  }

  const emailLink = root.querySelector('#contact-email-link');
  if (emailLink && settings.contactEmail) {
    emailLink.setAttribute('href', `mailto:${settings.contactEmail}`);
    emailLink.textContent = settings.contactEmail;
  }

  const phoneLink = root.querySelector('#contact-phone-link');
  if (phoneLink && settings.contactPhoneHref) {
    phoneLink.setAttribute('href', `tel:${settings.contactPhoneHref}`);
    phoneLink.textContent = settings.contactPhoneDisplay || settings.contactPhoneHref;
  }

  renderContactMarquee(root, settings);

  // Read by wireContactForm at submit time — see there for why this
  // is a data attribute instead of a direct fetch target here.
  const contactForm = root.querySelector('#contact-form');
  if (contactForm && settings.sheetsWebhookUrl) {
    contactForm.dataset.sheetsWebhook = settings.sheetsWebhookUrl;
  }
}

async function fetchJson(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return res.json();
}

function wireNavToggle(root) {
  const toggle = root.querySelector('.nav-toggle');
  const navLinks = root.querySelector('.nav-links');
  if (!toggle || !navLinks) return;

  toggle.addEventListener('click', () => {
    const isOpen = navLinks.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(isOpen));
  });

  navLinks.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      navLinks.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });
}

// Native radio buttons can't be unchecked by clicking the already-
// selected one again — only by picking a different one. This makes
// the preset shoot-type pills work that way anyway: click a selected
// pill a second time and it clears back to "none chosen."
//
// Listens on each radio directly (not the label, not the group) —
// clicking a <label for="..."> fires its OWN click event and then
// forwards a second, separate click to the radio itself, so a
// group-level listener sees two events per tap and misfires. Only
// listening on the input sidesteps that.
//
// "Already selected" is captured on mousedown/keydown — before the
// browser's own default handling flips .checked to true — since by
// the time 'click' fires that's already happened and the element
// can't be asked its own pre-click state anymore. (Deliberately not
// using 'change' for this: it only fires on a real state flip, so
// clicking an already-checked radio again never fires one at all.)
function wireDeselectablePills(root) {
  root.querySelectorAll('.pill-group').forEach((group) => {
    const radioForLabel = (label) => document.getElementById(label.getAttribute('for'));

    const captureState = (radio) => {
      if (radio) radio.dataset.wasChecked = radio.checked ? '1' : '';
    };

    group.addEventListener('mousedown', (e) => {
      const label = e.target.closest('.pill-label');
      captureState(label ? radioForLabel(label) : (e.target.classList.contains('pill-radio') ? e.target : null));
    });

    group.querySelectorAll('.pill-radio').forEach((radio) => {
      radio.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter') captureState(radio);
      });

      radio.addEventListener('click', () => {
        if (radio.dataset.wasChecked === '1') radio.checked = false;
        delete radio.dataset.wasChecked;
      });
    });
  });
}

// Submits the booking form to two places at once over fetch, instead
// of a normal HTML form POST — the page never navigates away and
// (critically) nothing ever opens the visitor's own mail app the way
// a mailto: form action would:
//
// 1. Netlify Forms — a same-origin POST to "/". Only actually goes
//    anywhere once this site is deployed on Netlify; harmlessly fails
//    on any other host (like localhost). Netlify turns a submission
//    into an email itself, via that site's dashboard (Site settings >
//    Forms > Form notifications) — not this code.
// 2. A Google Sheet, via the Apps Script web app URL Sawyer/Jack set
//    up per google-apps-script/README.md and saved as
//    content/settings.json's sheetsWebhookUrl (see renderSettings,
//    which stashes it on the form as a data attribute). Skipped
//    entirely if that's not configured.
function wireContactForm(root) {
  const form = root.querySelector('#contact-form');
  if (!form) return;
  const status = root.querySelector('#form-status');
  const submitBtn = form.querySelector('button[type="submit"]');

  const setStatus = (text, kind) => {
    if (!status) return;
    status.textContent = text;
    status.className = 'form-status' + (kind ? ` is-${kind}` : '');
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    setStatus('Sending…', '');
    if (submitBtn) submitBtn.disabled = true;

    const formData = new FormData(form);
    const netlifyBody = new URLSearchParams(formData).toString();
    const sheetsWebhook = form.dataset.sheetsWebhook;

    const netlifyRequest = fetch('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: netlifyBody,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Netlify Forms failed (${res.status})`);
        return true;
      })
      .catch((err) => {
        console.error('[site] Netlify Forms submission failed:', err);
        return false;
      });

    // Apps Script web apps don't send back CORS headers we're allowed
    // to read cross-origin, so this request has to run in "no-cors"
    // mode — the request still reaches Google and still appends the
    // row, but the browser hides the response from us. "The fetch
    // didn't throw" is the only signal available here, not a real
    // confirmation. Skips entirely (resolves true) when unconfigured.
    const sheetsRequest = !sheetsWebhook
      ? Promise.resolve(true)
      : fetch(sheetsWebhook, {
          method: 'POST',
          mode: 'no-cors',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(Object.fromEntries(formData)),
        })
          .then(() => true)
          .catch((err) => {
            console.error('[site] Google Sheet submission failed:', err);
            return false;
          });

    Promise.all([netlifyRequest, sheetsRequest]).then(([netlifyOk, sheetsOk]) => {
      // When there's no Sheets webhook configured, that request was
      // never actually attempted (see sheetsRequest above) — don't let
      // its auto-resolved "true" count as a success signal on its own,
      // or a real Netlify failure would get silently reported as sent.
      const succeeded = sheetsWebhook ? (netlifyOk || sheetsOk) : netlifyOk;
      if (succeeded) {
        form.reset();
        setStatus("Thanks — that's sent. I'll get back to you soon.", 'ok');
      } else {
        setStatus('Something went wrong sending that — try the direct email or phone number below instead.', 'error');
      }
      if (submitBtn) submitBtn.disabled = false;
    });
  });
}

// Homepage-only: the arrow-paged "browse by category" row between
// Select Works and the About teaser. Reuses renderTileGrid (the same
// function that builds gallery.html's own category picker) against
// content/taxonomy.json's Sports branch, so adding/renaming a sport
// there is the only edit needed — nothing hardcoded here. The arrow
// buttons just scroll the row by one tile's width; native
// drag/trackpad scrolling works regardless since it's a real
// overflow-x container underneath.
async function renderHomeCategoryCarousel(root, photos) {
  const container = root.querySelector('#home-category-carousel');
  if (!container) return;
  let taxonomy;
  try {
    taxonomy = await fetchJson('content/taxonomy.json');
  } catch (err) {
    console.error('[site] category carousel failed to load taxonomy:', err);
    return;
  }
  const sportsNode = (taxonomy.tiles || []).find((t) => t.slug === 'sports');
  if (!sportsNode || !sportsNode.children || !sportsNode.children.length) return;
  renderTileGrid(container, sportsNode.children, photos);

  const wrap = container.closest('.category-carousel-wrap');
  if (!wrap) return;
  const prevBtn = wrap.querySelector('.carousel-arrow-prev');
  const nextBtn = wrap.querySelector('.carousel-arrow-next');
  const scrollByTile = (dir) => {
    const tile = container.querySelector('.category-tile, .placeholder-tile');
    const amount = tile ? tile.getBoundingClientRect().width + 12 : 260;
    container.scrollBy({ left: dir * amount, behavior: 'smooth' });
  };
  if (prevBtn) prevBtn.addEventListener('click', () => scrollByTile(-1));
  if (nextBtn) nextBtn.addEventListener('click', () => scrollByTile(1));
}

async function initPage() {
  const root = document;
  wireNavToggle(root);
  wireDeselectablePills(root);
  wireContactForm(root);
  initReveals(root);
  initMagnetic(root);

  const bentoContainer = root.querySelector('.bento-grid');
  const favoritesContainer = root.querySelector('.favorites-grid');
  const heroBgContainer = root.querySelector('#hero-bg-container');
  const categoryCarouselContainer = root.querySelector('#home-category-carousel');

  // Fetched early (and ahead of settings) whenever anything on this
  // page needs it — renderHeroImages uses it to look up each hero
  // photo's focus point, so settings can't render before this exists.
  let photos = [];
  if (bentoContainer || favoritesContainer || heroBgContainer || categoryCarouselContainer) {
    try {
      const photoData = await fetchJson('assets/photos/meta.json');
      photos = Array.isArray(photoData) ? photoData : (photoData.photos || []);
    } catch (err) {
      console.error('[site] photo gallery failed to load:', err);
    }
  }

  // Settings (Instagram link, footer text, contact info, hero photos)
  // apply on every page that has the matching elements.
  try {
    const settings = await fetchJson('content/settings.json');
    renderSettings(root, settings, photos);
  } catch (err) {
    console.error('[site] settings failed to load:', err);
  }

  if (bentoContainer) renderBento(bentoContainer, photos);
  if (favoritesContainer) renderFavorites(favoritesContainer, photos);
  if (categoryCarouselContainer) await renderHomeCategoryCarousel(root, photos);

  // gallery.html's tree of categories (Sports > High School > Football,
  // etc.) — see initGalleryTree above. No-ops on any page that doesn't
  // have a .taxonomy-root.
  await initGalleryTree(root);

  const homeRoot = root.querySelector('#hero-title');
  if (homeRoot) {
    try {
      const home = await fetchJson('content/home.json');
      renderHome(root, home);
    } catch (err) {
      console.error('[site] home content failed to load:', err);
    }
  }

  const contactPageRoot = root.querySelector('#contact-title');
  if (contactPageRoot) {
    try {
      const contactPageData = await fetchJson('content/contact-page.json');
      renderContactPage(root, contactPageData);
      renderServiceOptions(root, contactPageData.serviceOptions);
    } catch (err) {
      console.error('[site] booking page content failed to load:', err);
    }
  }

  const aboutRoot = root.querySelector('#about-bio, #about-portrait, #about-heading');
  if (aboutRoot) {
    try {
      const about = await fetchJson('content/about.json');
      renderAbout(root, about);
    } catch (err) {
      console.error('[site] about content failed to load:', err);
    }
  }
}

if (typeof document !== 'undefined') {
  // admin-loader.js awaits this before adding any edit-mode affordances,
  // so it never races the normal render — it only ever augments a page
  // that's already fully drawn. Harmless for every logged-out visitor,
  // who never reads this property at all.
  document.addEventListener('DOMContentLoaded', () => {
    window.__sitePageReady = initPage();
  });
}

// Expose the pure render functions for local testing in Node
// (see /content/README or the test script used during setup).
// Harmless in the browser: `module` doesn't exist there, so this
// whole block is skipped.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderBento, renderFavorites, renderGallery, renderAbout, renderHome, renderContactPage, renderServiceOptions, renderHeroImages, renderSettings, photoObjectPositionAttr, wideFocus,
    escapeHtml, photoIdSlug, photoImgSrc,
    assignTaxonomyPaths, findPathForCategory, pickRepresentativePhoto,
    renderTileGrid, renderPlaceholderIcons, renderCategoryHero, renderCrumbTrail,
  };
}
