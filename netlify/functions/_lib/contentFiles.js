// The CMS's editable content files, in one place because two
// functions need them: content.js writes one of these on its own, and
// photos.js writes one alongside an image in a single commit (the
// About-page portrait). Doubles as the allowlist — a request names a
// key here, never a path, so it can't write anywhere else in the repo.

const CONTENT_PATHS = {
  about: 'content/about.json',
  settings: 'content/settings.json',
  meta: 'assets/photos/meta.json',
  taxonomy: 'content/taxonomy.json',
  home: 'content/home.json',
  contactPage: 'content/contact-page.json',
};

const CONTENT_LABELS = {
  about: 'Update About page',
  settings: 'Update site settings',
  meta: 'Update photo list',
  taxonomy: 'Update section cover photo',
  home: 'Update home page text',
  contactPage: 'Update booking page text',
};

// Every content file is written this way — 2-space indent, trailing
// newline. Must stay identical to what updateJson (_lib/github.js)
// produces, since the same file gets written through both; anything
// else turns a one-line edit into a whole-file diff.
function serializeContent(data) {
  return JSON.stringify(data, null, 2) + '\n';
}

module.exports = { CONTENT_PATHS, CONTENT_LABELS, serializeContent };
