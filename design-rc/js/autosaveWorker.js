// Autosave stringify worker — JSON.stringify of a whole building model is
// one of the worst main-thread stalls (it runs after every undo/redo/edit).
// The main thread posts the serialized snapshot (cheap structured clone);
// this worker does the expensive stringify and posts the string back.
// Workers have no localStorage, so the main thread only does the final
// setItem with the pre-built string (fast compared to stringify).
self.onmessage = (ev) => {
  try {
    self.postMessage(JSON.stringify(ev.data));
  } catch (e) {
    self.postMessage(null); // non-cloneable snapshot: caller falls back inline
  }
};
