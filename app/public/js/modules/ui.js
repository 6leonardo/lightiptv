import { state } from './state.js';
import { showChannelEPG } from './epg.js';

let startStreamHandler = null;
let stopStreamHandler = null;
let toggleLogHandler = null;

export function setHandlers(start, stop, toggleLog) {
    startStreamHandler = start;
    stopStreamHandler = stop;
    toggleLogHandler = toggleLog;
}

export function updateChannelPreview(channelId, previewUrl) {
    // Determine context (list vs grid)
    const listPreview = document.querySelector(`.channel-list-item img[src*="${channelId}"]`) || 
                        document.querySelector(`.channel-list-item .channel-list-logo.placeholder`); 
                        // Note: placeholders might range harder to find specifically without ID, usually better to add data-id.
    
    // Better strategy: Add data-id to elements
    const channelElements = document.querySelectorAll(`[data-channel-id="${channelId}"]`);

    channelElements.forEach(el => {
        // Update Preview Image
        const img = el.querySelector('img');
        if (img) {
            img.src = previewUrl;
            img.classList.remove('logo-mode'); // Ensure it's treated as preview
            img.classList.add('channel-list-preview'); 
        } else {
             // Replace placeholder with image
             const placeholder = el.querySelector('.placeholder');
             if (placeholder) {
                 const newImg = document.createElement('img');
                 newImg.src = previewUrl;
                 newImg.alt = "Preview";
                 newImg.className = "channel-list-preview"; // or channel-logo based on view.
                 // We need to know if it is list or grid.. 
                 if (el.classList.contains('channel-card')) {
                     newImg.className = "channel-logo";
                 }
                 placeholder.replaceWith(newImg);
             }
        }

        // Update EPG info if in EPG mode
        if (state.epgOnlyMode && state.epgData && state.epgData.epgData[channelId]) {
             updateChannelEPGDisplay(el, channelId);
        }
    });

    // If we can't find elements easily, we might need to re-render.
    // However, re-rendering everything is expensive.
    // Let's modify the creation flow to include data-id first.
}

function updateChannelEPGDisplay(containerInfo, channelId) {
    // Logic to re-read EPG from state and update text
     const programs = state.epgData.epgData[channelId];
     const now = new Date();
     const currentProgram = programs.find(p => {
        const start = new Date(p.start);
        const stop = new Date(p.stop);
        return now >= start && now <= stop;
    });

    if (currentProgram) {
        // Update Title
        const titleEl = containerInfo.querySelector('.channel-list-current') || containerInfo.querySelector('.epg-info-title');
        if (titleEl) titleEl.textContent = currentProgram.title;

        // Update Time
        const start = new Date(currentProgram.start);
        const stop = new Date(currentProgram.stop);
        const timeStr = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')} - ${stop.getHours().toString().padStart(2, '0')}:${stop.getMinutes().toString().padStart(2, '0')}`;
        
        const timeEl = containerInfo.querySelector('.channel-list-time') || containerInfo.querySelector('.epg-info-time');
        if (timeEl) timeEl.textContent = timeStr;
    }
}

export function displayChannels(channels) {
    state.filteredChannels = channels; // Store currently filtered list logic
    const content = document.getElementById('content');
    
    if (channels.length === 0) {
        content.innerHTML = '<div class="loading">No channels found</div>';
        updateStats(0, state.allChannels.length);
        return;
    }

    // Filter channels with EPG if in EPG-only mode
    let displayChannelsList = channels;
    if (state.epgOnlyMode) {
        displayChannelsList = channels.filter(ch => {
            return state.epgData && ch.tvgId && state.epgData.epgData[ch.tvgId] && state.epgData.epgData[ch.tvgId].length > 0;
        });

        // Sort by channel number
        displayChannelsList.sort((a, b) => {
            const getNumber = (ch) => {
                const match = (ch.id || ch.name).match(/\d+/);
                return match ? parseInt(match[0]) : 9999;
            };
            return getNumber(a) - getNumber(b);
        });
    }

    // Pagination Logic
    const totalItems = displayChannelsList.length;
    const totalPages = Math.ceil(totalItems / state.itemsPerPage);
    
    // Ensure currentPage is valid
    if (state.currentPage > totalPages) state.currentPage = 1;
    if (state.currentPage < 1) state.currentPage = 1;

    const startIndex = (state.currentPage - 1) * state.itemsPerPage;
    const endIndex = Math.min(startIndex + state.itemsPerPage, totalItems);
    const paginatedChannels = displayChannelsList.slice(startIndex, endIndex);

    if (state.epgOnlyMode) {
        displayListView(paginatedChannels);
    } else {
        displayGridView(paginatedChannels);
    }

    // Add Pagination Controls
    renderPaginationControls(content, totalPages);
    
    updateStats(paginatedChannels.length, state.allChannels.length, startIndex + 1, endIndex, totalItems);
}

