// Authenticated read-modify-write for the CMS's text/JSON content:
// content/about.json, content/settings.json, assets/photos/meta.json
// (caption/category/bentoSlot edits, reordering, and deleting an
// entry). Every request must carry a valid session cookie — that's
// the real security boundary, not admin.js hiding the edit UI.
//
//   POST /api/content
//     { file: "about"|"settings"|"meta", data: <new full JSON value>,
//       deleteImageSlug?: "<slug>" }  // meta.json deletes only

const { getSession } = require('./_lib/session');
const { updateJson, getFile, putFiles } = require('./_lib/github');
const { CONTENT_PATHS, CONTENT_LABELS, serializeContent } = require('./_lib/contentFiles');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });
  if (!getSession(event)) return json(401, { ok: false, error: 'Not logged in' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { ok: false, error: 'Bad request' });
  }

  const path = CONTENT_PATHS[body.file];
  if (!path || body.data === undefined) {
    return json(400, { ok: false, error: 'Missing file or data' });
  }

  try {
    // Deleting one photo removes the image and rewrites meta.json.
    // Doing that as deleteFile + updateJson meant two commits, and
    // since every commit to main is a Netlify production deploy,
    // deleting a single photo cost 30 credits instead of 15. putFiles
    // does both in one commit — a deletion is just a tree entry with
    // sha:null — which is how batchDelete in photos.js already worked.
    if (body.deleteImageSlug && body.file === 'meta') {
      const imagePath = `assets/photos/${body.deleteImageSlug}.jpg`;
      const existingImage = await getFile(imagePath);
      const files = [];
      if (existingImage) files.push({ path: imagePath, delete: true });
      files.push({ path, content: serializeContent(body.data), encoding: 'utf-8' });
      await putFiles(files, `Delete photo: ${body.deleteImageSlug} (via admin)`);
      return json(200, { ok: true });
    }

    await updateJson(path, () => body.data, `${CONTENT_LABELS[body.file] || 'Update content'} (via admin)`);
    return json(200, { ok: true });
  } catch (err) {
    console.error('[content] save failed:', err);
    const status = err.status === 409 || err.status === 422 ? 409 : 500;
    return json(status, {
      ok: false,
      error: status === 409 ? 'Someone else just saved a change — reload and try again.' : 'Save failed, try again.',
    });
  }
};

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
