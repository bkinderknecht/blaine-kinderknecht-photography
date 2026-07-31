// Thin wrapper around GitHub's Contents API — the CMS's actual
// storage layer. Every write is one git commit; Netlify auto-deploys
// on every push to main. No npm dependency: uses the global `fetch`
// Netlify's Node runtime already provides.

const API_BASE = 'https://api.github.com';

function repoConfig() {
  // .trim() guards against a trailing newline/space from copy-pasting
  // into Netlify's env var UI — an untrimmed token breaks the auth
  // header, and an untrimmed repo breaks the API URL, both silently.
  const repo = (process.env.GITHUB_REPO || '').trim(); // "owner/name"
  const token = (process.env.GITHUB_TOKEN || '').trim();
  if (!repo || !token) {
    throw new Error('GITHUB_REPO and GITHUB_TOKEN must be set as Netlify environment variables');
  }
  return { repo, token };
}

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

// Fetches a file's current content (decoded) + sha. Returns null if
// the file doesn't exist yet (e.g. a brand-new photo slug).
async function getFile(path) {
  const { repo, token } = repoConfig();
  const res = await fetch(`${API_BASE}/repos/${repo}/contents/${encodeURIComponent(path)}?ref=main`, {
    headers: headers(token),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub getFile failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  const content = Buffer.from(json.content.replace(/\n/g, ''), 'base64');
  return { content, sha: json.sha };
}

// Writes (creates or updates) a file. `content` is a Buffer or string.
// Pass `sha` when updating an existing file — GitHub rejects the
// write with a 409/422 if it's stale (something else committed since
// it was read), or if it's omitted for a file that already exists.
async function putFile(path, content, message, sha) {
  const { repo, token } = repoConfig();
  const body = {
    message,
    content: Buffer.isBuffer(content) ? content.toString('base64') : Buffer.from(content, 'utf8').toString('base64'),
    branch: 'main',
  };
  if (sha) body.sha = sha;
  const res = await fetch(`${API_BASE}/repos/${repo}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: headers(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = new Error(`GitHub putFile failed (${res.status}): ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function deleteFile(path, sha, message) {
  const { repo, token } = repoConfig();
  const res = await fetch(`${API_BASE}/repos/${repo}/contents/${encodeURIComponent(path)}`, {
    method: 'DELETE',
    headers: headers(token),
    body: JSON.stringify({ message, sha, branch: 'main' }),
  });
  if (!res.ok) {
    const err = new Error(`GitHub deleteFile failed (${res.status}): ${await res.text()}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// Reads a JSON file's current sha, applies `mutate` to its parsed
// contents, and writes the result back — retrying once if another
// commit landed in between (the sha went stale). This is the whole
// concurrency story: the read-then-write happens inside one Function
// invocation (well under a second), not across however long an admin
// tab happened to sit open.
async function updateJson(path, mutate, message) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await getFile(path);
    if (!existing) throw new Error(`${path} not found in repo`);
    const data = JSON.parse(existing.content.toString('utf8'));
    const next = mutate(data);
    try {
      await putFile(path, JSON.stringify(next, null, 2) + '\n', message, existing.sha);
      return next;
    } catch (err) {
      lastErr = err;
      if (err.status === 409 || err.status === 422) continue;
      throw err;
    }
  }
  throw lastErr;
}

// --- Git Data API: commit many files at once, as ONE commit ---
// The Contents API above (putFile) is one commit per file — fine for
// single edits, expensive for a batch (N photos = 2N commits = 2N
// Netlify production deploys, since every commit auto-deploys). These
// four calls are the standard low-level GitHub sequence for bundling
// any number of file writes into a single atomic commit instead.

async function getRef(branch) {
  const { repo, token } = repoConfig();
  const res = await fetch(`${API_BASE}/repos/${repo}/git/refs/heads/${branch}`, { headers: headers(token) });
  if (!res.ok) throw new Error(`GitHub getRef failed (${res.status}): ${await res.text()}`);
  return res.json();
}

async function getCommit(sha) {
  const { repo, token } = repoConfig();
  const res = await fetch(`${API_BASE}/repos/${repo}/git/commits/${sha}`, { headers: headers(token) });
  if (!res.ok) throw new Error(`GitHub getCommit failed (${res.status}): ${await res.text()}`);
  return res.json();
}

async function createBlob(content, encoding) {
  const { repo, token } = repoConfig();
  const res = await fetch(`${API_BASE}/repos/${repo}/git/blobs`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ content, encoding }),
  });
  if (!res.ok) throw new Error(`GitHub createBlob failed (${res.status}): ${await res.text()}`);
  return (await res.json()).sha;
}

async function createTree(baseTreeSha, entries) {
  const { repo, token } = repoConfig();
  const res = await fetch(`${API_BASE}/repos/${repo}/git/trees`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ base_tree: baseTreeSha, tree: entries }),
  });
  if (!res.ok) throw new Error(`GitHub createTree failed (${res.status}): ${await res.text()}`);
  return (await res.json()).sha;
}

async function createCommit(message, treeSha, parentSha) {
  const { repo, token } = repoConfig();
  const res = await fetch(`${API_BASE}/repos/${repo}/git/commits`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ message, tree: treeSha, parents: [parentSha] }),
  });
  if (!res.ok) throw new Error(`GitHub createCommit failed (${res.status}): ${await res.text()}`);
  return (await res.json()).sha;
}

async function updateRef(commitSha, branch) {
  const { repo, token } = repoConfig();
  const res = await fetch(`${API_BASE}/repos/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    headers: headers(token),
    body: JSON.stringify({ sha: commitSha }),
  });
  if (!res.ok) {
    const err = new Error(`GitHub updateRef failed (${res.status}): ${await res.text()}`);
    err.status = res.status; // 422 here means the ref moved (someone else committed) — same retry story as updateJson
    throw err;
  }
  return res.json();
}

// Commits multiple files as one atomic commit. `files` is a mix of
// writes — { path, content, encoding } (encoding 'base64' for images,
// 'utf-8' for JSON/text) — and deletions — { path, delete: true }. A
// tree entry with sha:null is GitHub's way of removing a path from
// the resulting tree, so deletes need no blob at all. Retries once if
// the branch moved between reading its tip and updating it (same race
// updateJson guards against, just at the ref level instead of a
// single file's sha).
async function putFiles(files, message, branch) {
  branch = branch || 'main';
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ref = await getRef(branch);
      const baseCommit = await getCommit(ref.object.sha);
      const toWrite = files.filter((f) => !f.delete);
      // A file may arrive with its blob already uploaded (f.sha) — see
      // the two-phase batch upload in photos.js, which sends big images
      // across several requests to stay under Netlify's 6MB body cap
      // but still commits them all together.
      const blobShas = await Promise.all(toWrite.map((f) => (f.sha ? f.sha : createBlob(f.content, f.encoding))));
      const shaByPath = new Map(toWrite.map((f, i) => [f.path, blobShas[i]]));
      const treeEntries = files.map((f) => ({
        path: f.path,
        mode: '100644',
        type: 'blob',
        sha: f.delete ? null : shaByPath.get(f.path),
      }));
      const treeSha = await createTree(baseCommit.tree.sha, treeEntries);
      const commitSha = await createCommit(message, treeSha, ref.object.sha);
      await updateRef(commitSha, branch);
      return commitSha;
    } catch (err) {
      lastErr = err;
      if (err.status === 409 || err.status === 422) continue;
      throw err;
    }
  }
  throw lastErr;
}

module.exports = { getFile, putFile, deleteFile, updateJson, putFiles, createBlob };
