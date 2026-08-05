// Inline edit mode — only ever loaded by admin-loader.js after a
// session check passes, so this file never runs for a logged-out
// visitor. It augments the DOM script.js already rendered rather than
// building its own separate UI: same pages, same look, just with
// edit affordances layered on top.
//
// Every save goes through /api/content or /api/photos (see
// netlify/functions/), which commits directly to GitHub. Netlify then
// rebuilds/redeploys (~30-60s) — so after a successful save this file
// updates the page from the data it just sent, not a re-fetch (a
// re-fetch would still return the pre-deploy JSON and look like the
// edit silently failed).

(function () {
  'use strict';

  let photos = [];
  let taxonomyData = { tiles: [] }; // full parsed taxonomy.json — taxonomyTiles is just taxonomyData.tiles (same array reference), kept as its own variable since it's referenced everywhere below
  let taxonomyTiles = [];
  let selectMode = false;
  const selectedSlugs = new Set();
  let settings = {};
  let currentLeafNode = null; // set on gallery.html when viewing a specific category
  let currentBranchNode = null; // set on gallery.html when viewing a tile-grid level

  // ---------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------

  async function apiPost(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data = {};
    try { data = await res.json(); } catch (err) { /* ignore */ }
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  }

  function setStatus(text, kind) {
    const el = document.querySelector('.admin-bar-status');
    if (!el) return;
    el.textContent = text;
    el.className = 'admin-bar-status' + (kind ? ` is-${kind}` : '');
  }

  // Netlify rejects a function request body over 6MB before our code
  // ever runs (a bare 400 with no JSON body, so the user just sees
  // "Request failed"). Web-sized photos average ~0.9MB once base64'd,
  // so anything past ~6 photos blows the cap — pack uploads into
  // requests well under it. The photos are committed together
  // afterwards, so any number of chunks is still one deploy.
  const MAX_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;

  function chunkByPayloadSize(items, maxBytes) {
    const chunks = [];
    let current = [];
    let size = 0;
    items.forEach((item) => {
      const bytes = item.imageBase64.length;
      // A single photo bigger than the budget still gets its own
      // request rather than being dropped — best we can do, and
      // resizeImageFile keeps them well under the cap in practice.
      if (current.length && size + bytes > maxBytes) {
        chunks.push(current);
        current = [];
        size = 0;
      }
      current.push(item);
      size += bytes;
    });
    if (current.length) chunks.push(current);
    return chunks;
  }

  function slugify(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  function uniqueSlug(category, hint) {
    const base = slugify(category) + '-' + (slugify(hint) || Date.now().toString(36));
    let slug = base;
    let n = 2;
    const taken = new Set(photos.map((p) => p.slug));
    while (taken.has(slug)) {
      slug = `${base}-${n}`;
      n += 1;
    }
    return slug;
  }

  // Resizes/compresses an image file client-side before it ever
  // leaves the browser — keeps uploads fast on a phone connection and
  // stays well under Netlify Functions' request-size limit. Returns a
  // base64 data URL.
  function resizeImageFile(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height >= width && height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob) { reject(new Error('Could not process that image')); return; }
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Could not read that image'));
            reader.readAsDataURL(blob);
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not open that image')); };
      img.src = url;
    });
  }

  // Walks the taxonomy for the category dropdown (Add/Edit Photo). Two
  // different branches can have a leaf with the same label — "Football"
  // exists under High School, College, and Professional — so a leaf
  // only gets its parent's name prefixed when its bare label would
  // otherwise collide with another leaf somewhere else in the tree.
  function collectLeafCategories(nodes) {
    const raw = [];
    (function walk(list, parentLabel) {
      (list || []).forEach((node) => {
        if (node.category) raw.push({ value: node.category, label: node.label, parentLabel });
        if (node.children) walk(node.children, node.label);
      });
    })(nodes, null);

    const counts = {};
    raw.forEach((c) => { counts[c.label] = (counts[c.label] || 0) + 1; });

    return raw.map((c) => ({
      value: c.value,
      label: counts[c.label] > 1 && c.parentLabel ? `${c.parentLabel} ${c.label}` : c.label,
    }));
  }

  // Mirrors script.js's taxonomy-path resolution (see initGalleryTree)
  // so admin.js knows, on gallery.html, whether the current view is a
  // specific category (a "leaf") or a tile grid (a "branch") — needed
  // to refresh the right thing after a photo edit, and to preselect a
  // sensible category when adding a new photo.
  function resolveCurrentGalleryNode() {
    if (!document.querySelector('.taxonomy-root')) return;
    const pathParam = new URLSearchParams(location.search).get('path') || '';
    const parts = pathParam ? pathParam.split('/').filter(Boolean) : [];
    let nodes = taxonomyTiles;
    let node = null;
    for (const part of parts) {
      const found = (nodes || []).find((n) => n.slug === part);
      if (!found) { node = null; break; }
      node = found;
      nodes = found.children;
    }
    if (node && node.category) {
      currentLeafNode = node;
      currentBranchNode = null;
    } else {
      currentLeafNode = null;
      currentBranchNode = node || { children: taxonomyTiles, isRoot: true };
    }
  }

  // ---------------------------------------------------------------
  // Refreshing the page after a save, from in-memory data (never a
  // re-fetch — see the top-of-file note on why).
  // ---------------------------------------------------------------

  function refreshAfterPhotoChange() {
    const bentoEl = document.querySelector('.bento-grid');
    if (bentoEl) { renderBento(bentoEl, photos); }
    const favEl = document.querySelector('.favorites-grid');
    if (favEl) { renderFavorites(favEl, photos); }

    if (document.querySelector('.taxonomy-root')) {
      resolveCurrentGalleryNode();
      if (currentLeafNode) {
        const grid = document.querySelector('.gallery-grid');
        const inCategory = photos.filter((p) => p.category === currentLeafNode.category);
        if (grid) {
          grid.hidden = false;
          renderGallery(grid, inCategory);
        }
        const heroSlot = document.querySelector('.category-hero-slot');
        if (heroSlot) renderCategoryHero(heroSlot, currentLeafNode, photos);
      } else if (currentBranchNode) {
        const tilesEl = document.querySelector('.category-tiles-slot');
        if (tilesEl && !currentBranchNode.placeholder) {
          renderTileGrid(tilesEl, currentBranchNode.children || taxonomyTiles, photos);
        }
      }
    }

    attachAllOverlays();
  }

  // ---------------------------------------------------------------
  // Photo tile overlays (bento/favorites/gallery items)
  // ---------------------------------------------------------------

  function findPhotoBySlug(slug) {
    return photos.find((p) => p.slug === slug);
  }

  // Every rendered photo tile carries an <img> whose src ends with
  // "<slug>.jpg" (see script.js's photoImgSrc) — that's the only
  // reliable way back to the underlying meta.json entry from the
  // rendered DOM, since the tile markup itself varies by type.
  function slugFromTile(tile) {
    const img = tile.querySelector('img');
    if (!img) return null;
    const src = img.getAttribute('src') || '';
    const match = src.match(/([^/]+)\.jpg(?:\?.*)?$/);
    return match ? match[1] : null;
  }

  function attachAllOverlays() {
    document.querySelectorAll('.bento-item, .favorite-item, .gallery-item').forEach(attachTileOverlay);
    if (document.querySelector('.gallery-grid')) wireDragReorder(document.querySelector('.gallery-grid'));
    wireCategoryHeroEditing();
    wireGalleryLabelEditing();
    wireCategoryTileCovers();
    wireSectionManagement();
  }

  // A branch (Sports, Beyond The Action, High School, ...) has no
  // hero page of its own — it only ever shows as a tile grid — so
  // unlike a leaf category it has nowhere to put a "Change cover
  // photo" button except right on the tile itself. Placeholder nodes
  // (Projects, Senior Photos, Cars, ...) get the button too: they have
  // no category to pull a representative photo from, so an explicit
  // cover photo is the *only* way to give them a title card, and
  // renderTileGrid now honours a coverSlug on a placeholder.
  function wireCategoryTileCovers() {
    if (!currentBranchNode || currentBranchNode.placeholder) return;
    const children = currentBranchNode.children || taxonomyTiles;
    const tiles = Array.from(document.querySelectorAll('.category-tile, .placeholder-tile'));
    children.forEach((child, i) => {
      const tile = tiles[i];
      if (!tile || tile.dataset.coverWired) return;
      tile.dataset.coverWired = 'true';
      tile.style.position = tile.style.position || 'relative';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'admin-tile-cover-btn';
      btn.textContent = 'Cover photo';
      btn.title = "Change this section's cover photo";
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openCoverPhotoPicker(child, refreshTileGrid);
      });
      tile.appendChild(btn);
    });
  }

  function refreshTileGrid() {
    const tilesEl = document.querySelector('.category-tiles-slot');
    if (tilesEl && currentBranchNode && !currentBranchNode.placeholder) {
      renderTileGrid(tilesEl, currentBranchNode.children || taxonomyTiles, photos);
      attachAllOverlays();
    }
  }

  // ---------------------------------------------------------------
  // Adding/removing whole sections — not just editing photos within
  // one, but the section itself (a new sport, or one nobody shoots
  // anymore). Works at any branch level, including the root Gallery
  // page, since a new section there just becomes a sibling of
  // "Sports"/"Beyond The Action" the same way a new sport becomes a
  // sibling of "Football"/"Basketball".
  // ---------------------------------------------------------------

  function wireSectionManagement() {
    if (!currentBranchNode || currentBranchNode.placeholder) return;
    const tilesEl = document.querySelector('.category-tiles-slot');
    if (!tilesEl) return;

    if (!tilesEl.dataset.addSectionWired) {
      tilesEl.dataset.addSectionWired = 'true';
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'btn admin-inline-save';
      addBtn.textContent = '+ Add Section';
      addBtn.addEventListener('click', openAddSectionModal);
      tilesEl.insertAdjacentElement('beforebegin', addBtn);
    }

    // Tiles get destroyed/rebuilt independently of the add button
    // (any renderTileGrid call, e.g. from an unrelated photo edit) —
    // always re-wire whatever's currently on screen, same reasoning
    // as wireCategoryTileCovers above.
    const children = currentBranchNode.children || taxonomyTiles;
    const tiles = Array.from(tilesEl.querySelectorAll('.category-tile, .placeholder-tile'));
    children.forEach((child, i) => {
      const tile = tiles[i];
      if (!tile || tile.dataset.deleteSectionWired) return;
      tile.dataset.deleteSectionWired = 'true';
      tile.style.position = tile.style.position || 'relative';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'admin-section-delete';
      del.textContent = '×';
      del.title = 'Delete this section';
      del.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        deleteSection(child);
      });
      tile.appendChild(del);
    });
  }

  function collectAllCategories(nodes, acc) {
    acc = acc || [];
    (nodes || []).forEach((node) => {
      if (node.category) acc.push(node.category);
      if (node.children) collectAllCategories(node.children, acc);
    });
    return acc;
  }

  function openAddSectionModal() {
    const backdrop = document.createElement('div');
    backdrop.className = 'admin-modal-backdrop';
    backdrop.innerHTML = `
      <div class="admin-modal">
        <h2>Add Section</h2>
        <p class="admin-error"></p>
        <label>Name</label>
        <input type="text" class="admin-section-name" placeholder="e.g. Soccer" required>
        <div class="admin-modal-actions">
          <button type="button" class="btn admin-modal-cancel">Cancel</button>
          <button type="button" class="btn admin-modal-save">Add</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('.admin-modal-cancel').addEventListener('click', close);

    const input = backdrop.querySelector('.admin-section-name');
    input.focus();

    backdrop.querySelector('.admin-modal-save').addEventListener('click', async () => {
      const errorEl = backdrop.querySelector('.admin-error');
      const name = input.value.trim();
      if (!name) { errorEl.textContent = 'Name is required.'; return; }

      const siblings = currentBranchNode.children || taxonomyTiles;
      const takenSlugs = new Set(siblings.map((s) => s.slug));
      let slug = slugify(name) || 'section';
      let n = 2;
      while (takenSlugs.has(slug)) { slug = `${slugify(name)}-${n}`; n += 1; }

      // Category values must be unique across the WHOLE tree, not
      // just this node's siblings, since a photo's category matches
      // regardless of where in the tree that category lives.
      const allCategories = new Set(collectAllCategories(taxonomyTiles));
      const baseCategory = slugify(name) || 'section';
      let category = (allCategories.has(baseCategory) && currentBranchNode.label)
        ? slugify(`${currentBranchNode.label}-${name}`)
        : baseCategory;
      let cn = 2;
      while (allCategories.has(category)) { category = `${baseCategory}-${cn}`; cn += 1; }

      const newNode = { slug, label: name, category };
      siblings.push(newNode);

      setStatus('Saving…');
      try {
        await apiPost('/api/content', { file: 'taxonomy', data: taxonomyData });
        close();
        setStatus('Saved — may take up to a minute to show for other visitors.', 'ok');
        refreshTileGrid();
      } catch (err) {
        siblings.pop();
        errorEl.textContent = err.message || 'Save failed, try again.';
      }
    });
  }

  function deleteSection(child) {
    if (Array.isArray(child.children) && child.children.length) {
      setStatus("Remove what's inside this section first, then delete it.", 'error');
      return;
    }
    const photoCount = child.category ? photos.filter((p) => p.category === child.category).length : 0;
    if (photoCount > 0) {
      setStatus(`This section still has ${photoCount} photo${photoCount === 1 ? '' : 's'} — move or delete ${photoCount === 1 ? 'it' : 'them'} first.`, 'error');
      return;
    }
    if (!window.confirm(`Delete "${child.label}"? This can't be undone.`)) return;

    const siblings = currentBranchNode.children || taxonomyTiles;
    const idx = siblings.indexOf(child);
    if (idx === -1) return;
    siblings.splice(idx, 1);

    setStatus('Saving…');
    apiPost('/api/content', { file: 'taxonomy', data: taxonomyData })
      .then(() => {
        setStatus('Deleted — may take up to a minute to disappear for other visitors.', 'ok');
        refreshTileGrid();
      })
      .catch((err) => {
        siblings.splice(idx, 0, child);
        setStatus(err.message || 'Delete failed, try again.', 'error');
      });
  }

  // ---------------------------------------------------------------
  // Gallery section names — the big page title (root "Gallery",
  // "Sports", "Football", ...) plus every tile label shown in a
  // branch's grid, saved together as one batch per view.
  // ---------------------------------------------------------------

  function wireGalleryLabelEditing() {
    if (!currentLeafNode && !currentBranchNode) return;

    // Tile labels can be destroyed/recreated independently of the
    // title and save button (e.g. an unrelated photo edit refreshes
    // the grid via renderTileGrid) — always make sure whatever's
    // currently on screen is editable, regardless of the title's own
    // wired state below.
    if (currentBranchNode && !currentBranchNode.placeholder) {
      document.querySelectorAll('.tile-label-text').forEach((el) => {
        if (el.dataset.adminWired) return;
        el.dataset.adminWired = 'true';
        el.contentEditable = 'true';
        el.classList.add('admin-editable');
      });
    }

    const titleEl = currentLeafNode
      ? document.querySelector('.category-hero-title')
      : document.querySelector('.tree-title');
    if (!titleEl || titleEl.dataset.adminWired) return;
    titleEl.dataset.adminWired = 'true';
    titleEl.contentEditable = 'true';
    titleEl.classList.add('admin-editable');

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn admin-inline-save';
    saveBtn.textContent = 'Save Section Names';
    titleEl.insertAdjacentElement('afterend', saveBtn);

    saveBtn.addEventListener('click', async () => {
      const newTitle = titleEl.textContent.trim();
      if (!newTitle) { setStatus('Name cannot be empty.', 'error'); return; }
      setStatus('Saving…');

      const previousTitle = currentLeafNode
        ? currentLeafNode.label
        : (currentBranchNode.isRoot ? taxonomyData.rootLabel : currentBranchNode.label);
      if (currentLeafNode) currentLeafNode.label = newTitle;
      else if (currentBranchNode.isRoot) taxonomyData.rootLabel = newTitle;
      else currentBranchNode.label = newTitle;

      // Re-derive tile targets fresh at save time rather than trusting
      // a closure captured at wire-time — the grid may have been
      // rebuilt any number of times since this button was created.
      const children = (currentBranchNode && !currentBranchNode.placeholder) ? (currentBranchNode.children || taxonomyTiles) : [];
      const tileEls = Array.from(document.querySelectorAll('.tile-label-text'));
      const tileTargets = children.map((child, i) => ({ node: child, el: tileEls[i] })).filter((t) => t.el);
      const previousTileLabels = tileTargets.map((t) => t.node.label);
      tileTargets.forEach((t) => {
        const text = t.el.textContent.trim();
        if (text) t.node.label = text;
      });

      try {
        await apiPost('/api/content', { file: 'taxonomy', data: taxonomyData });
        const crumbCurrent = document.querySelector('.crumb-current');
        if (crumbCurrent) crumbCurrent.textContent = newTitle;
        setStatus('Saved — may take up to a minute to show for other visitors.', 'ok');
      } catch (err) {
        if (currentLeafNode) currentLeafNode.label = previousTitle;
        else if (currentBranchNode.isRoot) taxonomyData.rootLabel = previousTitle;
        else currentBranchNode.label = previousTitle;
        tileTargets.forEach((t, i) => { t.node.label = previousTileLabels[i]; });
        setStatus(err.message || 'Save failed, try again.', 'error');
      }
    });
  }

  // ---------------------------------------------------------------
  // Category hero "cover photo" (gallery.html leaf pages) — the same
  // node.coverSlug also drives the tile icon shown for this category
  // wherever it's listed on its parent's page (see script.js's
  // pickRepresentativePhoto), so this one control covers both asks.
  // ---------------------------------------------------------------

  function wireCategoryHeroEditing() {
    if (!currentLeafNode) return;
    // .category-hero-bg is absolutely positioned with a negative inset
    // for the parallax drift, so it extends beyond the visible,
    // clipped hero area — anchoring the button to it directly can push
    // it outside the viewport. Use .category-hero (already
    // position:relative + overflow:hidden) as the actual anchor
    // instead, and just use "bg" — which script.js rebuilds fresh on
    // every renderCategoryHero call — as the re-wire signal.
    const hero = document.querySelector('.category-hero');
    const bg = document.querySelector('.category-hero-bg');
    if (!hero || !bg || bg.dataset.adminWired) return;
    bg.dataset.adminWired = 'true';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'admin-cover-edit-btn';
    btn.textContent = 'Change cover photo';
    btn.addEventListener('click', () => openCoverPhotoPicker(currentLeafNode, refreshHero, true));
    hero.appendChild(btn);
  }

  function refreshHero(node) {
    const heroSlot = document.querySelector('.category-hero-slot');
    if (heroSlot) {
      renderCategoryHero(heroSlot, node, photos);
      attachAllOverlays();
    }
  }

  // node.category (a leaf, e.g. Football) scopes the picker to that
  // category's own photos, same as before. A branch node (Sports,
  // Beyond The Action, ...) has no category of its own, so it shows
  // every photo on the site instead — there's no natural subset to
  // limit it to. `refresh` lets the caller redraw whatever actually
  // displays this node's cover (a hero page for a leaf, a tile grid
  // for a branch or a leaf being edited from its parent's listing).
  // isHero marks the leaf-hero-banner entry point (a wide crop) as
  // opposed to the branch-tile entry point (a square-ish crop) — only
  // the hero case gets a framing control, since that's the only one of
  // the two that renders at a different aspect ratio than a photo's
  // regular focus point already covers.
  function openCoverPhotoPicker(node, refresh, isHero) {
    const pool = node.category ? photos.filter((p) => p.category === node.category) : photos;
    if (!pool.length) {
      setStatus('No photos yet to choose from.', 'error');
      return;
    }

    const backdrop = document.createElement('div');
    backdrop.className = 'admin-modal-backdrop';
    backdrop.innerHTML = `
      <div class="admin-modal">
        <h2>Cover Photo</h2>
        <p class="admin-error"></p>
        <div class="admin-cover-picker-grid"></div>
        ${isHero ? '<div class="admin-hero-framing"></div>' : ''}
        <div class="admin-modal-actions">
          <button type="button" class="btn admin-modal-cancel">Cancel</button>
          ${isHero ? '<button type="button" class="btn admin-modal-save">Save</button>' : ''}
          <button type="button" class="btn admin-cover-reset">Use automatic</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('.admin-modal-cancel').addEventListener('click', close);

    const grid = backdrop.querySelector('.admin-cover-picker-grid');
    let selectedSlug = node.coverSlug || '';
    let focusEditor = null;
    const framingEl = isHero ? backdrop.querySelector('.admin-hero-framing') : null;

    function renderFraming() {
      if (!framingEl) return;
      framingEl.innerHTML = '';
      focusEditor = null;
      const target = (selectedSlug && findPhotoBySlug(selectedSlug)) || pool[0];
      if (!target) return;
      const startX = typeof target.heroFocusX === 'number' ? target.heroFocusX : target.focusX;
      const startY = typeof target.heroFocusY === 'number' ? target.heroFocusY : target.focusY;
      focusEditor = createFocusEditor(photoImgSrc(target), startX, startY, 'ratio-wide');
      framingEl.appendChild(focusEditor.element);
    }

    pool.forEach((photo) => {
      const item = document.createElement('button');
      item.type = 'button';
      if (photo.slug === node.coverSlug) item.className = 'is-selected';
      item.innerHTML = `<img src="${photoImgSrc(photo)}" alt="">`;
      item.addEventListener('click', () => {
        if (isHero) {
          selectedSlug = photo.slug;
          Array.from(grid.children).forEach((el, i) => { el.className = pool[i].slug === selectedSlug ? 'is-selected' : ''; });
          renderFraming();
        } else {
          saveCoverPhoto(node, photo.slug, close, refresh);
        }
      });
      grid.appendChild(item);
    });
    if (isHero) renderFraming();

    if (isHero) {
      backdrop.querySelector('.admin-modal-save').addEventListener('click', () => {
        saveCoverPhoto(node, selectedSlug, close, refresh, focusEditor ? focusEditor.getFocus() : null);
      });
    }

    backdrop.querySelector('.admin-cover-reset').addEventListener('click', () => saveCoverPhoto(node, '', close, refresh));
  }

  async function saveCoverPhoto(node, coverSlug, close, refresh, heroFocus) {
    setStatus('Saving…');
    const previous = node.coverSlug;
    const previousPhotos = photos;
    if (coverSlug) node.coverSlug = coverSlug; else delete node.coverSlug;
    const nextPhotos = (heroFocus && coverSlug)
      ? photos.map((p) => (p.slug === coverSlug ? { ...p, heroFocusX: heroFocus.x, heroFocusY: heroFocus.y } : p))
      : photos;
    try {
      // Two separate apiPost calls here (taxonomy.json, then meta.json
      // only when a focus point came with the pick) meant picking a
      // cover photo with custom framing cost 30 credits instead of 15
      // — same bug as the hero-photo picker had, same `also` fix.
      if (nextPhotos !== photos) {
        await apiPost('/api/content', {
          file: 'taxonomy',
          data: taxonomyData,
          also: { file: 'meta', data: { photos: nextPhotos } },
        });
        photos = nextPhotos;
      } else {
        await apiPost('/api/content', { file: 'taxonomy', data: taxonomyData });
      }
      close();
      setStatus('Saved — may take up to a minute to show for other visitors.', 'ok');
      if (refresh) refresh(node);
    } catch (err) {
      if (previous) node.coverSlug = previous; else delete node.coverSlug;
      photos = previousPhotos;
      setStatus(err.message || 'Save failed, try again.', 'error');
    }
  }

  function attachTileOverlay(tile) {
    if (tile.dataset.adminWired) return;
    tile.dataset.adminWired = 'true';

    const slug = slugFromTile(tile);
    if (!slug) return;

    // Stop the tile's normal behavior (navigation / lightbox) while
    // logged in — edit mode replaces it with the edit panel.
    tile.addEventListener('click', (e) => {
      if (e.target.closest('.admin-tile-delete')) return;
      e.preventDefault();
      e.stopPropagation();
      if (selectMode) { toggleTileSelection(tile, slug); return; }
      const photo = findPhotoBySlug(slug);
      if (photo) openPhotoModal({ mode: 'edit', photo });
    }, true);

    const wrap = document.createElement('div');
    wrap.className = 'admin-tile-overlay';
    wrap.innerHTML = '<span class="admin-tile-edit-badge">Edit</span>';
    tile.style.position = tile.style.position || 'relative';
    tile.appendChild(wrap);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'admin-tile-delete';
    del.textContent = '×';
    del.title = 'Delete this photo';
    del.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const photo = findPhotoBySlug(slug);
      if (photo) deletePhoto(photo);
    });
    tile.appendChild(del);
  }

  // ---------------------------------------------------------------
  // Drag reorder (gallery.html leaf pages — one category at a time)
  // ---------------------------------------------------------------

  function wireDragReorder(grid) {
    if (grid.dataset.adminDragWired) return;
    grid.dataset.adminDragWired = 'true';

    let draggingSlug = null;

    grid.querySelectorAll('.gallery-item').forEach((item) => {
      item.setAttribute('draggable', 'true');
      const handle = document.createElement('div');
      handle.className = 'admin-drag-handle';
      handle.textContent = '↕';
      handle.title = 'Drag to reorder';
      item.appendChild(handle);

      item.addEventListener('dragstart', (e) => {
        draggingSlug = slugFromTile(item);
        item.classList.add('admin-dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('admin-dragging');
        draggingSlug = null;
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dragging = grid.querySelector('.admin-dragging');
        if (!dragging || dragging === item) return;
        const rect = item.getBoundingClientRect();
        const before = (e.clientX - rect.left) < rect.width / 2;
        grid.insertBefore(dragging, before ? item : item.nextSibling);
      });
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!draggingSlug) return;
        commitReorderFromDom(grid);
      });
    });
  }

  // Reads the grid's current (drag-updated) DOM order, figures out
  // the matching new order within the full meta.json array (only this
  // category's entries move — everything else keeps its position),
  // and saves it.
  function commitReorderFromDom(grid) {
    if (!currentLeafNode) return;
    const domSlugs = [...grid.querySelectorAll('.gallery-item')].map(slugFromTile).filter(Boolean);
    const inCategory = domSlugs.map(findPhotoBySlug).filter(Boolean);
    let cursor = 0;
    const next = photos.map((p) => (p.category === currentLeafNode.category ? inCategory[cursor++] : p));
    savePhotosList(next, 'Reorder photos');
  }

  // ---------------------------------------------------------------
  // Add / edit / delete a photo
  // ---------------------------------------------------------------

  function savePhotosList(next, statusLabel) {
    setStatus('Saving…');
    return apiPost('/api/content', { file: 'meta', data: { photos: next } })
      .then(() => {
        photos = next;
        setStatus('Saved — may take up to a minute to show for other visitors.', 'ok');
        refreshAfterPhotoChange();
      })
      .catch((err) => {
        setStatus(err.message || 'Save failed', 'error');
        throw err;
      });
  }

  function deletePhoto(photo) {
    if (!window.confirm(`Delete "${photo.caption || photo.slug}"? This can't be undone.`)) return;
    setStatus('Deleting…');
    const next = photos.filter((p) => p.slug !== photo.slug);
    apiPost('/api/content', { file: 'meta', data: { photos: next }, deleteImageSlug: photo.slug })
      .then(() => {
        photos = next;
        setStatus('Deleted — may take up to a minute to disappear for other visitors.', 'ok');
        refreshAfterPhotoChange();
      })
      .catch((err) => setStatus(err.message || 'Delete failed', 'error'));
  }

  // ---------------------------------------------------------------
  // Multi-select delete — a single delete already cost 2 commits
  // (image + meta.json); selecting several and deleting together
  // ships as one commit total via /api/photos's batchDelete, same
  // pattern as the batch-add flow above deletePhoto.
  // ---------------------------------------------------------------

  function updateSelectBar() {
    const countEl = document.querySelector('.admin-select-count');
    const deleteBtn = document.querySelector('.admin-select-delete');
    if (!countEl || !deleteBtn) return;
    countEl.hidden = !selectMode;
    deleteBtn.hidden = !selectMode;
    countEl.textContent = `${selectedSlugs.size} selected`;
    deleteBtn.disabled = selectedSlugs.size === 0;
  }

  function toggleTileSelection(tile, slug) {
    if (selectedSlugs.has(slug)) {
      selectedSlugs.delete(slug);
      tile.classList.remove('is-selected');
    } else {
      selectedSlugs.add(slug);
      tile.classList.add('is-selected');
    }
    updateSelectBar();
  }

  function setSelectMode(on) {
    selectMode = on;
    const btn = document.querySelector('.admin-bar-select');
    if (btn) {
      btn.textContent = selectMode ? 'Cancel Select' : 'Select';
      btn.classList.toggle('is-active', selectMode);
    }
    if (!selectMode) {
      selectedSlugs.clear();
      document.querySelectorAll('.is-selected').forEach((el) => el.classList.remove('is-selected'));
    }
    updateSelectBar();
  }

  async function deleteSelectedPhotos() {
    const slugs = Array.from(selectedSlugs);
    if (!slugs.length) return;
    if (!window.confirm(`Delete ${slugs.length} photo${slugs.length === 1 ? '' : 's'}? This can't be undone.`)) return;
    setStatus('Deleting…');
    try {
      await apiPost('/api/photos', { batchDelete: slugs });
      const slugSet = new Set(slugs);
      photos = photos.filter((p) => !slugSet.has(p.slug));
      setSelectMode(false);
      setStatus(`Deleted ${slugs.length} photo${slugs.length === 1 ? '' : 's'} — may take up to a minute to disappear for other visitors.`, 'ok');
      refreshAfterPhotoChange();
    } catch (err) {
      setStatus(err.message || 'Delete failed', 'error');
    }
  }

  // A draggable crop preview: renders the photo with the browser's real
  // object-fit:cover behavior at the given aspect ratio, so dragging shows
  // exactly what will be visible wherever this photo is cropped elsewhere.
  function createFocusEditor(imgSrc, initFocusX, initFocusY, ratioClass) {
    let focusX = typeof initFocusX === 'number' ? initFocusX : 50;
    let focusY = typeof initFocusY === 'number' ? initFocusY : 50;

    const wrap = document.createElement('div');
    wrap.className = `admin-focus-box ${ratioClass}`;
    wrap.innerHTML = `<img src="${imgSrc}" alt="" draggable="false" style="object-position: ${focusX}% ${focusY}%">`;
    const img = wrap.querySelector('img');

    let dragging = false;
    const updateFromEvent = (e) => {
      const rect = wrap.getBoundingClientRect();
      focusX = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
      focusY = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
      img.style.objectPosition = `${focusX}% ${focusY}%`;
    };
    wrap.addEventListener('pointerdown', (e) => {
      dragging = true;
      wrap.setPointerCapture(e.pointerId);
      updateFromEvent(e);
    });
    wrap.addEventListener('pointermove', (e) => { if (dragging) updateFromEvent(e); });
    const stopDrag = () => { dragging = false; };
    wrap.addEventListener('pointerup', stopDrag);
    wrap.addEventListener('pointercancel', stopDrag);

    return {
      element: wrap,
      getFocus: () => ({ x: Math.round(focusX), y: Math.round(focusY) }),
    };
  }

  function openPhotoModal({ mode, photo }) {
    const categories = collectLeafCategories(taxonomyTiles);
    const defaultCategory = photo ? photo.category : (currentLeafNode ? currentLeafNode.category : (categories[0] && categories[0].value));

    const backdrop = document.createElement('div');
    backdrop.className = 'admin-modal-backdrop';
    backdrop.innerHTML = `
      <div class="admin-modal">
        <h2>${mode === 'edit' ? 'Edit Photo' : 'Add Photo'}</h2>
        <p class="admin-error"></p>
        ${photo ? `
          <label>Framing</label>
          <div class="admin-focus-slot"></div>
          <p class="admin-hint">Drag the photo to choose what stays in frame when it's cropped (hero background, cover photos, thumbnails).</p>
        ` : ''}
        <label>${photo ? 'Replace photo (optional)' : 'Photo (choose several to add them all at once)'}</label>
        <input type="file" accept="image/*" class="admin-photo-file" ${photo ? '' : 'required multiple'}>
        <label>Caption (optional)</label>
        <input type="text" class="admin-photo-caption" value="${(photo && photo.caption) ? escapeAttr(photo.caption) : ''}">
        <label>Category</label>
        <select class="admin-photo-category">
          ${categories.map((c) => `<option value="${escapeAttr(c.value)}" ${c.value === defaultCategory ? 'selected' : ''}>${escapeAttr(c.label)}</option>`).join('')}
        </select>
        <label>Featured homepage tile (optional)</label>
        <select class="admin-photo-slot">
          <option value="">Not featured</option>
          ${'abcdefgh'.split('').map((s) => `<option value="${s}" ${photo && photo.bentoSlot === s ? 'selected' : ''}>Tile ${s.toUpperCase()}</option>`).join('')}
        </select>
        <div class="admin-modal-actions">
          <button type="button" class="btn admin-modal-cancel">Cancel</button>
          <button type="button" class="btn admin-modal-save">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('.admin-modal-cancel').addEventListener('click', close);

    let focusEditor = null;
    if (photo) {
      const src = `${photo.image || `assets/photos/${photo.slug}.jpg`}${photo.v ? `?v=${photo.v}` : ''}`;
      focusEditor = createFocusEditor(src, photo.focusX, photo.focusY, 'ratio-standard');
      backdrop.querySelector('.admin-focus-slot').appendChild(focusEditor.element);
    }

    if (!photo) {
      backdrop.querySelector('.admin-photo-file').addEventListener('change', (e) => {
        if (e.target.files.length > 1) {
          const files = Array.from(e.target.files);
          close();
          openBatchPhotoModal(files);
        }
      });
    }

    backdrop.querySelector('.admin-modal-save').addEventListener('click', async () => {
      const errorEl = backdrop.querySelector('.admin-error');
      const saveBtn = backdrop.querySelector('.admin-modal-save');
      const fileInput = backdrop.querySelector('.admin-photo-file');
      const caption = backdrop.querySelector('.admin-photo-caption').value.trim();
      const category = backdrop.querySelector('.admin-photo-category').value;
      const bentoSlot = backdrop.querySelector('.admin-photo-slot').value;
      const file = fileInput.files[0];

      errorEl.textContent = '';
      if (!photo && !file) { errorEl.textContent = 'Choose a photo.'; return; }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        if (file) {
          const imageBase64 = await resizeImageFile(file, 2400, 0.85);
          const slug = photo ? photo.slug : uniqueSlug(category, caption);
          setStatus('Uploading…');
          await apiPost('/api/photos', {
            imageBase64, slug, category, caption, bentoSlot, replace: !!photo,
          });
          // v mirrors what photos.js just stamped server-side, so the
          // optimistic local refresh below also cache-busts correctly.
          // No focusX/focusY here — a replaced image is different
          // content, so carrying over a focus point set against the
          // old picture wouldn't line up with the new one.
          const entry = { slug, category, caption, bentoSlot, v: Date.now() };
          let next;
          if (photo) {
            next = photos.map((p) => (p.slug === photo.slug ? entry : (bentoSlot && p.bentoSlot === bentoSlot ? { ...p, bentoSlot: '' } : p)));
          } else {
            next = photos.map((p) => (bentoSlot && p.bentoSlot === bentoSlot ? { ...p, bentoSlot: '' } : p)).concat(entry);
          }
          photos = next;
          setStatus('Saved — may take up to a minute to show for other visitors.', 'ok');
          refreshAfterPhotoChange();
        } else {
          const focus = focusEditor ? focusEditor.getFocus() : null;
          const entry = { ...photo, caption, category, bentoSlot, ...(focus ? { focusX: focus.x, focusY: focus.y } : {}) };
          const next = photos.map((p) => {
            if (p.slug === photo.slug) return entry;
            if (bentoSlot && p.bentoSlot === bentoSlot) return { ...p, bentoSlot: '' };
            return p;
          });
          await savePhotosList(next, 'Edit photo');
        }
        close();
      } catch (err) {
        errorEl.textContent = err.message || 'Something went wrong — check your connection and try again.';
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    });
  }

  // Adding several photos at once ships as ONE GitHub commit (see
  // photos.js's batch handler) instead of two commits per photo —
  // the whole point, since every commit auto-deploys and Netlify's
  // free tier only allows so many deploys a month.
  function openBatchPhotoModal(files) {
    const categories = collectLeafCategories(taxonomyTiles);
    const defaultCategory = currentLeafNode ? currentLeafNode.category : (categories[0] && categories[0].value);
    const objectUrls = files.map((f) => URL.createObjectURL(f));

    const backdrop = document.createElement('div');
    backdrop.className = 'admin-modal-backdrop';
    backdrop.innerHTML = `
      <div class="admin-modal admin-batch-modal">
        <h2>Add ${files.length} Photos</h2>
        <p class="admin-error"></p>
        <div class="admin-batch-list">
          ${files.map((file, i) => `
            <div class="admin-batch-row">
              <img class="admin-batch-thumb" src="${objectUrls[i]}" alt="">
              <div class="admin-batch-fields">
                <input type="text" class="admin-batch-caption" placeholder="Caption (optional)">
                <select class="admin-batch-category">
                  ${categories.map((c) => `<option value="${escapeAttr(c.value)}" ${c.value === defaultCategory ? 'selected' : ''}>${escapeAttr(c.label)}</option>`).join('')}
                </select>
              </div>
            </div>
          `).join('')}
        </div>
        <div class="admin-modal-actions">
          <button type="button" class="btn admin-modal-cancel">Cancel</button>
          <button type="button" class="btn admin-modal-save">Add ${files.length} Photos</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const cleanup = () => objectUrls.forEach((u) => URL.revokeObjectURL(u));
    const close = () => { backdrop.remove(); cleanup(); };
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('.admin-modal-cancel').addEventListener('click', close);

    backdrop.querySelector('.admin-modal-save').addEventListener('click', async () => {
      const errorEl = backdrop.querySelector('.admin-error');
      const saveBtn = backdrop.querySelector('.admin-modal-save');
      const rows = Array.from(backdrop.querySelectorAll('.admin-batch-row'));
      const captions = rows.map((r) => r.querySelector('.admin-batch-caption').value.trim());

      errorEl.textContent = '';

      saveBtn.disabled = true;
      saveBtn.textContent = 'Uploading…';
      setStatus(`Uploading ${files.length} photos…`);
      try {
        const reserved = new Set(photos.map((p) => p.slug));
        const nextSlug = (category, caption) => {
          const base = slugify(category) + '-' + (slugify(caption) || Date.now().toString(36));
          let slug = base;
          let n = 2;
          while (reserved.has(slug)) { slug = `${base}-${n}`; n += 1; }
          reserved.add(slug);
          return slug;
        };

        const batch = await Promise.all(rows.map(async (row, i) => {
          const category = row.querySelector('.admin-batch-category').value;
          const caption = captions[i];
          const imageBase64 = await resizeImageFile(files[i], 2400, 0.85);
          return { imageBase64, slug: nextSlug(category, caption), category, caption, bentoSlot: '' };
        }));

        // Chunking can't rescue a photo that busts the cap on its own,
        // so name it here rather than letting Netlify reject the whole
        // upload with a bare 400 that says nothing useful.
        const tooBig = batch.find((b) => b.imageBase64.length > MAX_UPLOAD_CHUNK_BYTES);
        if (tooBig) {
          const mb = (tooBig.imageBase64.length / 1024 / 1024).toFixed(1);
          throw new Error(`One photo is still ${mb}MB after resizing — too large to upload. Remove it from this batch and add it separately.`);
        }

        // Two phases so the batch isn't capped by the 6MB request
        // limit: get every image up as a blob across as many requests
        // as it takes, then commit the whole lot at once. Chunk order
        // is preserved, so shas[i] lines up with batch[i].
        const chunks = chunkByPayloadSize(batch, MAX_UPLOAD_CHUNK_BYTES);
        const shas = [];
        for (const chunk of chunks) {
          setStatus(`Uploading ${files.length} photos… (${shas.length}/${batch.length})`);
          const res = await apiPost('/api/photos', {
            uploadBlobs: chunk.map((b) => ({ imageBase64: b.imageBase64 })),
          });
          shas.push(...res.shas);
        }

        setStatus(`Saving ${files.length} photos…`);
        await apiPost('/api/photos', {
          commitBatch: batch.map((b, i) => ({
            slug: b.slug, category: b.category, caption: b.caption, bentoSlot: '', blobSha: shas[i],
          })),
        });

        const now = Date.now();
        const newEntries = batch.map((b) => ({ slug: b.slug, category: b.category, caption: b.caption, bentoSlot: '', v: now }));
        photos = photos.concat(newEntries);
        setStatus(`Saved ${files.length} photos — may take up to a minute to show for other visitors.`, 'ok');
        refreshAfterPhotoChange();
        close();
      } catch (err) {
        errorEl.textContent = err.message || 'Something went wrong — check your connection and try again.';
        saveBtn.disabled = false;
        saveBtn.textContent = `Add ${files.length} Photos`;
      }
    });
  }

  function escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // ---------------------------------------------------------------
  // About page — inline heading/bio/portrait
  // ---------------------------------------------------------------

  function wireAboutEditing() {
    const heading = document.getElementById('about-heading');
    const bio = document.getElementById('about-bio');
    const portrait = document.getElementById('about-portrait');
    if (!heading && !bio && !portrait) return;

    let aboutData = null;
    fetchJson('content/about.json').then((data) => { aboutData = data; }).catch(() => {});

    if (heading) { heading.contentEditable = 'true'; heading.classList.add('admin-editable'); }
    if (bio) {
      bio.contentEditable = 'true';
      bio.classList.add('admin-editable');
    }

    if (portrait) {
      portrait.style.cursor = 'pointer';
      portrait.title = 'Click to replace this photo';
      portrait.addEventListener('click', () => {
        if (!aboutData) { setStatus('Still loading — try again in a second.', 'error'); return; }
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.addEventListener('change', async () => {
          const file = input.files[0];
          if (!file || !aboutData) return;
          setStatus('Uploading…');
          try {
            const imageBase64 = await resizeImageFile(file, 1600, 0.85);
            // portraitV cache-busts (see script.js's renderAbout) since
            // the portrait always lives at the same filename.
            const next = Object.assign({}, aboutData, { portrait: 'assets/photos/about-portrait.jpg', portraitV: Date.now() });
            // The portrait isn't a gallery photo, so skipMeta:true tells
            // photos.js not to touch meta.json; contentFile/contentData
            // send about.json along so the image and its bumped
            // portraitV land in ONE commit — two commits meant two
            // Netlify production deploys for one save.
            await apiPost('/api/photos', {
              imageBase64,
              slug: 'about-portrait',
              replace: true,
              skipMeta: true,
              contentFile: 'about',
              contentData: next,
            });
            aboutData = next;
            portrait.src = imageBase64;
            setStatus('Saved — may take up to a minute to show for other visitors.', 'ok');
          } catch (err) {
            setStatus(err.message || 'Upload failed', 'error');
          }
        });
        input.click();
      });
    }

    const saveBar = document.createElement('button');
    saveBar.type = 'button';
    saveBar.className = 'btn admin-inline-save';
    saveBar.textContent = 'Save About Page';
    (bio || heading).insertAdjacentElement('afterend', saveBar);

    saveBar.addEventListener('click', async () => {
      if (!aboutData) return;
      setStatus('Saving…');
      const next = Object.assign({}, aboutData, {
        heading: heading ? heading.textContent.trim() : aboutData.heading,
        bio: bio ? [...bio.querySelectorAll('p')].map((p) => p.textContent.trim()).filter(Boolean) : aboutData.bio,
      });
      try {
        await apiPost('/api/content', { file: 'about', data: next });
        aboutData = next;
        setStatus('Saved.', 'ok');
      } catch (err) {
        setStatus(err.message || 'Save failed', 'error');
      }
    });
  }

  // ---------------------------------------------------------------
  // Homepage hero background photos (1-3, index.html only) — picked
  // from the whole photo library rather than one category, since the
  // hero is decorative and not tied to any single section.
  // ---------------------------------------------------------------

  function wireHeroImagesEditing() {
    const hero = document.querySelector('.hero');
    if (!hero || !document.getElementById('hero-bg-container')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'admin-cover-edit-btn';
    btn.textContent = 'Change hero photos';
    btn.addEventListener('click', openHeroImagesPicker);
    hero.appendChild(btn);
  }

  function openHeroImagesPicker() {
    const currentSlugs = (settings.heroImages || [])
      .map((p) => { const m = String(p).match(/([^/]+)\.jpg/); return m ? m[1] : null; })
      .filter(Boolean);
    const selected = new Set(currentSlugs);

    const backdrop = document.createElement('div');
    backdrop.className = 'admin-modal-backdrop';
    backdrop.innerHTML = `
      <div class="admin-modal">
        <h2>Hero Photos</h2>
        <p class="admin-error"></p>
        <p class="admin-hint">Pick 1 to 3 photos to show behind the homepage headline.</p>
        <div class="admin-cover-picker-grid"></div>
        <div class="admin-hero-framing"></div>
        <div class="admin-modal-actions">
          <button type="button" class="btn admin-modal-cancel">Cancel</button>
          <button type="button" class="btn admin-modal-save">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);

    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('.admin-modal-cancel').addEventListener('click', close);

    const grid = backdrop.querySelector('.admin-cover-picker-grid');
    const framingEl = backdrop.querySelector('.admin-hero-framing');
    const errorEl = backdrop.querySelector('.admin-error');
    const focusEditors = new Map(); // slug -> editor, kept alive across re-renders so in-progress drags aren't lost

    function renderGridItems() {
      grid.innerHTML = '';
      photos.forEach((photo) => {
        const item = document.createElement('button');
        item.type = 'button';
        if (selected.has(photo.slug)) item.className = 'is-selected';
        item.innerHTML = `<img src="${photoImgSrc(photo)}" alt="">`;
        item.addEventListener('click', () => {
          if (selected.has(photo.slug)) {
            selected.delete(photo.slug);
          } else if (selected.size >= 3) {
            errorEl.textContent = 'That\'s 3 already — remove one before adding another.';
            return;
          } else {
            selected.add(photo.slug);
          }
          errorEl.textContent = '';
          renderGridItems();
          renderFraming();
        });
        grid.appendChild(item);
      });
    }
    renderGridItems();

    function renderFraming() {
      framingEl.innerHTML = '';
      Array.from(selected).forEach((slug) => {
        const photo = findPhotoBySlug(slug);
        if (!photo) return;
        if (!focusEditors.has(slug)) {
          // Falls back to the standard focus point if this photo has
          // never had a wide-specific one set, matching script.js's
          // wideFocus() so the editor opens where the live site
          // already renders it.
          const startX = typeof photo.heroFocusX === 'number' ? photo.heroFocusX : photo.focusX;
          const startY = typeof photo.heroFocusY === 'number' ? photo.heroFocusY : photo.focusY;
          focusEditors.set(slug, createFocusEditor(photoImgSrc(photo), startX, startY, 'ratio-wide'));
        }
        const item = document.createElement('div');
        item.className = 'admin-hero-framing-item';
        const label = document.createElement('p');
        label.className = 'admin-hint';
        label.textContent = `Framing — ${photo.caption || photo.slug}`;
        item.appendChild(label);
        item.appendChild(focusEditors.get(slug).element);
        framingEl.appendChild(item);
      });
      Array.from(focusEditors.keys()).forEach((slug) => { if (!selected.has(slug)) focusEditors.delete(slug); });
    }
    renderFraming();

    backdrop.querySelector('.admin-modal-save').addEventListener('click', async () => {
      const slugs = Array.from(selected);
      if (!slugs.length) { errorEl.textContent = 'Choose at least 1 photo.'; return; }
      setStatus('Saving…');
      const next = Object.assign({}, settings, { heroImages: slugs.map((s) => `assets/photos/${s}.jpg`) });
      const nextPhotos = photos.map((p) => {
        const editor = focusEditors.get(p.slug);
        if (!editor) return p;
        const focus = editor.getFocus();
        return { ...p, heroFocusX: focus.x, heroFocusY: focus.y };
      });
      try {
        // One request, one commit: settings.json (heroImages) and
        // meta.json (each photo's focus-point framing) used to be two
        // separate apiPost calls here — two commits, 30 credits for
        // one "save hero photos" click instead of 15. `also` (see
        // content.js) writes both files in the same commit, same
        // pattern as the photo-delete path already used.
        await apiPost('/api/content', {
          file: 'settings',
          data: next,
          also: { file: 'meta', data: { photos: nextPhotos } },
        });
        settings = next;
        photos = nextPhotos;
        refreshAfterPhotoChange();
        close();
        setStatus('Saved — may take up to a minute to show for other visitors.', 'ok');
        renderHeroImages(document, next.heroImages, photos);
      } catch (err) {
        errorEl.textContent = err.message || 'Save failed, try again.';
      }
    });
  }

  // ---------------------------------------------------------------
  // Homepage marketing copy (index.html) — same contentEditable +
  // "Save" pattern as wireAboutEditing, just more fields and no image.
  // ---------------------------------------------------------------

  function wireHomeEditing() {
    const fieldIds = [
      'hero-eyebrow', 'hero-title',
      'favorites-title',
      'book-promo-kicker', 'book-promo-heading',
    ];
    const fields = fieldIds
      .map((id) => ({ id, key: id.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), el: document.getElementById(id) }))
      .filter((f) => f.el);
    if (!fields.length) return;

    let homeData = null;
    fetchJson('content/home.json').then((data) => { homeData = data; }).catch(() => {});

    fields.forEach((f) => {
      f.el.contentEditable = 'true';
      f.el.classList.add('admin-editable');
    });

    const saveBar = document.createElement('button');
    saveBar.type = 'button';
    saveBar.className = 'btn admin-inline-save';
    saveBar.textContent = 'Save Home Page';
    fields[fields.length - 1].el.insertAdjacentElement('afterend', saveBar);

    saveBar.addEventListener('click', async () => {
      if (!homeData) return;
      setStatus('Saving…');
      const next = Object.assign({}, homeData);
      fields.forEach((f) => { next[f.key] = f.el.textContent.trim(); });
      try {
        await apiPost('/api/content', { file: 'home', data: next });
        homeData = next;
        setStatus('Saved.', 'ok');
      } catch (err) {
        setStatus(err.message || 'Save failed', 'error');
      }
    });
  }

  // ---------------------------------------------------------------
  // Booking page copy (contact.html) — same pattern as wireHomeEditing.
  // ---------------------------------------------------------------

  function wireContactPageEditing() {
    const fieldIds = ['contact-kicker', 'contact-title', 'contact-copy'];
    const fields = fieldIds
      .map((id) => ({ id, key: id.replace(/^contact-/, ''), el: document.getElementById(id) }))
      .filter((f) => f.el);
    const pillGroup = document.getElementById('service-pill-group');
    if (!fields.length && !pillGroup) return;

    let contactPageData = null;
    fetchJson('content/contact-page.json').then((data) => { contactPageData = data; }).catch(() => {});

    fields.forEach((f) => {
      f.el.contentEditable = 'true';
      f.el.classList.add('admin-editable');
    });

    // "What are you looking for?" pills — each one is a real radio
    // input + label (see script.js's renderServiceOptions), wrapped in
    // a .pill-item span stable enough to hang a delete button off of.
    // Add/remove/rename are plain DOM edits here; Save reads whatever
    // pills currently exist in the DOM, so there's no separate array
    // to keep in sync.
    let addPillBtn = null;
    function wirePillItem(item) {
      const textEl = item.querySelector('.pill-label-text');
      if (textEl) {
        textEl.contentEditable = 'true';
        textEl.classList.add('admin-editable');
      }
      item.style.position = item.style.position || 'relative';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'admin-pill-delete';
      del.textContent = '×';
      del.title = 'Remove this option';
      del.addEventListener('click', () => item.remove());
      item.appendChild(del);
    }

    if (pillGroup) {
      pillGroup.querySelectorAll('.pill-item').forEach(wirePillItem);

      addPillBtn = document.createElement('button');
      addPillBtn.type = 'button';
      addPillBtn.className = 'admin-pill-add';
      addPillBtn.textContent = '+ Add option';
      addPillBtn.addEventListener('click', () => {
        const label = window.prompt('New option label:');
        if (!label || !label.trim()) return;
        const usedIds = new Set(Array.from(pillGroup.querySelectorAll('input[type="radio"]')).map((i) => i.id));
        let slug = slugify(label) || 'option';
        let id = `service-${slug}`;
        while (usedIds.has(id)) { slug += '-2'; id = `service-${slug}`; }
        const safeLabel = escapeAttr(label.trim());
        const item = document.createElement('span');
        item.className = 'pill-item';
        item.innerHTML = `<input type="radio" name="serviceType" id="${id}" value="${safeLabel}" class="visually-hidden pill-radio"><label for="${id}" class="pill-label"><span class="pill-label-text">${safeLabel}</span></label>`;
        pillGroup.appendChild(item);
        wirePillItem(item);
      });
      pillGroup.insertAdjacentElement('afterend', addPillBtn);
    }

    const saveAnchor = addPillBtn || (fields.length && fields[fields.length - 1].el);
    if (!saveAnchor) return;
    const saveBar = document.createElement('button');
    saveBar.type = 'button';
    saveBar.className = 'btn admin-inline-save';
    saveBar.textContent = 'Save Booking Page';
    saveAnchor.insertAdjacentElement('afterend', saveBar);

    saveBar.addEventListener('click', async () => {
      if (!contactPageData) return;
      setStatus('Saving…');
      const next = Object.assign({}, contactPageData);
      fields.forEach((f) => { next[f.key] = f.el.textContent.trim(); });
      if (pillGroup) {
        next.serviceOptions = Array.from(pillGroup.querySelectorAll('.pill-label-text'))
          .map((el) => el.textContent.trim())
          .filter(Boolean);
      }
      try {
        await apiPost('/api/content', { file: 'contactPage', data: next });
        contactPageData = next;
        setStatus('Saved.', 'ok');
      } catch (err) {
        setStatus(err.message || 'Save failed', 'error');
      }
    });
  }

  // ---------------------------------------------------------------
  // Site settings panel (everything in content/settings.json)
  // ---------------------------------------------------------------

  function openSettingsModal() {
    const backdrop = document.createElement('div');
    backdrop.className = 'admin-modal-backdrop';
    backdrop.innerHTML = `
      <div class="admin-modal">
        <h2>Site Settings</h2>
        <p class="admin-error"></p>
        <label>Instagram URL</label>
        <input type="url" class="s-instagramUrl" value="${escapeAttr(settings.instagramUrl || '')}">
        <label>TikTok URL</label>
        <input type="url" class="s-tiktokUrl" value="${escapeAttr(settings.tiktokUrl || '')}">
        <label>Contact Email</label>
        <input type="email" class="s-contactEmail" value="${escapeAttr(settings.contactEmail || '')}">
        <label>Contact Phone (displayed)</label>
        <input type="text" class="s-contactPhoneDisplay" value="${escapeAttr(settings.contactPhoneDisplay || '')}" placeholder="(913) 555-0142">
        <label>Contact Phone (link, digits only)</label>
        <input type="tel" class="s-contactPhoneHref" value="${escapeAttr(settings.contactPhoneHref || '')}" placeholder="+19135550142">
        <label>Footer Text</label>
        <input type="text" class="s-footerText" value="${escapeAttr(settings.footerText || '')}">
        <div class="admin-modal-actions">
          <button type="button" class="btn admin-modal-cancel">Cancel</button>
          <button type="button" class="btn admin-modal-save">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    backdrop.querySelector('.admin-modal-cancel').addEventListener('click', close);

    backdrop.querySelector('.admin-modal-save').addEventListener('click', async () => {
      const errorEl = backdrop.querySelector('.admin-error');
      const saveBtn = backdrop.querySelector('.admin-modal-save');
      const next = Object.assign({}, settings, {
        instagramUrl: backdrop.querySelector('.s-instagramUrl').value.trim(),
        tiktokUrl: backdrop.querySelector('.s-tiktokUrl').value.trim(),
        contactEmail: backdrop.querySelector('.s-contactEmail').value.trim(),
        contactPhoneDisplay: backdrop.querySelector('.s-contactPhoneDisplay').value.trim(),
        contactPhoneHref: backdrop.querySelector('.s-contactPhoneHref').value.trim(),
        footerText: backdrop.querySelector('.s-footerText').value.trim(),
      });
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        await apiPost('/api/content', { file: 'settings', data: next });
        settings = next;
        renderSettings(document, settings);
        setStatus('Saved.', 'ok');
        close();
      } catch (err) {
        errorEl.textContent = err.message || 'Save failed';
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save';
      }
    });
  }

  // ---------------------------------------------------------------
  // Admin bar + init
  // ---------------------------------------------------------------

  function buildAdminBar() {
    const bar = document.createElement('div');
    bar.className = 'admin-bar';
    bar.innerHTML = `
      <span class="admin-bar-label">Editing</span>
      <span class="admin-bar-status"></span>
      <button type="button" class="admin-bar-select">Select</button>
      <span class="admin-select-count" hidden></span>
      <button type="button" class="admin-select-delete" hidden>Delete Selected</button>
      <button type="button" class="admin-bar-settings">Settings</button>
      <button type="button" class="admin-bar-logout">Log out</button>
    `;
    document.body.appendChild(bar);

    bar.querySelector('.admin-bar-select').addEventListener('click', () => setSelectMode(!selectMode));
    bar.querySelector('.admin-select-delete').addEventListener('click', deleteSelectedPhotos);
    bar.querySelector('.admin-bar-settings').addEventListener('click', openSettingsModal);
    bar.querySelector('.admin-bar-logout').addEventListener('click', async () => {
      try { await apiPost('/api/auth', { action: 'logout' }); } catch (err) { /* ignore */ }
      window.location.reload();
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'admin-add-btn';
    addBtn.title = 'Add a photo';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', () => openPhotoModal({ mode: 'add' }));
    document.body.appendChild(addBtn);
  }

  async function init() {
    buildAdminBar();
    setStatus('Loading…');
    try {
      const [metaData, taxonomyResult, settingsData] = await Promise.all([
        fetchJson('assets/photos/meta.json'),
        fetchJson('content/taxonomy.json').catch(() => ({ tiles: [] })),
        fetchJson('content/settings.json').catch(() => ({})),
      ]);
      photos = metaData.photos || [];
      taxonomyData = taxonomyResult || { tiles: [] };
      taxonomyTiles = taxonomyData.tiles || (taxonomyData.tiles = []);
      settings = settingsData || {};
      assignTaxonomyPaths(taxonomyTiles, '');
      resolveCurrentGalleryNode();
      setStatus('Ready');
    } catch (err) {
      setStatus('Could not load admin data', 'error');
      return;
    }

    attachAllOverlays();
    wireAboutEditing();
    wireHomeEditing();
    wireHeroImagesEditing();
    wireContactPageEditing();
  }

  init();
})();
