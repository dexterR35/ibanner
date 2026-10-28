/** Remove retired detector downloads, preserving unrelated caches and original assets. */
export async function clearRetiredSubjectCache(storage = globalThis.caches) {
  if (!storage) return;
  for (const name of await storage.keys()) {
    if (name.startsWith('bannerflow-owlvit-')) {
      await storage.delete(name);
    } else if (name === 'transformers-cache') {
      const cache = await storage.open(name);
      for (const request of await cache.keys()) {
        const path = new URL(request.url).pathname;
        if (
          path.startsWith('/vendor/models/owlvit-base-patch32-ONNX/') ||
          path.startsWith('/vendor/onnx/ort-wasm-')
        )
          await cache.delete(request);
      }
    }
  }
}
