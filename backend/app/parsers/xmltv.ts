import xml2js from 'xml2js';

const normalizeString = (str: string) => str.toLowerCase().replace(/\s+/g, '');

interface ProgramEntry {
  channelId: string;
  start: Date;
  stop: Date;
  title: string;
  desc: string;
  category: string;
  icon: string;
}

/**
 * Parse XMLTV timestamp format (YYYYMMDDHHmmss +TZ)
 */
function parseXMLTVTime(timeStr?: string) {
  if (!timeStr) return null;

  const year = timeStr.substring(0, 4);
  const month = timeStr.substring(4, 6);
  const day = timeStr.substring(6, 8);
  const hour = timeStr.substring(8, 10);
  const minute = timeStr.substring(10, 12);
  const second = timeStr.substring(12, 14);

  const tzMatch = timeStr.match(/([+-]\d{4})$/);
  if (tzMatch) {
    const tzOffset = tzMatch[1];
    const tzSign = tzOffset[0];
    const tzHours = parseInt(tzOffset.substr(1, 2), 10);
    const tzMinutes = parseInt(tzOffset.substr(3, 2), 10);

    const utcDate = new Date(Date.UTC(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hour, 10),
      parseInt(minute, 10),
      parseInt(second, 10)
    ));

    const offsetMs = (tzSign === '+' ? -1 : 1) * ((tzHours * 60 + tzMinutes) * 60000);
    return new Date(utcDate.getTime() + offsetMs);
  }

  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
}

/**
 * Parse XMLTV EPG data
 */
async function parseXMLTV(xmlContent: string): Promise<{ epgData: Record<string, ProgramEntry[]>; channels: any[] }> {
  const parser = new xml2js.Parser();

  try {
    const result = await parser.parseStringPromise(xmlContent);
    const programmes = result.tv?.programme || [];
    const channels = result.tv?.channel || [];

    const epgData: Record<string, ProgramEntry[]> = {};

    const parseField = (field: unknown) => {
      if (!field || !Array.isArray(field) || field.length === 0) return '';
      const value = field[0] as { _?: string } | string;
      return typeof value === 'string' ? value : (value._ || '');
    };

    programmes.forEach((program: any) => {
      const channelId = normalizeString(program.$.channel);
      if (!epgData[channelId]) {
        epgData[channelId] = [];
      }
      const start = parseXMLTVTime(program.$.start);
      const stop = parseXMLTVTime(program.$.stop);
      if (!start || !stop) return;
      let progIcon = '';
      if (program.icon && program.icon[0] && program.icon[0].$ && program.icon[0].$.src) {
        progIcon = program.icon[0].$.src;
      }

      epgData[channelId].push({
        channelId,
        start,
        stop,
        title: parseField(program.title),
        desc: parseField(program.desc),
        category: parseField(program.category),
        icon: progIcon
      });
    });

    Object.keys(epgData).forEach(channelId => {
      epgData[channelId].sort((a, b) => {
        const aTime = a.start ? new Date(a.start).getTime() : 0;
        const bTime = b.start ? new Date(b.start).getTime() : 0;
        return aTime - bTime;
      });
    });

    return { epgData, channels };
  } catch (error) {
    console.error('Error parsing XMLTV:', (error as Error).message);
    return { epgData: {}, channels: [] };
  }
}

export { parseXMLTV, ProgramEntry, normalizeString };
