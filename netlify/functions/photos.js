// Authenticated new-photo upload / replace-by-slug, and — via
// skipMeta — a generic "write an image into assets/photos/" used for
// the About page portrait, which isn't a gallery photo and has no
// meta.json entry of its own. The browser has already
// resized/compressed the image via <canvas> before this runs (see
// admin.js) — this function just commits the already-web-sized JPEG,
// plus whichever JSON file describes it: meta.json for a gallery
// photo, or (via contentFile/contentData) a content/*.json file for
// the portrait. Image and JSON always land in ONE commit.
//
//   POST /api/photos
//     { imageBase64, slug, category, caption, bentoSlot, replace? }
//     { imageBase64, slug, replace: true, skipMeta: true }   // image only
//     { imageBase64, slug, replace: true, skipMeta: true,    // portrait
//       contentFile: 'about', contentData: {...} }

const { getSession } = require('./_lib/session');
const { getFile, putFile, putFiles, createBlob } = require('./_lib/github');
const { CONTENT_PATHS, CONTENT_LABELS, serializeContent } = require('./_lib/contentFiles');

const VALID_BENTO_SLOTS = new Set(['', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
const SLUG_PATTERN = /^[a-z0-9-]+$/;
const MAX_BATCH_SIZE = 40;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });
  if (!getSession(event)) return json(401, { ok: false, error: 'Not logged in' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { ok: false, error: 'Bad request' });
  }

  if (Array.isArray(body.uploadBlobs)) return handleUploadBlobs(body.uploadBlobs);
  if (Array.isArray(body.commitBatch)) return handleCommitBatch(body.commitBatch);
  if (Array.isArray(body.batch)) return handleBatch(body.batch);
  if (Array.isArray(body.batchDelete)) return handleBatchDelete(body.batchDelete);

  const { imageBase64, slug, category, caption, replace, skipMeta, contentFile, contentData } = body;
  const bentoSlot = body.bentoSlot || '';

  if (!imageBase64 || !slug) {
    return json(400, { ok: false, error: 'Missing required fields' });
  }
  if (!skipMeta && !category) {
    return json(400, { ok: false, error: 'Missing required fields' });
  }
  if (!SLUG_PATTERN.test(slug)) {
    return json(400, { ok: false, error: 'Invalid photo name' });
  }
  if (!VALID_BENTO_SLOTS.has(bentoSlot)) {
    return json(400, { ok: false, error: 'Invalid featured-tile value' });
  }
  // A content-file update may ride along with a skipMeta image so the
  // two commit together. Rejected on the gallery path rather than
  // ignored: those photos are described by meta.json, which that path
  // already writes in the same commit. contentFile is a key in
  // CONTENT_PATHS, never a path, so this can't write anywhere else.
  if (contentFile !== undefined
      && (!skipMeta || !CONTENT_PATHS[contentFile] || contentData === undefined)) {
    return json(400, { ok: false, error: 'Bad request' });
  }

  try {
    const imagePath = `assets/photos/${slug}.jpg`;
    const imageContent = imageBase64.replace(/^data:image\/\w+;base64,/, '');

    // skipMeta is the About-page portrait and friends — an image with
    // no meta.json entry of its own.
    if (skipMeta) {
      // The portrait keeps the same filename on every replace, so
      // about.json carries a portraitV cache-buster that has to be
      // bumped alongside it (the caller owns that value — see
      // wireAboutEditing in admin.js). Both files go up as ONE commit:
      // every commit to main is a Netlify production deploy, so doing
      // it in two cost 30 credits instead of 15. Atomic is also the
      // safer shape — a new image with a stale portraitV would keep
      // serving the old photo from cache with no visible error.
      if (contentFile) {
        await putFiles(
          [
            { path: imagePath, content: imageContent, encoding: 'base64' },
            { path: CONTENT_PATHS[contentFile], content: serializeContent(contentData), encoding: 'utf-8' },
          ],
          `${CONTENT_LABELS[contentFile]} photo: ${slug} (via admin)`
        );
        return json(200, { ok: true, slug });
      }

      const existingImage = replace ? await getFile(imagePath) : null;
      await putFile(
        imagePath,
        Buffer.from(imageContent, 'base64'),
        `${replace ? 'Replace' : 'Add'} image: ${slug} (via admin)`,
        existingImage ? existingImage.sha : undefined
      );
      return json(200, { ok: true, slug });
    }

    // The image and meta.json go up as ONE commit. They used to be
    // two (putFile, then updateJson), and since every commit to main
    // is a Netlify production deploy, adding or replacing a single
    // photo cost two deploys — 30 credits — instead of 15. Same
    // reasoning as handleCommitBatch below.
    const metaFile = await getFile('assets/photos/meta.json');
    const metaData = metaFile ? JSON.parse(metaFile.content.toString('utf8')) : { photos: [] };
    const photos = metaData.photos || [];
    // v bumps on every write so photoImgSrc (script.js) can
    // cache-bust — a replace keeps the same filename, so without
    // this browsers/CDNs would keep showing the old image.
    const entry = { slug, category, caption, bentoSlot, v: Date.now() };
    // Only one photo may hold a given featured-tile slot at a time.
    if (entry.bentoSlot) {
      photos.forEach((p) => { if (p.bentoSlot === entry.bentoSlot) p.bentoSlot = ''; });
    }
    const idx = photos.findIndex((p) => p.slug === slug);
    if (idx >= 0) photos[idx] = entry;
    else photos.push(entry);

    await putFiles(
      [
        { path: imagePath, content: imageContent, encoding: 'base64' },
        { path: 'assets/photos/meta.json', content: JSON.stringify({ photos }, null, 2) + '\n', encoding: 'utf-8' },
      ],
      `${replace ? 'Replace' : 'Add'} photo: ${slug} (via admin)`
    );

    return json(200, { ok: true, slug });
  } catch (err) {
    console.error('[photos] upload failed:', err);
    const status = err.status === 409 || err.status === 422 ? 409 : 500;
    return json(status, {
      ok: false,
      error: status === 409 ? 'Someone else just saved a change — reload and try again.' : 'Upload failed, try again.',
    });
  }
};