function renderPaginationControls(container, totalPages) {
    if (totalPages <= 1) return;

    const paginationDiv = document.createElement('div');
    paginationDiv.className = 'pagination-controls';
    paginationDiv.style.cssText = 'display: flex; justify-content: center; gap: 10px; padding: 20px; align-items: center; color: white;';
    
    // Prev Button
    const prevBtn = document.createElement('button');
    prevBtn.textContent = '« Prev';
    prevBtn.disabled = state.currentPage === 1;
    prevBtn.onclick = () => {
        if (state.currentPage > 1) {
            state.currentPage--;
            displayChannels(state.filteredChannels);
            window.scrollTo(0, 0);
        }
    };
    stylePagButton(prevBtn);

    // Page Info
    const pageInfo = document.createElement('span');
    pageInfo.textContent = `Page ${state.currentPage} of ${totalPages}`;

    // Next Button
    const nextBtn = document.createElement('button');
    nextBtn.textContent = 'Next »';
    nextBtn.disabled = state.currentPage === totalPages;
    nextBtn.onclick = () => {
        if (state.currentPage < totalPages) {
            state.currentPage++;
            displayChannels(state.filteredChannels);
            window.scrollTo(0, 0);
        }
    };
    stylePagButton(nextBtn);

    paginationDiv.appendChild(prevBtn);
    paginationDiv.appendChild(pageInfo);
    paginationDiv.appendChild(nextBtn);
    
    container.appendChild(paginationDiv);
}

function stylePagButton(btn) {
    btn.style.cssText = `
        padding: 5px 15px; 
        background: #333; 
        color: white; 
        border: 1px solid #555; 
        border-radius: 4px; 
        cursor: pointer;
    `;
    if (btn.disabled) {
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
    } else {
        btn.onmouseover = () => btn.style.background = '#444';
        btn.onmouseout = () => btn.style.background = '#333';
    }
}

function displayListView(channels) {
    const content = document.getElementById('content');
    const list = document.createElement('div');
    list.className = 'channels-list';
    
    channels.forEach(channel => {
        const item = document.createElement('div');
        item.className = 'channel-list-item';
        item.dataset.channelId = channel.tvgId; // Add ID for selective updates

        // Preview or logo element
        let previewElement = '';
        const hasPreview = state.previewsIndex[channel.tvgId] && state.previewsIndex[channel.tvgId].status === 'success';
        
        if (hasPreview) {
            const previewUrl = `/streams/previews/${channel.tvgId}.jpg`;
            previewElement = `<img src="${previewUrl}" alt="Preview" class="channel-list-preview">`;
        } else if (channel.logo) {
            const logoProxyUrl = `/api/logo-proxy?url=${encodeURIComponent(channel.logo)}`;
            previewElement = `<img src="${logoProxyUrl}" alt="${channel.name}" class="channel-list-preview logo-mode" onerror="this.outerHTML='<div class=\\'channel-list-logo placeholder\\'>${channel.name.charAt(0).toUpperCase()}</div>';">`;
        } else {
            previewElement = `<div class="channel-list-logo placeholder">${channel.name.charAt(0).toUpperCase()}</div>`;
        }

        // Get current program only
        let currentText = '';
        let timeStr = '';

        if (state.epgData && state.epgData.epgData[channel.tvgId]) {
            const programs = state.epgData.epgData[channel.tvgId];
            const now = new Date();
            const currentProgram = programs.find(p => {
                const start = new Date(p.start);
                const stop = new Date(p.stop);
                return now >= start && now <= stop;
            });

            if (currentProgram) {
                const start = new Date(currentProgram.start);
                const stop = new Date(currentProgram.stop);
                timeStr = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')} - ${stop.getHours().toString().padStart(2, '0')}:${stop.getMinutes().toString().padStart(2, '0')}`;
                currentText = currentProgram.title;
            }
        }

        item.innerHTML = `
            ${channel.isStreaming ? '<div class="streaming-indicator"></div>' : ''}
            ${previewElement}
            <div class="channel-list-info">
                <div class="channel-list-name">${channel.name}</div>
                ${currentText ? `
                <div class="channel-list-epg">
                    <div class="channel-list-current">${currentText}</div>
                </div>
                ` : ''}
            </div>
            ${timeStr ? `<div class="channel-list-time">${timeStr}</div>` : ''}
        `;

        item.addEventListener('click', () => {
            if (startStreamHandler) startStreamHandler(channel);
        });

        list.appendChild(item);
    });

    content.innerHTML = '';
    content.appendChild(list);
}

