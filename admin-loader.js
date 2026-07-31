// Tiny stub loaded on every public page, right after script.js (both
// plain synchronous scripts, in that order — not "defer": deferred
// scripts run before DOMContentLoaded fires, which would mean this
// file could run before script.js's own DOMContentLoaded listener has
// even set window.__sitePageReady, racing the real page render).
//
// Checks whether an admin session is active; if so, waits for the
// normal page render to finish and then loads the real edit-mode
// module. A logged-out visitor incurs one small script + one
// lightweight session check and nothing else — admin.js/admin.css
// never load, and the page stays exactly as it's always been.
(function () {
  function whenDomReady() {
    return new Promise((resolve) => {
      if (document.readyState !== 'loading') resolve();
      else document.addEventListener('DOMContentLoaded', resolve, { once: true });
    });
  }

  async function run() {
    let authenticated = false;
    try {
      const res = await fetch('/api/auth', { credentials: 'include' });
      const data = await res.json();
      authenticated = !!data.authenticated;
    } catch (err) {
      authenticated = false;
    }
    if (!authenticated) return;

    // Switch off the decorative reveal animations for the logged-in owner
    // only. admin.js makes headings/bios contentEditable, and an element
    // that's mid-fade (or hasn't scrolled into view yet) is a bad thing to
    // try to click into and edit. Logged-out visitors never reach this
    // line, so the public page is completely unaffected.
    document.documentElement.classList.add('is-admin');

    await whenDomReady();
    // script.js's DOMContentLoaded listener is registered first (its
    // script tag comes before this one in every page), so by the time
    // our own DOMContentLoaded wait resolves, window.__sitePageReady
    // has already been assigned — awaiting it here just waits for the
    // render itself to finish.
    if (window.__sitePageReady) {
      try {
        await window.__sitePageReady;
      } catch (err) {
        return; // the normal render failed; nothing for edit mode to attach to
      }
    }

    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'admin.css';
    document.head.appendChild(css);

    const script = document.createElement('script');
    script.src = 'admin.js';
    document.body.appendChild(script);
  }

  run();
})();
