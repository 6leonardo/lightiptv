const xml2js = require('xml2js');

/**
 * Parse XMLTV timestamp format (YYYYMMDDHHmmss +TZ)
 */
function parseXMLTVTime(timeStr) {
  if (!timeStr) return null;
  
  const year = timeStr.substr(0, 4);
  const month = timeStr.substr(4, 2);
  const day = timeStr.substr(6, 2);
  const hour = timeStr.substr(8, 2);
  const minute = timeStr.substr(10, 2);
  const second = timeStr.substr(12, 2);
  
  const tzMatch = timeStr.match(/([+-]\d{4})$/);
  if (tzMatch) {
    const tzOffset = tzMatch[1];
    const tzSign = tzOffset[0];
    const tzHours = parseInt(tzOffset.substr(1, 2));
    const tzMinutes = parseInt(tzOffset.substr(3, 2));
    
    const utcDate = new Date(Date.UTC(
      parseInt(year), 
      parseInt(month) - 1, 
      parseInt(day), 
      parseInt(hour), 
      parseInt(minute), 
      parseInt(second)
    ));
    
    const offsetMs = (tzSign === '+' ? -1 : 1) * ((tzHours * 60 + tzMinutes) * 60000);
    return new Date(utcDate.getTime() + offsetMs);
  }
  
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
}

/**
 * Parse XMLTV EPG data
 */
async function parseXMLTV(xmlContent) {
  const parser = new xml2js.Parser();
  
  try {
    const result = await parser.parseStringPromise(xmlContent);
    const programmes = result.tv?.programme || [];
    const channels = result.tv?.channel || [];
    
    const epgData = {};
    
    const parseField = (field) => {
      if (!field || field.length === 0) return '';
      const value = field[0];
      return typeof value === 'string' ? value : (value._ || '');
    };
    
    programmes.forEach(program => {
      const channelId = program.$.channel;
      if (!epgData[channelId]) {
        epgData[channelId] = [];
      }
      
      epgData[channelId].push({
        channelId,
        start: parseXMLTVTime(program.$.start),
        stop: parseXMLTVTime(program.$.stop),
        title: parseField(program.title),
        desc: parseField(program.desc),
        category: parseField(program.category)
      });
    });
    
    // Sort programs by start time
    Object.keys(epgData).forEach(channelId => {
      epgData[channelId].sort((a, b) => new Date(a.start) - new Date(b.start));
    });
    
    return { epgData, channels };
  } catch (error) {
    console.error('Error parsing XMLTV:', error.message);
    return { epgData: {}, channels: [] };
  }
}

module.exports = { parseXMLTV };
