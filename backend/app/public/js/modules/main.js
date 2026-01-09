import { state } from './state.js';
import * as API from './api.js';
import * as UI from './ui.js';
import * as EPG from './epg.js';
import * as Stream from './stream.js';

// Setup global handlers for UI interactions
UI.setHandlers(Stream.startStream, Stream.stopStream, UI.toggleFFmpegLog);

// Socket Listeners
state.socket.on('log', (lines) => {
    if (state.currentSessionId) {
        UI.appendFFmpegLog(lines);
    }
});

state.socket.on('epg-icon-updated', (data) => {
    if (data && data.channelId && data.previewUrl) {
        UI.updateChannelPreview(data.channelId, data.previewUrl);
    }
});

// DOM Elements
const searchInput = document.getElementById('searchInput');
const epgToggle = document.getElementById('epgOnlyToggle');
const closeButton = document.getElementById('closeButton');
const epgCloseBtn = document.getElementById('epgCloseBtn'); // Overlay close button

if (closeButton) closeButton.addEventListener('click', Stream.stopStream);
if (epgCloseBtn) epgCloseBtn.addEventListener('click', EPG.closeEPGOverlay);

// Search
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        state.currentPage = 1; // Reset to first page
        const filtered = state.allChannels.filter(channel => 
            channel.name.toLowerCase().includes(searchTerm) ||
            channel.group.toLowerCase().includes(searchTerm)
        );
        UI.displayChannels(filtered);
        // Note: updateStats is called inside displayChannels now
    });
}

// EPG Only Toggle
if (epgToggle) {
    epgToggle.checked = state.epgOnlyMode;
    epgToggle.addEventListener('change', (e) => {
        state.epgOnlyMode = e.target.checked;
        localStorage.setItem('epgOnlyMode', state.epgOnlyMode);
        
        const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
        const filtered = searchTerm ? 
            state.allChannels.filter(ch => ch.name.toLowerCase().includes(searchTerm)) : 
            state.allChannels;
        
        UI.displayChannels(filtered);
        // Stats updated inside displayChannels
    });
}

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        UI.toggleFFmpegLog();
    }
});

// Initialization
async function init() {
    try {
        const data = await API.fetchChannels();
        if (data.error) throw new Error(data.error);
        state.epgData = await API.fetchEPG();
        if(state.epgData.error) throw new Error(state.epgData.error);
        state.allChannels = data.channels;
        UI.displayChannels(state.allChannels);

    } catch (error) {
        console.error('Init error:', error);
        document.getElementById('content').innerHTML = `
            <div class="error">
                <h2>❌ Error</h2>
                <p>${error.message}</p>
            </div>
        `;
    }
}

init();
