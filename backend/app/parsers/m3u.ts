
interface ChannelEntry {
	id: string;
	name: string;
	logo: string;
	group: string;
	stream: string;
	agent?: string;
	referrer?: string;
	domain: string;
	quality: string;
	region: string;
	resolution: string;
	info: string;
	geoBlocked: string;
	tvgid: string;
	tvgNo: string;
	channelID: string;
	extra: Record<string, string>;

}


/*
threadfin example:
-----
#EXTINF:0 channelID="x-ID.216" tvg-chno="5" tvg-name="Canale 5" tvg-id="5" tvg-logo="http://dockers.lan:34400/images/8b84955ec766292f3ed04cfa5edb4f86.png" group-title="Main",Canale 5
-----
green example:
-----
#EXTM3U
#EXTINF:-1 tvg-chno="1" tvg-logo="https://cdn.jsdelivr.net/gh/Tundrak/IPTV-Italia/logos/rai1.png" group-title="NAZIONALI",Rai 1
#EXTVLCOPT:http-user-agent=HbbTV/1.6.1
#EXTVLCOPT:http-referrer=https://www.tv8.it/
https://mediapolis.rai.it/relinker/relinkerServlet.htm?cont=2606803&output=7&forceUserAgent=raiplayappletv
-----
iptv.org
-----
#EXTINF:-1 tvg-id="ACCDigitalNetwork.us@SD" tvg-logo="https://i.imgur.com/V6Kaqha.png" group-title="Sports",ACCDN (1080p)
https://raycom-accdn-firetv.amagi.tv/playlist.m3u8
#EXTINF:-1 tvg-id="AccessHumboldt.us@SD" tvg-logo="https://i.imgur.com/tJl43uM.png" group-title="General",Access Humboldt (1080p)
*/

const knownAttributes = [
	'channelID',
	'tvg-name',
	'tvg-logo',
	'http-header',
	'group-title',
	'tvg-id'
];

const knownTags = [
	'#EXTINF',
	'#EXTGRP',
	'#EXTVLCOPT'
];

/**
 * M3U Playlist Parser
 */
function parseM3U(source: string, content: string): ChannelEntry[] {
	const lines = content.split('\n');
	const channels: ChannelEntry[] = [];
	const missing: { tags: Set<string>, attrs: Set<string> } = { tags: new Set(), attrs: new Set() };
	const chex = /^(?<domain>[^\s@"]+)(?:@(?:(?<quality>720|1080|4K|SD|HD|FHD|UHD)|(?<region>[A-Za-z][A-Za-z0-9+-]*)(?<quality2>720|1080|4K|SD|HD|FHD|UHD)?))?$/i;
	const nameex = /^(?<name>.*?)(?: (?<hd1>HD))?(:? +\((?<resolution>.+)\))?(:? +\[(?<info>.+)\])?(?: (?<hd>HD))??$/i;

	let currentChannel: ChannelEntry | null = null;

	const parseName = (nameFull: string) => {
		const match = nameFull.match(nameex);
		if (match) {
			let geoBlocked = "false";
			let { name, resolution, info, hd, hd1 } = match.groups as { name: string; resolution?: string; info?: string; hd?: string, hd1?: string };
			if (/geo-blocked/i.test(info || '')) {
				info = info?.replace(/geo-blocked/gi, '').trim();
				geoBlocked = "true";
			}
			return { name: name.trim(), resolution: resolution || null, info: info || null, geoBlocked, hd: hd || hd1 || null };
		}
		return { name: nameFull.trim(), resolution: null, info: null, geoBlocked: "false", hd: null };
	}


	const parseID = (id: string) => {
		const match = id.match(chex);
		if (match) {
			const { domain, quality, region, quality2 } = match.groups as { domain: string; quality?: string; region?: string; quality2?: string };
			return { domain, quality: quality || quality2 || null, region: region || null };
		}
		return { domain: id, quality: null, region: null };
	}

	const extractAttribute = (line: string, attr: string) => {
		const match = line.match(new RegExp(`${attr}="([^"]*)"`));
		return match ? match[1] : '';
	};

	const checkMissing = (line: string) => {
		const tagMatch = line.match(/^#([A-Z0-9\-]+):/);
		if (tagMatch && !knownTags.includes(`#${tagMatch[1]}`)) {
			missing.tags.add(tagMatch[1]);
		}
		const attrRegex = /(:| )([a-zA-Z0-9\-]+)=/g;
		let match;
		while ((match = attrRegex.exec(line)) !== null) {
			if (!knownAttributes.includes(match[2])) {
				missing.attrs.add(match[2]);
			}
		}
	}
	let count = 1;
	for (const line of lines) {
		try {
			const trimmed = line.trim();

			if (trimmed.startsWith('#EXTM3U')) {
				continue; // skip header
			}
			else if (trimmed.startsWith('#EXTINF:')) {
				const nameMatch = trimmed.match(/,(.+)$/);
				const nameFull = nameMatch ? nameMatch[1] : 'unknown';
				const { name, resolution, info, geoBlocked, hd } = parseName(nameFull);
				const id = extractAttribute(trimmed, 'tvg-id')
				const { domain, quality, region } = parseID(id || '');
				const tgvname = extractAttribute(trimmed, 'tvg-name') || name
				currentChannel = {
					id: `${source}-${id || nameFull}`,
					name: tgvname,
					logo: extractAttribute(trimmed, 'tvg-logo'),
					agent: extractAttribute(trimmed, 'http-header'),
					referrer: extractAttribute(trimmed, 'http-referrer'),
					group: extractAttribute(trimmed, 'group-title'),
					domain: domain || tgvname || '',
					quality: quality || '',
					region: region || '',
					resolution: resolution || hd || '',
					info: info || '',
					geoBlocked: geoBlocked,
					tvgid: id || '',
					tvgNo: extractAttribute(trimmed, 'tvg-chno'),
					channelID: extractAttribute(trimmed, 'channelID') || '',
					extra: {},
					stream: ''
				};
			}
			//#EXTVLCOPT:http-user-agent=HbbTV/1.6.1

			else if (trimmed.startsWith('#EXTGRP:') && currentChannel) {
				currentChannel.group = trimmed.substring(8).trim();
			}
			else if (trimmed.startsWith('#EXTVLCOPT:http-user-agent=') && currentChannel) {
				currentChannel.agent = trimmed.substring(29).trim();
			}
			else if (trimmed.startsWith('#EXTVLCOPT:http-referrer=') && currentChannel) {
				currentChannel.referrer = trimmed.substring(29).trim();
			}
			else if (trimmed.startsWith('#')) {
				checkMissing(trimmed);
				console.log('Found channel:', currentChannel ? currentChannel.name : 'unknown', 'with metadata line:', trimmed);
			}
			else if (trimmed && !trimmed.startsWith('#') && currentChannel) {
				currentChannel.stream = trimmed;
				channels.push(currentChannel);
				currentChannel = null;
				count += 1;
			} else {
				console.log('Ignoring line:', trimmed);
			}

		} catch (err) {
			console.log('Error parsing line:', line, err);
		}
	}
	if (missing.tags.size > 0) {
		console.log('Missing M3U Tags:', Array.from(missing.tags).join(', '));
	}
	if (missing.attrs.size > 0) {
		console.log('Missing M3U Attributes:', Array.from(missing.attrs).join(', '));
	}
	console.log(`Parsed ${channels.length} channels from M3U ${source}`);
	return channels;
}

export { parseM3U, ChannelEntry };
