import { state } from './state.js';
import * as API from './api.js';
import * as UI from './ui.js';

export async function startStream(channel) {
    state.currentChannel = channel;
    
    UI.showLoadingOverlay(channel.name);

    try {
        const { status, data } = await API.startStreamAPI(channel.stream, channel.name);
        
        if (status === 429) {
            UI.renderLimitReached(data.maxStreams, data.activeStreams, stopStream);
            return;
        }
        
        if (data.error) throw new Error(data.error);

        state.currentSessionId = data.sessionId;
        
        // Start polling for readiness
        await pollStreamStatus(data.sessionId, data.m3u8Url, channel.name);
        
        // Join socket room
        state.socket.emit('join-stream', state.currentSessionId);
        
        // Start heartbeat
        startHeartbeat();

    } catch (error) {
        console.error('Error starting stream:', error);
        UI.renderPlayerError(error.message);
    }
}

async function pollStreamStatus(sessionId, m3u8Url, channelName) {
    const maxAttempts = 30;
    let attempts = 0;

    const checkStatus = async () => {
        try {
            const status = await API.getStreamStatus(sessionId);

            UI.updateLoadingProgress(channelName, status.progress, status.tsCount, status.elapsedTime);
            UI.updateFFmpegLog(status.ffmpegCommand || '', status.ffmpegOutput || []);

            if (status.ready) {
                loadVideoPlayer(m3u8Url, state.currentChannel);
                return;
            } else if (status.error) {
                throw new Error(status.error);
            }

            attempts++;
            if (attempts >= maxAttempts) {
                throw new Error('Timeout: stream non pronto');
            }

            setTimeout(checkStatus, 1000);
        } catch (error) {
            console.error('Error polling stream:', error);
            UI.renderPlayerError(error.message);
        }
    };

    checkStatus();
}

function loadVideoPlayer(m3u8Url, channel) {
    const video = UI.renderPlayerInterface(channel);
    initializePlayerLogic(video, m3u8Url);
}

function initializePlayerLogic(video, m3u8Url) {
    const videoWrapper = document.getElementById('videoWrapper');

    function resizeVideo() {
        if (video.videoWidth && video.videoHeight && videoWrapper.clientWidth && videoWrapper.clientHeight) {
            const videoRatio = video.videoWidth / video.videoHeight;
            const containerWidth = videoWrapper.clientWidth;
            const containerHeight = videoWrapper.clientHeight;
            const containerRatio = containerWidth / containerHeight;
            
            let newWidth, newHeight;

            if (videoRatio > containerRatio) {
                // Video is wider than container - fit to width
                newWidth = containerWidth;
                newHeight = containerWidth / videoRatio;
            } else {
                // Video is taller than container - fit to height
                newHeight = containerHeight;
                newWidth = containerHeight * videoRatio;
            }

            // Apply size
            video.style.width = `${newWidth}px`;
            video.style.height = `${newHeight}px`;
            
            // Remove max constraints to allow exact sizing
            video.style.maxWidth = 'none';
            video.style.maxHeight = 'none';
        }
    }
    
    video.addEventListener('loadedmetadata', resizeVideo);
    video.addEventListener('resize', resizeVideo); // Detection of stream resolution change
    
    const resizeObserver = new ResizeObserver(() => {
        window.requestAnimationFrame(resizeVideo);
    });
    resizeObserver.observe(videoWrapper);
    video.resizeObserver = resizeObserver;

    if (Hls.isSupported()) {
        const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 90
        });
        
        hls.loadSource(m3u8Url);
        hls.attachMedia(video);
        
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play();
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
            console.error('HLS error:', data);
            if (data.fatal) {
                switch(data.type) {
                    case Hls.ErrorTypes.NETWORK_ERROR:
                        hls.startLoad();
                        break;
                    case Hls.ErrorTypes.MEDIA_ERROR:
                        hls.recoverMediaError();
                        break;
                    default:
                        hls.destroy();
                        break;
                }
            }
        });

        video.hlsInstance = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = m3u8Url;
        video.addEventListener('loadedmetadata', () => {
            video.play();
        });
    }
}

function startHeartbeat() {
    if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);

    state.heartbeatInterval = setInterval(() => {
        if (state.currentSessionId) {
            API.sendHeartbeat(state.currentSessionId)
                .catch(err => console.error('Heartbeat error:', err));
        }
    }, 10000);
}

export function stopStream() {
    if (state.heartbeatInterval) {
        clearInterval(state.heartbeatInterval);
        state.heartbeatInterval = null;
    }

    if (state.currentSessionId) {
        state.socket.emit('leave-stream', state.currentSessionId);
        API.stopStreamAPI(state.currentSessionId)
            .catch(err => console.error('Error stopping stream:', err));
        state.currentSessionId = null;
    }

    const video = document.getElementById('videoPlayer');
    if (video) {
        if (video.hlsInstance) video.hlsInstance.destroy();
        if (video.resizeObserver) video.resizeObserver.disconnect();
    }

    UI.removePlayerOverlays();
}