// Phase 1 of a large batch. Netlify caps a function request body at
// 6MB, which is only ~6 web-sized photos — so handleBatch (which
// carries every image in one request) can't serve a 20- or 30-photo
// upload at all. This turns images into git blobs *without* touching
// the branch, so admin.js can call it as many times as it needs to
// get everything up. Nothing is committed here; blobs that never make
// it into a commit are unreferenced and GitHub garbage-collects them.
async function handleUploadBlobs(items) {
  if (!items.length) return json(400, { ok: false, error: 'No photos in this upload' });
  if (items.length > MAX_BATCH_SIZE) {
    return json(400, { ok: false, error: `Too many photos at once — split into groups of ${MAX_BATCH_SIZE} or fewer.` });
  }
  for (const item of items) {
    if (!item.imageBase64) return json(400, { ok: false, error: 'Missing required fields' });
  }

  try {
    const shas = await Promise.all(items.map((item) => (
      createBlob(item.imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64')
    )));
    return json(200, { ok: true, shas });
  } catch (err) {
    console.error('[photos] blob upload failed:', err);
    return json(500, { ok: false, error: 'Upload failed, try again.' });
  }
}

// Phase 2. Every image is already a blob by now, so this request only
// carries metadata — it stays small no matter how many photos are in
// the batch, and lands all of them in a single commit (one deploy),
// which is the whole reason batching exists.
async function handleCommitBatch(items) {
  if (!items.length) return json(400, { ok: false, error: 'No photos in this batch' });

  for (const item of items) {
    if (!item.blobSha || !item.slug || !item.category) {
      return json(400, { ok: false, error: 'Missing required fields' });
    }
    if (!SLUG_PATTERN.test(item.slug)) {
      return json(400, { ok: false, error: 'Invalid photo name' });
    }
    if (!VALID_BENTO_SLOTS.has(item.bentoSlot || '')) {
      return json(400, { ok: false, error: 'Invalid featured-tile value' });
    }
  }
  const slugs = items.map((i) => i.slug);
  if (new Set(slugs).size !== slugs.length) {
    return json(400, { ok: false, error: 'Two photos in this batch have the same name' });
  }
  const claimedSlots = items.map((i) => i.bentoSlot).filter(Boolean);
  if (new Set(claimedSlots).size !== claimedSlots.length) {
    return json(400, { ok: false, error: 'Two photos in this batch are set to the same featured tile' });
  }

  try {
    const metaFile = await getFile('assets/photos/meta.json');
    const metaData = metaFile ? JSON.parse(metaFile.content.toString('utf8')) : { photos: [] };
    const photos = metaData.photos || [];
    const now = Date.now();

    const usedBentoSlots = new Set(claimedSlots);
    if (usedBentoSlots.size) {
      photos.forEach((p) => { if (usedBentoSlots.has(p.bentoSlot)) p.bentoSlot = ''; });
    }
    items.forEach((item) => {
      photos.push({ slug: item.slug, category: item.category, caption: item.caption, bentoSlot: item.bentoSlot || '', v: now });
    });

    const files = items.map((item) => ({
      path: `assets/photos/${item.slug}.jpg`,
      sha: item.blobSha,
    }));
    files.push({
      path: 'assets/photos/meta.json',
      content: JSON.stringify({ photos }, null, 2) + '\n',
      encoding: 'utf-8',
    });

    await putFiles(files, `Add ${items.length} photo${items.length === 1 ? '' : 's'} (via admin)`);
    return json(200, { ok: true, slugs });
  } catch (err) {
    console.error('[photos] batch commit failed:', err);
    const status = err.status === 409 || err.status === 422 ? 409 : 500;
    return json(status, {
      ok: false,
      error: status === 409 ? 'Someone else just saved a change — reload and try again.' : 'Batch upload failed, try again.',
    });
  }
}

// New photos only (no replace/skipMeta) — one atomic commit for the
// whole batch via putFiles, instead of 2 commits per photo. This is
// the whole point: 10 photos one-at-a-time is 20 commits (20 Netlify
// production deploys); a batch of 10 is 1.
// Kept for small batches that comfortably fit in one request; larger
// ones go through handleUploadBlobs + handleCommitBatch above.
async function handleBatch(items) {
  if (!items.length) return json(400, { ok: false, error: 'No photos in this batch' });
  if (items.length > MAX_BATCH_SIZE) {
    return json(400, { ok: false, error: `Too many photos at once — split into groups of ${MAX_BATCH_SIZE} or fewer.` });
  }

  for (const item of items) {
    if (!item.imageBase64 || !item.slug || !item.category) {
      return json(400, { ok: false, error: 'Missing required fields' });
    }
    if (!SLUG_PATTERN.test(item.slug)) {
      return json(400, { ok: false, error: 'Invalid photo name' });
    }
    if (!VALID_BENTO_SLOTS.has(item.bentoSlot || '')) {
      return json(400, { ok: false, error: 'Invalid featured-tile value' });
    }
  }
  const slugs = items.map((i) => i.slug);
  if (new Set(slugs).size !== slugs.length) {
    return json(400, { ok: false, error: 'Two photos in this batch have the same name' });
  }
  const claimedSlots = items.map((i) => i.bentoSlot).filter(Boolean);
  if (new Set(claimedSlots).size !== claimedSlots.length) {
    return json(400, { ok: false, error: 'Two photos in this batch are set to the same featured tile' });
  }

  try {
    const metaFile = await getFile('assets/photos/meta.json');
    const metaData = metaFile ? JSON.parse(metaFile.content.toString('utf8')) : { photos: [] };
    const photos = metaData.photos || [];
    const now = Date.now();

    const usedBentoSlots = new Set(claimedSlots);
    if (usedBentoSlots.size) {
      photos.forEach((p) => { if (usedBentoSlots.has(p.bentoSlot)) p.bentoSlot = ''; });
    }
    items.forEach((item) => {
      photos.push({ slug: item.slug, category: item.category, caption: item.caption, bentoSlot: item.bentoSlot || '', v: now });
    });

    const files = items.map((item) => ({
      path: `assets/photos/${item.slug}.jpg`,
      content: item.imageBase64.replace(/^data:image\/\w+;base64,/, ''),
      encoding: 'base64',
    }));
    files.push({
      path: 'assets/photos/meta.json',
      content: JSON.stringify({ photos }, null, 2) + '\n',
      encoding: 'utf-8',
    });

    await putFiles(files, `Add ${items.length} photo${items.length === 1 ? '' : 's'} (via admin)`);
    return json(200, { ok: true, slugs });
  } catch (err) {
    console.error('[photos] batch upload failed:', err);
    const status = err.status === 409 || err.status === 422 ? 409 : 500;
    return json(status, {
      ok: false,
      error: status === 409 ? 'Someone else just saved a change — reload and try again.' : 'Batch upload failed, try again.',
    });
  }
}

// Deleting one photo already cost 2 commits (image + meta.json), same
// as adding one — so this mirrors handleBatch: every image removal
// and the single meta.json rewrite happen in one atomic commit no
// matter how many photos are selected.
async function handleBatchDelete(slugs) {
  if (!slugs.length) return json(400, { ok: false, error: 'No photos selected' });
  if (slugs.length > MAX_BATCH_SIZE) {
    return json(400, { ok: false, error: `Too many at once — split into groups of ${MAX_BATCH_SIZE} or fewer.` });
  }
  for (const slug of slugs) {
    if (!SLUG_PATTERN.test(slug)) return json(400, { ok: false, error: 'Invalid photo name' });
  }

  try {
    const metaFile = await getFile('assets/photos/meta.json');
    const metaData = metaFile ? JSON.parse(metaFile.content.toString('utf8')) : { photos: [] };
    const slugSet = new Set(slugs);
    const remaining = (metaData.photos || []).filter((p) => !slugSet.has(p.slug));

    const files = slugs.map((slug) => ({ path: `assets/photos/${slug}.jpg`, delete: true }));
    files.push({
      path: 'assets/photos/meta.json',
      content: JSON.stringify({ photos: remaining }, null, 2) + '\n',
      encoding: 'utf-8',
    });

    await putFiles(files, `Delete ${slugs.length} photo${slugs.length === 1 ? '' : 's'} (via admin)`);
    return json(200, { ok: true, slugs });
  } catch (err) {
    console.error('[photos] batch delete failed:', err);
    const status = err.status === 409 || err.status === 422 ? 409 : 500;
    return json(status, {
      ok: false,
      error: status === 409 ? 'Someone else just saved a change — reload and try again.' : 'Delete failed, try again.',
    });
  }
}

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
