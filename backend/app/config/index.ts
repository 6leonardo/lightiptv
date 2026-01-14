// read yml
import { parse, stringify } from 'yaml';
import { readFile, writeFile } from 'node:fs/promises';
import dotenv from 'dotenv';
import path from 'path';
import URL from 'url';
import { assert } from 'node:console';

const __dirname = path.dirname(URL.fileURLToPath(import.meta.url));

dotenv.config();

/*

m3u:
  max-connections: 10
  streamlin:
    user-agent: "Threadfin"
  port: 3005
  locale: "it-IT"
  sources:
    greenarw_tv_italia:
      description: "Greenarw TV Italia"
      url: https://gist.githubusercontent.com/greenarw/efa4568ed2fa2e53a1aec9073d027243/raw/7a50a2c1643d1548971928aebdd9e906a2043b9f/tv_italia.m3u
      active: true
    threadfin:
      description: "Threadfin TV Italia"
      url: http://dockers.lan:34400/m3u/threadfin.m3u
      active: false
      proxied: false
      threadfin: true

xmltv:
  sources:
    it_dttsat_full:
      description: "DTT SAT Italia Full EPG"
      url: http://116.202.210.205/test/it_dttsat_full.xml
      active: true
    threadfin:
      description: "Threadfin TV Italia EPG"
      url: http://dockers.lan:34400/xmltv/threadfin.xml
      active: false
      threadfin: true
*/

const publicDir = path.join(__dirname, '..', 'public');
const frontendDist = path.join(publicDir, 'dist');
const cachedDir = path.join(publicDir, 'cached');
const dataDir = path.join(__dirname, '..', 'data');
const ymlConfigPath = path.join(__dirname, 'config.yml');

// every key "dir" in sub objects if not exists will be automatically created
export interface ConfigPath {
    dir: string;
    web?: string;
    db?: string;
};


const Paths = {
    public: publicDir,
    frontend: frontendDist,
    cached: cachedDir,
    data: dataDir,

    channels: {
        db: path.join(dataDir, 'channels.json'),
    },
    logs: {
        dir: path.join(dataDir, 'logs'),
    },
    images: {
        dir: path.join(cachedDir, 'images'),
        web: '/cached/images/',
    },
    streams: {
        dir: path.join(cachedDir, 'streams'),
        web: '/cached/streams/',
    },
}

export interface ConfigM3USource {
    description: string;
    url: string;
    active?: boolean;
    proxied?: boolean;
    threadfin?: boolean;
}

export interface ConfigXMLTVSource {
    description: string;
    url: string;
    active?: boolean;
    threadfin?: boolean;
}

export type Primitive = string | number | boolean;

export interface Properties {
    plain?: Record<string, Primitive>;
    extra?: Record<string, Primitive>;
}

export interface Match {
    match: RegExp;
    properties?: Properties;
}

export interface MatchGroup {
    include?: Match[];
    exclude?: Match[];
}

export interface Tab {
    name: string;
    description?: string;
    temp?: boolean
    start?: number;
    merge?: boolean;
    missing?: boolean;
    and?: RegExp;

    groups?: MatchGroup;
    sources?: MatchGroup;

    properties?: Properties;
    include?: Match[];
    exclude?: Match[];
}


interface Config {
    paths: typeof Paths;
    streamlink: {
        userAgent: string;
    };
    port: number;
    address: string;
    locale: string;
    maxStreams: number;
    epgCacheDuration: number;
    streamCleanupInterval: number;
    streamInactivityTimeout: number;
    tunerReleaseTimeout: number;
    ffmpeg: {
        hlsTime: number;
        hlsListSize: number;
        preset: string;
        framerate: number;
        gopSize: number;
        audioBitrate: string;
        maxOutputLines: number;
    };
    m3u: {
        maxConnections: number;
        sources: Record<string, ConfigM3USource>;
    };
    xmltv: {
        sources: Record<string, ConfigXMLTVSource>;
    };
    tabs?: Tab[];
};


const toRegExp = (value: string): RegExp => {
    if(typeof value !== 'string') {
        value = String(value);
    }
    if (value.startsWith('/') && value.endsWith('/')) {
        return new RegExp(value.slice(1, -1), 'i');
    }
    return new RegExp(value, 'i');
};

const fromRegExp = (re: RegExp): string => re.source;

const STANDARD_PROPS = new Set(['tvgNo', 'name', 'logo', 'group']);

const toProperties = (obj?: Record<string, Primitive>): Properties | undefined => {
    if (!obj) return undefined;

    const plain: Record<string, Primitive> = {};
    const extra: Record<string, Primitive> = {};

    for (const [k, v] of Object.entries(obj)) {
        if (k === 'match') continue;
        (STANDARD_PROPS.has(k) ? plain : extra)[k] = v;
    }

    if (!Object.keys(plain).length && !Object.keys(extra).length) return undefined;
    return { plain, extra };
};

const fromProperties = (p?: Properties): Record<string, Primitive> | undefined => {
    if (!p) return undefined;
    return { ...p.extra, ...p.plain };
};

const toMatches = (arr?: any[]): Match[] | undefined =>
    arr?.map(e => ({
        match: toRegExp(e.match),
        properties: toProperties(e)
    }));

const fromMatches = (arr?: Match[]): any[] | undefined =>
    arr?.map(e => {
        const out: any = { match: fromRegExp(e.match) };
        const props = fromProperties(e.properties);
        if (props) Object.assign(out, props);
        return out;
    });

const toMatchGroup = (obj?: any): MatchGroup | undefined => {
    if (!obj) return undefined;

    const group: MatchGroup = {};
    if (obj.include) group.include = toMatches(obj.include);
    if (obj.exclude) group.exclude = toMatches(obj.exclude);

    return group.include || group.exclude ? group : undefined;
};

