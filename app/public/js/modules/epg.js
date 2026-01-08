import { state } from './state.js';
import { fetchEPG } from './api.js';

export async function loadEPGBackground(refreshCallback) {
    try {
        const data = await fetchEPG();
        
        if (!data.error) {
            state.epgData = data;
            if (refreshCallback) refreshCallback();
        }
    } catch (error) {
        console.error('Error loading EPG in background:', error);
    }
}

export function showChannelEPG(tvgId, channelName) {
    if (!tvgId || !state.epgData || !state.epgData.epgData[tvgId]) {
        alert('No EPG available for this channel');
        return;
    }

    const overlay = document.getElementById('epgOverlay');
    const modalTitle = document.getElementById('epgModalTitle');
    const modalContent = document.getElementById('epgModalContent');

    modalTitle.textContent = `EPG - ${channelName}`;

    const programs = state.epgData.epgData[tvgId];
    const now = new Date();

    // Group programs by date
    const programsByDate = {};
    programs.forEach(program => {
        const startTime = new Date(program.start);
        const endTime = new Date(program.stop);
        
        // Skip past programs
        if (now > endTime) return;
        
        const dateKey = startTime.toISOString().split('T')[0];
        if (!programsByDate[dateKey]) programsByDate[dateKey] = [];
        programsByDate[dateKey].push(program);
    });

    let html = '';
    const sortedDates = Object.keys(programsByDate).sort();
    
    sortedDates.forEach(dateKey => {
        const date = new Date(dateKey);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dateObj = new Date(date);
        dateObj.setHours(0, 0, 0, 0);
        
        // Format date header
        let dateHeader = '';
        if (dateObj.getTime() === today.getTime()) {
            dateHeader = 'Today';
        } else {
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            dateHeader = date.toLocaleDateString('en-US', options);
        }
        
        html += `<div style="background: #2a2a2a; padding: 10px; margin: 15px 0 10px 0; border-radius: 5px; font-weight: bold; color: #4caf50;">${dateHeader}</div>`;
        
        programsByDate[dateKey].forEach(program => {
            const startTime = new Date(program.start);
            const endTime = new Date(program.stop);
            
            let programClass = 'epg-program';
            if (now >= startTime && now <= endTime) {
                programClass += ' current';
            }

            const timeStr = `${startTime.getHours().toString().padStart(2, '0')}:${startTime.getMinutes().toString().padStart(2, '0')} - ${endTime.getHours().toString().padStart(2, '0')}:${endTime.getMinutes().toString().padStart(2, '0')}`;

            html += `<div class="${programClass}">`;
            html += `<div class="epg-time">${timeStr}</div>`;
            html += `<div class="epg-title">${program.title || 'No title'}</div>`;
            if (program.desc) {
                html += `<div class="epg-desc">${program.desc}</div>`;
            }
            if (program.category) {
                const cat = String(program.category).trim();
                if (cat) {
                    html += `<span class="epg-category">${cat}</span>`;
                }
            }
            html += `</div>`;
        });
    });

    modalContent.innerHTML = html;
    overlay.classList.add('active');
}

export function closeEPGOverlay() {
    document.getElementById('epgOverlay').classList.remove('active');
}
