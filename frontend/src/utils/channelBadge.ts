export function getChannelBadge(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';

  let badge = '';
  let prevIsAlnum = false;

  for (const char of trimmed) {
    if (char === '.') {
      badge += '.';
      prevIsAlnum = false;
      continue;
    }

    if (/[0-9]/.test(char)) {
      badge += char;
      prevIsAlnum = true;
      continue;
    }

    if (/[A-Za-z]/.test(char)) {
      if (!prevIsAlnum) {
        badge += char.toUpperCase();
      }
      prevIsAlnum = true;
      continue;
    }

    prevIsAlnum = false;
  }

  return badge || trimmed.charAt(0).toUpperCase();
}

export function getBadgeColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 85% 60%)`;
}
