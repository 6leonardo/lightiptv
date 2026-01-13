let failedImages = new Set<string>();
const listeners = new Set<() => void>();

export function markImageFailed(url: string) {
  if (!failedImages.has(url)) {
    failedImages = new Set(failedImages); // create new Set to trigger updates
    failedImages.add(url);
    listeners.forEach(l => l());
  }
}

export function isImageFailed(url: string) {
  return failedImages.has(url);
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot() {
  return failedImages;
}
