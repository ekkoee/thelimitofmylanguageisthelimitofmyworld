// Helpers for talking to the background worker safely.
//
// After the extension is reloaded / updated / removed, content scripts already
// running in open tabs live on with a DEAD chrome.runtime. Any call into it
// throws "Extension context invalidated". This is normal (a page refresh
// reloads the fresh content script) — so we detect it, fail fast, and let
// callers stop their loops and show a calm "please refresh" hint instead of
// spamming the error console.

/** True while this content script's extension context is still connected. */
export function extensionAlive(): boolean {
  try {
    return !!chrome.runtime?.id;
  } catch {
    return false;
  }
}

/** Whether an error is the benign "context went away" case (reload/update). */
export function isContextGoneError(e: unknown): boolean {
  const m = String((e as { message?: string })?.message ?? e);
  return /context invalidated|IBT_CONTEXT_GONE|message port closed|receiving end does not exist/i.test(m);
}

/** Promise-wrapped chrome.runtime.sendMessage that fails cleanly once the
 *  context is gone (never throws synchronously, never leaves a dangling reject). */
export function sendMessage<T = unknown>(msg: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!extensionAlive()) return reject(new Error('IBT_CONTEXT_GONE'));
    try {
      chrome.runtime.sendMessage(msg, (resp: T) => {
        const err = chrome.runtime.lastError;
        if (err) return reject(new Error(err.message || 'sendMessage failed'));
        resolve(resp);
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}
