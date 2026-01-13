import { useSyncExternalStore } from 'react';
import { subscribe, getSnapshot } from '../utils/imageStore';

export function useFailedImages() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