const fromMatchGroup = (group?: MatchGroup): any | undefined => {
    if (!group) return undefined;

    const out: any = {};
    if (group.include) out.include = fromMatches(group.include);
    if (group.exclude) out.exclude = fromMatches(group.exclude);

    return Object.keys(out).length ? out : undefined;
};



class Config {
    config: Config;

    constructor() {
        this.config = {} as Config;
    }

    toTabs(yamlTabs: any): Tab[] {
        return Object.entries(yamlTabs).map(([name, raw]: any) => ({
            name,
            description: raw.description,
            temp: raw.temp,
            start: raw.start,
            merge: raw.merge,
            missing: raw.missing,
            and: raw.and ? toRegExp(raw.and) : undefined,

            groups: toMatchGroup(raw.groups),
            sources: toMatchGroup(raw.sources),

            properties: toProperties(raw.properties),
            include: toMatches(raw.include),
            exclude: toMatches(raw.exclude)
        }));
    }

    fromTabs(tabs: Tab[]): any {
        const out: any = {};

        for (const tab of tabs) {
            const entry: any = {};

            if (tab.description) entry.description = tab.description;
            if (tab.start !== undefined) entry.start = tab.start;
            if (tab.merge !== undefined) entry.merge = tab.merge;
            if (tab.missing !== undefined) entry.missing = tab.missing;
            if (tab.temp !== undefined) entry.temp = tab.temp;
            if (tab.and) entry.and = fromRegExp(tab.and);

            const groups = fromMatchGroup(tab.groups);
            if (groups) entry.groups = groups;

            const sources = fromMatchGroup(tab.sources);
            if (sources) entry.sources = sources;

            const props = fromProperties(tab.properties);
            if (props) entry.properties = props;

            const include = fromMatches(tab.include);
            if (include) entry.include = include;

            const exclude = fromMatches(tab.exclude);
            if (exclude) entry.exclude = exclude;

            out[tab.name] = entry;
        }

        return out;
    }

    async load() {
        try {
            const content = await readFile(ymlConfigPath, 'utf8');

            let temp = parse(content);

            temp.tabs = this.toTabs(temp.tabs || {});
            temp.paths = Paths;
            temp.streamlink = {
                userAgent: process.env.STREAMLINK_USER_AGENT || 'Threadfin',
            };
            temp.address = process.env.ADDRESS || '0.0.0.0';
            temp.port = process.env.PORT ? Number(process.env.PORT) : 3005;
            temp.locale = process.env.LOCALE || 'it-IT';
            temp.maxStreams = parseInt(process.env.MAX_STREAMS || '2', 10);
            temp.epgCacheDuration = parseInt(process.env.EPG_CACHE_DURATION || '3600000', 10);
            temp.streamCleanupInterval = parseInt(process.env.STREAM_CLEANUP_INTERVAL || '30000', 10);
            temp.streamInactivityTimeout = parseInt(process.env.STREAM_INACTIVITY_TIMEOUT || '10000', 10);
            temp.tunerReleaseTimeout = parseInt(process.env.TUNER_RELEASE_TIMEOUT || '15000', 10);
            temp.ffmpeg = {
                hlsTime: parseInt(process.env.FFMPEG_HLS_TIME || '4', 10),
                hlsListSize: parseInt(process.env.FFMPEG_HLS_LIST_SIZE || '8', 10),
                preset: process.env.FFMPEG_PRESET || 'veryfast',
                framerate: parseInt(process.env.FFMPEG_FRAMERATE || '50', 10),
                gopSize: parseInt(process.env.FFMPEG_GOP_SIZE || '100', 10),
                audioBitrate: process.env.FFMPEG_AUDIO_BITRATE || '128k',
            };
            temp.m3u.maxConnections = temp.m3u['max-connections'] || 10;
            delete temp.m3u['max-connections'];

            for (const sourceKey in temp.m3u.sources) {
                if (temp.m3u.sources[sourceKey].active === undefined) {
                    temp.m3u.sources[sourceKey].active = true;
                }
                if (temp.m3u.sources[sourceKey].proxied === undefined) {
                    temp.m3u.sources[sourceKey].proxied = false;
                }
                if (temp.m3u.sources[sourceKey].threadfin === undefined) {
                    temp.m3u.sources[sourceKey].threadfin = false;
                }
            }
            for (const sourceKey in temp.xmltv.sources) {
                if (temp.xmltv.sources[sourceKey].active === undefined) {
                    temp.xmltv.sources[sourceKey].active = true;
                }
                if (temp.xmltv.sources[sourceKey].threadfin === undefined) {
                    temp.xmltv.sources[sourceKey].threadfin = false;
                }
            }
            this.config = temp satisfies Config;
            return this.config;

        } catch (err) {
            console.error("Impossibile leggere o parsare il file YAML:", err);
            process.exit(1);
        }
    }

    getConfig() {
        return this.config;
    }

    async save() {
        try {
            const temp: any = { ...this.config };
            temp.m3u['max-connections'] = temp.m3u.maxConnections;
            delete temp.m3u.maxConnections;
            temp.tabs = this.fromTabs(this.config.tabs || []);
            const yamlStr = stringify(temp);
            await writeFile(ymlConfigPath + '.1', yamlStr, 'utf8');
        } catch (err) {
            console.error("Impossibile salvare il file YAML:", err);
        }
    }
}

const config = new Config();
await config.load();
//await config.save();
export const getConfig = () => config.getConfig();
export const saveConfig = () => config.save();

