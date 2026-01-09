import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || '';

export function getSocket() {
  if (!socket) {
    socket = io(SOCKET_URL);
  }
  return socket;
}