function displayGridView(channels) {
    const content = document.getElementById('content');
    const grid = document.createElement('div');
    grid.className = 'channels-grid';

    channels.forEach(channel => {
        const card = document.createElement('div');
        card.dataset.channelId = channel.tvgId; // Add ID for selective updates
        card.className = 'channel-card';

        let logoElement;
        if (channel.logo) {
            const logoProxyUrl = `/api/logo-proxy?url=${encodeURIComponent(channel.logo)}`;
            logoElement = `<img src="${logoProxyUrl}" alt="${channel.name}" class="channel-logo" onerror="this.onerror=null; this.style.display='none'; this.parentElement.insertAdjacentHTML('afterbegin', '<div class=\\'channel-name\\'>${channel.name}</div>')">`;
        } else {
            const initial = channel.name.charAt(0).toUpperCase();
            logoElement = `<div class="channel-logo placeholder">${initial}</div>`;
        }

        let epgInfoHtml = '';
        const hasEPG = state.epgData && channel.tvgId && state.epgData.epgData[channel.tvgId];
        
        if (hasEPG) {
            const now = new Date();
            const programs = state.epgData.epgData[channel.tvgId];
            const currentProgram = programs.find(p => {
                const start = new Date(p.start);
                const stop = new Date(p.stop);
                return now >= start && now <= stop;
            }) || programs.find(p => new Date(p.start) > now);

            if (currentProgram) {
                const start = new Date(currentProgram.start);
                const stop = new Date(currentProgram.stop);
                const timeStr = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}-${stop.getHours().toString().padStart(2, '0')}:${stop.getMinutes().toString().padStart(2, '0')}`;
                epgInfoHtml = `
                    <div class="epg-info">
                        <div class="epg-info-time">${timeStr}</div>
                        <div class="epg-info-title">${currentProgram.title}</div>
                    </div>
                `;
            } else {
                 epgInfoHtml = `<div class="no-epg-placeholder">📋 View EPG</div>`;
            }
        }

        card.innerHTML = `
            ${channel.isStreaming ? '<div class="streaming-indicator"></div>' : ''}
            ${logoElement}
            ${epgInfoHtml}
            ${channel.group ? `<div class="channel-group">${channel.group}</div>` : ''}
        `;
        
        const epgDiv = card.querySelector('.epg-info') || card.querySelector('.no-epg-placeholder');
        if (epgDiv) {
            epgDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                showChannelEPG(channel.tvgId, channel.name.replace(/'/g, " \\'"));
            });
        }

        card.addEventListener('click', (e) => {
            if (!e.target.closest('.epg-info') && !e.target.closest('.no-epg-placeholder')) {
                if (startStreamHandler) startStreamHandler(channel);
            }
        });

        grid.appendChild(card);
    });

    content.innerHTML = '';
    content.appendChild(grid);
}

export function updateStats(displayed, total, start = null, end = null, totalFiltered = null) {
    const stats = document.getElementById('stats');
    if (stats) {
        if (start !== null) {
             stats.textContent = `Showing ${start}-${end} of ${totalFiltered} channels (Total: ${total})`;
        } else {
             stats.textContent = `Shown ${displayed} of ${total} channels`;
        }
    }
}

// Player related UI
export function showLoadingOverlay(channelName) {
    const overlay = document.getElementById('videoOverlay');
    const videoContent = document.getElementById('videoContent');
    overlay.classList.add('active');
    
    videoContent.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; padding: 60px;">
            <div class="spinner"></div>
            <div class="loading-message">Starting stream ${channelName}...</div>
        </div>
    `;
}

export function updateLoadingProgress(channelName, progress, tsCount, elapsedTime) {
    const videoContent = document.getElementById('videoContent');
    videoContent.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; padding: 60px 40px; width: 100%; max-width: 900px;">
            <div class="loading-message">Preparing stream ${channelName}...</div>
            <div style="width: 100%; margin-top: 20px;">
                <div style="background: rgba(255,255,255,0.2); border-radius: 10px; height: 30px; overflow: hidden;">
                    <div style="background: linear-gradient(90deg, #4caf50, #8bc34a); height: 100%; width: ${progress}%; transition: width 0.3s; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;">
                        ${progress}%
                    </div>
                </div>
                <div style="color: #aaa; margin-top: 10px; text-align: center; font-size: 0.9em;">
                    ${tsCount || 0} segments / ${elapsedTime || 0}s
                </div>
            </div>
        </div>
    `;
}

export function renderPlayerError(message) {
    const videoContent = document.getElementById('videoContent');
    videoContent.innerHTML = `
        <div style="color: white; padding: 60px; text-align: center;">
            <h2>❌ Error</h2>
            <p>${message}</p>
        </div>
    `;
}

export function renderLimitReached(maxStreams, activeStreams, closeCallback) {
     const videoContent = document.getElementById('videoContent');
     videoContent.innerHTML = `
        <div style="color: white; padding: 60px; text-align: center;">
            <h2>⚠️ Limit Reached</h2>
            <p>Max concurrent streams reached (${maxStreams || 'N/A'})</p>
            <p>Active streams: ${activeStreams || 'N/A'}</p>
            <p>Try again in a few minutes</p>
            <button id="limitCloseBtn" style="margin-top: 20px; padding: 10px 20px; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer;">Close</button>
        </div>
    `;
    const btn = document.getElementById('limitCloseBtn');
    if (btn) btn.addEventListener('click', closeCallback);
}

export function renderPlayerInterface(channel) {
    const videoContent = document.getElementById('videoContent');
    
    // EPG Logic for player sidebar
    let epgHtml = '';
    if (state.epgData && channel.tvgId && state.epgData.epgData[channel.tvgId]) {
        const now = new Date();
        const programs = state.epgData.epgData[channel.tvgId];
        
        const currentProgram = programs.find(p => {
            const start = new Date(p.start);
            const stop = new Date(p.stop);
            return now >= start && now <= stop;
        });
        
        const futurePrograms = programs.filter(p => new Date(p.start) > now).slice(0, 5);
        
        epgHtml = '<div style="padding: 20px; overflow-y: auto; max-height: 100%;">';
        epgHtml += '<h3 style="color: #4caf50; margin-top: 0;">Program Guide</h3>';
        
        if (currentProgram) {
            const start = new Date(currentProgram.start);
            const stop = new Date(currentProgram.stop);
            const timeStr = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')} - ${stop.getHours().toString().padStart(2, '0')}:${stop.getMinutes().toString().padStart(2, '0')}`;
            
            epgHtml += '<div style="background: rgba(76, 175, 80, 0.2); padding: 15px; border-radius: 8px; margin-bottom: 15px; border-left: 4px solid #4caf50;">';
            epgHtml += '<div style="color: #4caf50; font-weight: bold; font-size: 0.85em; margin-bottom: 5px;">NOW PLAYING</div>';
            epgHtml += `<div style="font-weight: bold; margin-bottom: 5px;">${currentProgram.title}</div>`;
            epgHtml += `<div style="color: #aaa; font-size: 0.9em;">${timeStr}</div>`;
            if (currentProgram.desc) epgHtml += `<div style="margin-top: 8px; font-size: 0.9em; color: #ccc;">${currentProgram.desc}</div>`;
            if (currentProgram.category) epgHtml += `<div style="margin-top: 8px;"><span style="background: rgba(76, 175, 80, 0.3); padding: 4px 8px; border-radius: 4px; font-size: 0.8em;">${currentProgram.category}</span></div>`;
            epgHtml += '</div>';
        }

        if (futurePrograms.length > 0) {
            epgHtml += '<div style="color: #888; font-weight: bold; font-size: 0.85em; margin-bottom: 10px; margin-top: 20px;">UP NEXT</div>';
            futurePrograms.forEach(program => {
                const start = new Date(program.start);
                const stop = new Date(program.stop);
                const timeStr = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')} - ${stop.getHours().toString().padStart(2, '0')}:${stop.getMinutes().toString().padStart(2, '0')}`;
                
                epgHtml += '<div style="padding: 12px; margin-bottom: 10px; background: rgba(255,255,255,0.05); border-radius: 6px;">';
                epgHtml += `<div style="font-weight: 500; margin-bottom: 3px;">${program.title}</div>`;
                epgHtml += `<div style="color: #888; font-size: 0.85em;">${timeStr}</div>`;
                if (program.category) epgHtml += `<div style="margin-top: 5px;"><span style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 3px; font-size: 0.75em; color: #aaa;">${program.category}</span></div>`;
                epgHtml += '</div>';
            });
        }
        epgHtml += '</div>';
    } else {
        epgHtml = '<div style="padding: 20px; color: #888; text-align: center;"><p>No EPG data available</p></div>';
    }

    videoContent.innerHTML = `
        <div style="height: 100%; display: flex; flex-direction: column; background: #000;">
            <div id="videoWrapper" style="flex: 1; display: flex; align-items: center; justify-content: center; background: #000; overflow: hidden;">
                <video id="videoPlayer" controls="" autoplay="" style="display: block;"></video>
            </div>
            <div style="color: white; padding: 15px; background: rgba(0,0,0,0.9);">
                <h3 style="margin: 0;">${channel.name}</h3>
            </div>
        </div>
    `;


    // Overlays (Sidebar, Toggles)
    const existingSidebar = document.getElementById('epgSidebar');
    const existingToggle = document.getElementById('epgToggle');
    const existingLogToggle = document.getElementById('logToggle');
    if (existingSidebar) existingSidebar.remove();
    if (existingToggle) existingToggle.remove();
    if (existingLogToggle) existingLogToggle.remove();

    const epgSidebar = document.createElement('div');
    epgSidebar.id = 'epgSidebar';
    epgSidebar.style.cssText = 'position: fixed; right: 0; top: 0; bottom: 0; width: 350px; background: rgba(0,0,0,0.95); color: white; transform: translateX(100%); transition: transform 0.3s ease; z-index: 10001; overflow-y: auto;';
    epgSidebar.innerHTML = epgHtml;

    const epgToggle = document.createElement('div');
    epgToggle.id = 'epgToggle';
    epgToggle.onclick = toggleEPGSidebar;
    epgToggle.style.cssText = 'position: fixed; right: 0; top: 50%; transform: translateY(-50%); background: rgba(76, 175, 80, 0.9); color: white; padding: 30px 8px; cursor: pointer; border-radius: 8px 0 0 8px; font-weight: bold; writing-mode: vertical-rl; text-orientation: mixed; font-size: 14px; letter-spacing: 2px; z-index: 10002; box-shadow: -2px 0 10px rgba(0,0,0,0.3); transition: right 0.3s ease;';
    epgToggle.textContent = 'EPG';

    const logToggle = document.createElement('div');
    logToggle.id = 'logToggle';
    logToggle.onclick = toggleLogHandler;
    logToggle.style.cssText = 'position: fixed; left: 0; top: 50%; transform: translateY(-50%); background: rgba(33, 150, 243, 0.9); color: white; padding: 30px 8px; cursor: pointer; border-radius: 0 8px 8px 0; font-weight: bold; writing-mode: vertical-rl; text-orientation: mixed; font-size: 14px; letter-spacing: 2px; z-index: 10002; box-shadow: 2px 0 10px rgba(0,0,0,0.3); transition: left 0.3s ease;';
    logToggle.textContent = 'LOGS';

    document.body.appendChild(epgSidebar);
    document.body.appendChild(epgToggle);
    document.body.appendChild(logToggle);

    return document.getElementById('videoPlayer');
}

function toggleEPGSidebar() {
    const sidebar = document.getElementById('epgSidebar');
    const toggle = document.getElementById('epgToggle');
    const isOpen = sidebar.style.transform === 'translateX(0%)';
    
    if (isOpen) {
        sidebar.style.transform = 'translateX(100%)';
        toggle.style.right = '0';
    } else {
        sidebar.style.transform = 'translateX(0%)';
        toggle.style.right = '350px';
    }
}

export function removePlayerOverlays() {
    const epgSidebar = document.getElementById('epgSidebar');
    const epgToggle = document.getElementById('epgToggle');
    const logToggle = document.getElementById('logToggle');
    if (epgSidebar) epgSidebar.remove();
    if (epgToggle) epgToggle.remove();
    if (logToggle) logToggle.remove();
    document.getElementById('videoOverlay').classList.remove('active');
}

// Log UI
export function createFFmpegLog() {
    if (document.getElementById('ffmpegLog')) return document.getElementById('ffmpegLog');

    const logDiv = document.createElement('div');
    logDiv.id = 'ffmpegLog';
    logDiv.style.cssText = `
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        height: 250px;
        background: rgba(0, 0, 0, 0.95);
        color: #0f0;
        font-family: monospace;
        font-size: 11px;
        padding: 15px;
        overflow-y: auto;
        white-space: pre-wrap;
        word-wrap: break-word;
        line-height: 1.3;
        z-index: 10000;
        border-top: 2px solid #4caf50;
        box-shadow: 0 -2px 10px rgba(0,0,0,0.5);
        display: ${state.ffmpegLogVisible ? 'block' : 'none'};
    `;
    document.body.appendChild(logDiv);
    state.ffmpegLogElement = logDiv;
    return logDiv;
}

export function toggleFFmpegLog() {
    state.ffmpegLogVisible = !state.ffmpegLogVisible;
    if (state.ffmpegLogElement) {
        state.ffmpegLogElement.style.display = state.ffmpegLogVisible ? 'block' : 'none';
        if (state.ffmpegLogVisible) {
            state.ffmpegLogElement.scrollTop = state.ffmpegLogElement.scrollHeight;
        }
    }
}

export function appendFFmpegLog(lines) {
    if (!state.ffmpegLogElement) createFFmpegLog();
    
    // Add new lines, but only keep the last 50 lines total
    const currentLines = state.ffmpegLogElement.textContent.split('\n');
    const newLogs = [...currentLines, ...lines].filter(line => line.trim() !== '');
    
    // Keep only last 50 lines
    const limitedLines = newLogs.slice(-50);
    
    state.ffmpegLogElement.textContent = limitedLines.join('\n') + '\n';
    
    if (state.ffmpegLogVisible) {
        state.ffmpegLogElement.scrollTop = state.ffmpegLogElement.scrollHeight;
    }
}

export function updateFFmpegLog(command, output) {
    if (!state.ffmpegLogElement) createFFmpegLog();
    
    const fullText = `$ ${command}\n\n${output.join('\n')}`;
    const lines = fullText.split('\n');
    const truncated = lines.length > 200 ? lines.slice(-200).join('\n') : fullText;
    
    state.ffmpegLogElement.textContent = truncated;
    if (state.ffmpegLogVisible) {
        state.ffmpegLogElement.scrollTop = state.ffmpegLogElement.scrollHeight;
    }
}
