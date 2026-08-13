// Only these reach the browser. Terminal output is untrusted text, and OSC 8
// lets the emitting program name *any* scheme for a hyperlink — a `javascript:`
// URI handed to an opener would run in Forest's own origin.
const SAFE_SCHEMES = new Set(["http:", "https:"]);

/**
 * Open a URL from terminal output in a new tab. Returns false if the URL was
 * refused.
 *
 * This deliberately avoids `window.open()`. Both of xterm's link paths reach
 * for it — the OSC 8 `linkHandler` and the web-links addon's built-in handler,
 * which opens a blank popup first and only then assigns `location.href`. That
 * is precisely the shape popup blockers exist to stop, and the block is sticky
 * per-origin: once it trips, `window.open()` returns null forever. Links keep
 * underlining on hover and keep doing nothing on click, in every terminal, and
 * reloading the page never clears it because the state lives in the browser.
 *
 * A synthesized anchor click is treated as an ordinary user-initiated link
 * instead of a popup, so it survives that setting.
 */
export function openUrl(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (!SAFE_SCHEMES.has(url.protocol)) return false;

  const a = document.createElement("a");
  a.href = url.href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.style.display = "none";
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
  }
  return true;
}
