# LightIPTV - Web IPTV Viewer

A lightweight web IPTV viewer designed to work in cascade with **Threadfin**, perfect for testing playlists or light browser-based viewing.

## ⚠️ Important Note

**This is not a full-featured IPTV client** but rather a testing/light viewing tool. It uses minimal infrastructure to stream IPTV channels via web browser. Ideal for debugging, quick tests, or occasional use.

## 🔧 Requirements: Threadfin

LightIPTV works **in cascade with Threadfin**, which handles:
- Managing the original M3U playlist
- Buffering streams (recommended: 0.5MB in Threadfin)
- Providing EPG via XMLTV with associated channels

**Threadfin tested and working** with these settings.

## 🐳 Docker Hub

Image available on Docker Hub: **`astevani/lightiptv:latest`** (amd64)

## 📦 Complete Setup with Threadfin

### docker-compose.yml

```yaml
networks:
  tvstack:
    driver: bridge

services:
  threadfin:
    image: fyb3roptik/threadfin
    container_name: threadfin
    hostname: threadfin
    restart: unless-stopped
    ports:
      - "34400:34400"
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Europe/Rome
    volumes:
      - ./threadfin/conf:/home/threadfin/conf
      - ./threadfin/temp:/tmp/threadfin:rw
    networks:
      - tvstack

  lightiptv:
    image: astevani/lightiptv:latest
    container_name: lightiptv
    restart: unless-stopped
    ports:
      - "3005:3005"
    environment:
      # Internal URLs to Threadfin (same Docker network)
      - THREADFIN_M3U_URL=http://threadfin:34400/m3u/threadfin.m3u
      - THREADFIN_XMLTV_URL=http://threadfin:34400/xmltv/threadfin.xml
      - PORT=3005
    volumes:
      - ./lightiptv/streams:/app/public/streams
    networks:
      - tvstack
    depends_on:
      - threadfin
```

### Environment Variables

#### Required
- **`THREADFIN_M3U_URL`**: URL of Threadfin's M3U playlist (can be internal Docker URL)
- **`THREADFIN_XMLTV_URL`**: URL of Threadfin's XMLTV EPG (can be internal Docker URL)

#### Optional
- **`PORT`**: LightIPTV server port (default: `3005`)
- **`MAX_STREAMS`**: Maximum concurrent active streams (default: `2`, use `0` for unlimited)
- **`PREVIEWS_ENABLED`**: Enable automatic preview screenshot capture (default: `false`)
- **`PREVIEWS_EPG_ONLY`**: Only capture previews for channels with EPG data (default: `true`)
- **`PREVIEWS_EXCLUDE`**: Comma-separated list of channel TVG IDs to exclude from preview generation

#### Example Configuration

```yaml
environment:
  - THREADFIN_M3U_URL=http://threadfin:34400/m3u/threadfin.m3u
  - THREADFIN_XMLTV_URL=http://threadfin:34400/xmltv/threadfin.xml
  - PORT=3005
  - MAX_STREAMS=2
  - PREVIEWS_ENABLED=true
  - PREVIEWS_EPG_ONLY=true
  - PREVIEWS_EXCLUDE=
```

### Volumes

- **`./lightiptv/streams:/app/public/streams`**: External directory for HLS stream segments (avoids writing to container image)

## 🚀 Getting Started

```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f lightiptv

# Stop
docker-compose down
```

## 🌐 Access

Open browser: `http://localhost:3005`


## 📸 Screenshots

### Main Interface
![LightIPTV Main Interface](images/screenshot.jpeg)

### Debug Mode (Press H)
![LightIPTV Debug Mode with FFmpeg Log](images/screenshot-debug.jpeg)

## 🔍 Debug with H key

Press **`H`** key to show/hide real-time FFmpeg log.

**Log utility:**
- View executed FFmpeg command
- Monitor bitrate, frame rate, encoding speed
- Diagnose stream connection issues
- Verify network errors or unsupported codecs

The log updates in real-time during stream preparation and remains available during playback.

## 📝 Technical Notes

- **Base image**: `node:20-alpine` (~150MB final with FFmpeg)
- **FFmpeg**: HLS transcoding with 4-second segments
- **Stream sharing**: Reuses same FFmpeg process for identical URLs
- **Stream limit**: Configurable max concurrent streams (default: 2)
- **Auto-cleanup**: Inactive streams terminated after 60 seconds
- **EPG cache**: 1-hour cache duration to reduce Threadfin calls
- **Preview screenshots**: Optional automatic thumbnail capture when idle (requires `PREVIEWS_ENABLED=true`)

## 🎯 Recommended Use Cases

- Quick IPTV playlist testing
- Debugging problematic streams (with FFmpeg log)
- Occasional browser viewing
- Development/staging environment

## ✅ Tested With

**Italian TV Channels:**
- **M3U Playlist**: [greenarw/tv_italia.m3u](https://gist.github.com/greenarw/efa4568ed2fa2e53a1aec9073d027243)
  - Direct link: `https://gist.githubusercontent.com/greenarw/efa4568ed2fa2e53a1aec9073d027243/raw/7a50a2c1643d1548971928aebdd9e906a2043b9f/tv_italia.m3u`
- **EPG (DTT & SAT)**: [sfiorini/IPTV-Italy](https://github.com/sfiorini/IPTV-Italy)
  - Direct link: `http://116.202.210.205/test/it_dttsat_full.xml`

Successfully tested with Italian digital terrestrial and satellite channels.

**Not recommended for:** heavy usage, production with many simultaneous users, 24/7 streaming.

