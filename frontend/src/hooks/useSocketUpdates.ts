import { useEffect, useRef } from 'react';
import { getSocket } from '../socket';

export function useSocketUpdates(onUpdate: () => void) {
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    const socket = getSocket();

    const scheduleUpdate = () => {
      if (debounceRef.current) return;
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null;
        onUpdate();
      }, 200);
    };

    socket.on('epg-updated', scheduleUpdate);
    socket.on('channels-updated', scheduleUpdate);
    socket.on('images-update', scheduleUpdate);

    return () => {
      socket.off('epg-updated', scheduleUpdate);
      socket.off('channels-updated', scheduleUpdate);
      socket.off('images-update', scheduleUpdate);
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [onUpdate]);
}
