


        let currentSessionId = null;
        let heartbeatInterval = null;
        let epgData = null;
        let ffmpegLogVisible = false;
        let ffmpegLogElement = null;
        let currentChannel = null;
        let epgOnlyMode = localStorage.getItem('epgOnlyMode') === 'true';
        let previewsIndex = {};

        async function loadChannels() {
            try {
                const response = await fetch('/api/channels');
                const data = await response.json();
                
                if (data.error) {
                    throw new Error(data.error);
                }

                allChannels = data.channels;
                
                // Restore toggle state
                const toggle = document.getElementById('epgOnlyToggle');
                toggle.checked = epgOnlyMode;
                
                // Load EPG data in background
                loadEPGBackground();
                
                // Load previews index
                loadPreviewsIndex();
                
                displayChannels(allChannels);
                updateStats(allChannels.length, allChannels.length);
            } catch (error) {
                document.getElementById('content').innerHTML = `
                    <div class="error">
                        <h2>❌ Errore</h2>
                        <p>${error.message}</p>
                    </div>
                `;
            }
        }

        function displayChannels(channels) {
            const content = document.getElementById('content');
            
            if (channels.length === 0) {
                content.innerHTML = '<div class="loading">Nessun canale trovato</div>';
                return;
            }

            // Filter channels with EPG if in EPG-only mode
            let displayChannels = channels;
            if (epgOnlyMode) {
                displayChannels = channels.filter(ch =&gt; {
                    return epgData &amp;&amp; ch.tvgId &amp;&amp; epgData.epgData[ch.tvgId] &amp;&amp; epgData.epgData[ch.tvgId].length &gt; 0;
                });

                // Sort by channel number (extract from id or name)
                displayChannels.sort((a, b) =&gt; {
                    const getNumber = (ch) =&gt; {
                        const match = (ch.id || ch.name).match(/\d+/);
                        return match ? parseInt(match[0]) : 9999;
                    };
                    return getNumber(a) - getNumber(b);
                });
            }

            if (epgOnlyMode) {
                // List view
                displayListView(displayChannels);
            } else {
                // Grid view
                displayGridView(displayChannels);
            }
        }

        function displayListView(channels) {
            const content = document.getElementById('content');
            const list = document.createElement('div');
            list.className = 'channels-list';

            console.log('DisplayListView - previewsIndex keys:', Object.keys(previewsIndex).length);
            
            channels.forEach(channel =&gt; {
                const item = document.createElement('div');
                item.className = 'channel-list-item';

                // Preview or logo element
                let previewElement = '';
                const hasPreview = previewsIndex[channel.tvgId] &amp;&amp; previewsIndex[channel.tvgId].status === 'success';
                
                if (hasPreview) {
                    const previewUrl = `/streams/previews/${channel.tvgId}.jpg`;
                    previewElement = `<img src="${previewUrl}" alt="Preview" class="channel-list-preview">`;
                } else if (channel.logo) {
                    previewElement = `<img src="${channel.logo}" alt="${channel.name}" class="channel-list-preview logo-mode" onerror="this.outerHTML='&lt;div class=\\'channel-list-logo placeholder\\'&gt;${channel.name.charAt(0).toUpperCase()}&lt;/div&gt;';">`;
                } else {
                    previewElement = `<div class="channel-list-logo placeholder">${channel.name.charAt(0).toUpperCase()}</div>`;
                }

                // Get current program only
                const programs = epgData.epgData[channel.tvgId];
                const now = new Date();
                
                let currentProgram = programs.find(p =&gt; {
                    const start = new Date(p.start);
                    const stop = new Date(p.stop);
                    return now &gt;= start &amp;&amp; now &lt;= stop;
                });

                // If no current program, don't show past programs
                let timeStr = '';
                let currentText = '';

                if (currentProgram) {
                    const start = new Date(currentProgram.start);
                    const stop = new Date(currentProgram.stop);
                    timeStr = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')} - ${stop.getHours().toString().padStart(2, '0')}:${stop.getMinutes().toString().padStart(2, '0')}`;
                    currentText = currentProgram.title;
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

                item.addEventListener('click', () =&gt; {
                    startStream(channel);
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

            channels.forEach(channel =&gt; {
                const card = document.createElement('div');
                card.className = 'channel-card';

                let logoElement;
                if (channel.logo) {
                    logoElement = `<img src="${channel.logo}" alt="${channel.name}" class="channel-logo" onerror="this.onerror=null; this.style.display='none'; this.parentElement.insertAdjacentHTML('afterbegin', '&lt;div class=\\'channel-name\\'&gt;${channel.name}&lt;/div&gt;')">`;
                } else {
                    const initial = channel.name.charAt(0).toUpperCase();
                    logoElement = `<div class="channel-logo placeholder">${initial}</div>`;
                }

                // Get current program
                let epgInfoHtml = '';
                const hasEPG = epgData &amp;&amp; channel.tvgId &amp;&amp; epgData.epgData[channel.tvgId];
                
                if (hasEPG) {
                    const now = new Date();
                    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    const tomorrow = new Date(today);
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    
                    const programs = epgData.epgData[channel.tvgId];
                    
                    // Find current program only from today
                    let currentProgram = programs.find(p =&gt; {
                        const start = new Date(p.start);
                        const stop = new Date(p.stop);
                        return start &gt;= today &amp;&amp; start &lt; tomorrow &amp;&amp; now &gt;= start &amp;&amp; now &lt;= stop;
                    });
                    
                    // If no current program, show next upcoming program
                    if (!currentProgram) {
                        currentProgram = programs.find(p =&gt; {
                            const start = new Date(p.start);
                            return start &gt; now;
                        });
                    }

                    if (currentProgram) {
                        const start = new Date(currentProgram.start);
                        const stop = new Date(currentProgram.stop);
                        const timeStr = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}-${stop.getHours().toString().padStart(2, '0')}:${stop.getMinutes().toString().padStart(2, '0')}`;
                        epgInfoHtml = `
                            <div class="epg-info" onclick="event.stopPropagation(); showChannelEPG('${channel.tvgId}', '${channel.name.replace(/'/g, " \\'")}')"="">
                                <div class="epg-info-time">${timeStr}</div>
                                <div class="epg-info-title">${currentProgram.title}</div>
                            </div>
                        `;
                    } else {
                        epgInfoHtml = `
                            <div class="no-epg-placeholder" onclick="event.stopPropagation(); showChannelEPG('${channel.tvgId}', '${channel.name.replace(/'/g, " \\'")}')"="">
                                📋 Visualizza EPG
                            </div>
                        `;
                    }
                }

                card.innerHTML = `
                    ${channel.isStreaming ? '<div class="streaming-indicator"></div>' : ''}
                    ${logoElement}
                    ${epgInfoHtml}
                    ${channel.group ? `<div class="channel-group">${channel.group}</div>` : ''}
                `;

                // Click on card (but not on EPG area) = play
                card.addEventListener('click', (e) =&gt; {
                    if (!e.target.closest('.epg-info') &amp;&amp; !e.target.closest('.no-epg-placeholder')) {
                        startStream(channel);
                    }
                });

                grid.appendChild(card);
            });

            content.innerHTML = '';
            content.appendChild(grid);
        }

        function showChannelEPG(tvgId, channelName) {
            if (!tvgId || !epgData || !epgData.epgData[tvgId]) {
                alert('Nessun EPG disponibile per questo canale');
                return;
            }

            const overlay = document.getElementById('epgOverlay');
            const modalTitle = document.getElementById('epgModalTitle');
            const modalContent = document.getElementById('epgModalContent');

            modalTitle.textContent = `EPG - ${channelName}`;

            const programs = epgData.epgData[tvgId];
            const now = new Date();

            // Group programs by date
            const programsByDate = {};
            programs.forEach(program =&gt; {
                const startTime = new Date(program.start);
                const endTime = new Date(program.stop);
                
                // Skip past programs
                if (now &gt; endTime) {
                    return;
                }
                
                // Get date key (YYYY-MM-DD)
                const dateKey = startTime.toISOString().split('T')[0];
                if (!programsByDate[dateKey]) {
                    programsByDate[dateKey] = [];
                }
                programsByDate[dateKey].push(program);
            });

            let html = '';
            const sortedDates = Object.keys(programsByDate).sort();
            
            sortedDates.forEach(dateKey =&gt; {
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
                
                programsByDate[dateKey].forEach(program =&gt; {
                    const startTime = new Date(program.start);
                    const endTime = new Date(program.stop);
                    
                    let programClass = 'epg-program';
                    if (now &gt;= startTime &amp;&amp; now &lt;= endTime) {
                        programClass += ' current';
                    }

                    const timeStr = `${startTime.getHours().toString().padStart(2, '0')}:${startTime.getMinutes().toString().padStart(2, '0')} - ${endTime.getHours().toString().padStart(2, '0')}:${endTime.getMinutes().toString().padStart(2, '0')}`;

                    html += `<div class="${programClass}">`;
                    html += `<div class="epg-time">${timeStr}</div>`;
                    html += `<div class="epg-title">${program.title || 'Nessun titolo'}</div>`;
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

        function closeEPGOverlay() {
            document.getElementById('epgOverlay').classList.remove('active');
        }

        async function startStream(channel) {
            // Store current channel
            currentChannel = channel;
            
            // Show overlay with spinner
            const overlay = document.getElementById('videoOverlay');
            const videoContent = document.getElementById('videoContent');
            overlay.classList.add('active');
            
            videoContent.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; padding: 60px;">
                    <div class="spinner"></div>
                    <div class="loading-message">Avvio stream ${channel.name}...</div>
                </div>
            `;

            try {
                // Start stream on backend
                const response = await fetch('/api/stream/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        streamUrl: channel.stream,
                        channelName: channel.name
                    })
                });

                const data = await response.json();
                
                // Check for 429 status (Too Many Requests - max streams reached)
                if (response.status === 429) {
                    videoContent.innerHTML = `
                        <div style="color: white; padding: 60px; text-align: center;">
                            <h2>⚠️ Limite Raggiunto</h2>
                            <p>Numero massimo di stream simultanei raggiunto (${data.maxStreams || 'N/A'})</p>
                            <p>Stream attivi: ${data.activeStreams || 'N/A'}</p>
                            <p>Riprova tra qualche minuto</p>
                            <button onclick="closeVideoPlayer()" style="margin-top: 20px; padding: 10px 20px; background: #e74c3c; color: white; border: none; border-radius: 4px; cursor: pointer;">Chiudi</button>
                        </div>
                    `;
                    return;
                }
                
                if (data.error) {
                    throw new Error(data.error);
                }

                currentSessionId = data.sessionId;
                
                // Poll for stream readiness
                await pollStreamStatus(data.sessionId, data.m3u8Url, channel.name);
                
            } catch (error) {
                console.error('Error starting stream:', error);
                videoContent.innerHTML = `
                    <div style="color: white; padding: 60px; text-align: center;">
                        <h2>❌ Errore</h2>
                        <p>${error.message}</p>
                    </div>
                `;
            }
        }

        async function pollStreamStatus(sessionId, m3u8Url, channelName) {
            const maxAttempts = 30; // 30 seconds max
            let attempts = 0;
            const videoContent = document.getElementById('videoContent');

            const checkStatus = async () =&gt; {
                try {
                    const response = await fetch(`/api/stream/status/${sessionId}`);
                    const status = await response.json();

                    // Update progress bar
                    const progress = status.progress || 0;
                    
                    videoContent.innerHTML = `
                        <div style="display: flex; flex-direction: column; align-items: center; padding: 60px 40px; width: 100%; max-width: 900px;">
                            <div class="loading-message">Preparazione stream ${channelName}...</div>
                            <div style="width: 100%; margin-top: 20px;">
                                <div style="background: rgba(255,255,255,0.2); border-radius: 10px; height: 30px; overflow: hidden;">
                                    <div style="background: linear-gradient(90deg, #4caf50, #8bc34a); height: 100%; width: ${progress}%; transition: width 0.3s; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;">
                                        ${progress}%
                                    </div>
                                </div>
                                <div style="color: #aaa; margin-top: 10px; text-align: center; font-size: 0.9em;">
                                    ${status.tsCount || 0} segmenti / ${status.elapsedTime || 0}s
                                </div>
                            </div>
                        </div>
                    `;
                    
                    // Update FFmpeg log
                    updateFFmpegLog(status.ffmpegCommand || '', status.ffmpegOutput || []);

                    if (status.ready) {
                        // Stream is ready, keep FFmpeg log visible and load video player
                        loadVideoPlayer(m3u8Url, currentChannel);
                        return true;
                    } else if (status.error) {
                        throw new Error(status.error);
                    }

                    attempts++;
                    if (attempts &gt;= maxAttempts) {
                        throw new Error('Timeout: stream non pronto');
                    }

                    // Check again in 1 second
                    setTimeout(checkStatus, 1000);
                } catch (error) {
                    console.error('Error polling stream:', error);
                    document.getElementById('videoContent').innerHTML = `
                        <div style="color: white; padding: 60px; text-align: center;">
                            <h2>❌ Errore</h2>
                            <p>${error.message}</p>
                        </div>
                    `;
                }
            };

            checkStatus();
        }

        function loadVideoPlayer(m3u8Url, channel) {
            const videoContent = document.getElementById('videoContent');
            
            // Build EPG content if available
            let epgHtml = '';
            if (epgData &amp;&amp; channel.tvgId &amp;&amp; epgData.epgData[channel.tvgId]) {
                const now = new Date();
                const programs = epgData.epgData[channel.tvgId];
                
                // Get current and next programs
                const currentProgram = programs.find(p =&gt; {
                    const start = new Date(p.start);
                    const stop = new Date(p.stop);
                    return now &gt;= start &amp;&amp; now &lt;= stop;
                });
                
                const futurePrograms = programs.filter(p =&gt; {
                    const start = new Date(p.start);
                    return start &gt; now;
                }).slice(0, 5);
                
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
                    if (currentProgram.desc) {
                        epgHtml += `<div style="margin-top: 8px; font-size: 0.9em; color: #ccc;">${currentProgram.desc}</div>`;
                    }
                    if (currentProgram.category) {
                        epgHtml += `<div style="margin-top: 8px;"><span style="background: rgba(76, 175, 80, 0.3); padding: 4px 8px; border-radius: 4px; font-size: 0.8em;">${currentProgram.category}</span></div>`;
                    }
                    epgHtml += '</div>';
                }
                
                if (futurePrograms.length &gt; 0) {
                    epgHtml += '<div style="color: #888; font-weight: bold; font-size: 0.85em; margin-bottom: 10px; margin-top: 20px;">UP NEXT</div>';
                    futurePrograms.forEach(program =&gt; {
                        const start = new Date(program.start);
                        const stop = new Date(program.stop);
                        const timeStr = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')} - ${stop.getHours().toString().padStart(2, '0')}:${stop.getMinutes().toString().padStart(2, '0')}`;
                        
                        epgHtml += '<div style="padding: 12px; margin-bottom: 10px; background: rgba(255,255,255,0.05); border-radius: 6px;">';
                        epgHtml += `<div style="font-weight: 500; margin-bottom: 3px;">${program.title}</div>`;
                        epgHtml += `<div style="color: #888; font-size: 0.85em;">${timeStr}</div>`;
                        if (program.category) {
                            epgHtml += `<div style="margin-top: 5px;"><span style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 3px; font-size: 0.75em; color: #aaa;">${program.category}</span></div>`;
                        }
                        epgHtml += '</div>';
                    });
                }
                
                epgHtml += '</div>';
            } else {
                epgHtml = '<div style="padding: 20px; color: #888; text-align: center;"><p>No EPG data available</p></div>';
            }
            
            videoContent.innerHTML = `
                <div style="height: 100%; display: flex; flex-direction: column; background: #000;">
                    <div id="videoWrapper" style="flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                        <video id="videoPlayer" controls="" autoplay="" style="max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain;"></video>
                    </div>
                    <div style="color: white; padding: 15px; background: rgba(0,0,0,0.9);">
                        <h3 style="margin: 0;">${channel.name}</h3>
                    </div>
                </div>
            `;
            
            // Add EPG sidebar and toggle to overlay (outside video container)
            const overlay = document.getElementById('videoOverlay');
            
            // Remove existing EPG elements if any
            const existingSidebar = document.getElementById('epgSidebar');
            const existingToggle = document.getElementById('epgToggle');
            if (existingSidebar) existingSidebar.remove();
            if (existingToggle) existingToggle.remove();
            
            // Create EPG sidebar
            const epgSidebar = document.createElement('div');
            epgSidebar.id = 'epgSidebar';
            epgSidebar.style.cssText = 'position: fixed; right: 0; top: 0; bottom: 0; width: 350px; background: rgba(0,0,0,0.95); color: white; transform: translateX(100%); transition: transform 0.3s ease; z-index: 10001; overflow-y: auto;';
            epgSidebar.innerHTML = `${epgHtml}`;
            
            // Create EPG toggle tab
            const epgToggle = document.createElement('div');
            epgToggle.id = 'epgToggle';
            epgToggle.onclick = toggleEPGSidebar;
            epgToggle.style.cssText = 'position: fixed; right: 0; top: 50%; transform: translateY(-50%); background: rgba(76, 175, 80, 0.9); color: white; padding: 30px 8px; cursor: pointer; border-radius: 8px 0 0 8px; font-weight: bold; writing-mode: vertical-rl; text-orientation: mixed; font-size: 14px; letter-spacing: 2px; z-index: 10002; box-shadow: -2px 0 10px rgba(0,0,0,0.3); transition: right 0.3s ease;';
            epgToggle.textContent = 'EPG';
            
            document.body.appendChild(epgSidebar);
            document.body.appendChild(epgToggle);

            const video = document.getElementById('videoPlayer');
            const videoWrapper = document.getElementById('videoWrapper');

            // Resize video to max dimensions when metadata is loaded
            function resizeVideo() {
                if (video.videoWidth &amp;&amp; video.videoHeight) {
                    const videoRatio = video.videoWidth / video.videoHeight;
                    const wrapperWidth = videoWrapper.clientWidth;
                    const wrapperHeight = videoWrapper.clientHeight;
                    const wrapperRatio = wrapperWidth / wrapperHeight;
                    
                    if (videoRatio &gt; wrapperRatio) {
                        // Video is wider - fit to width
                        video.style.width = '100%';
                        video.style.height = 'auto';
                    } else {
                        // Video is taller - fit to height
                        video.style.width = 'auto';
                        video.style.height = '100%';
                    }
                }
            }

            // Resize on metadata load and window resize
            video.addEventListener('loadedmetadata', resizeVideo);
            window.addEventListener('resize', resizeVideo);

            if (Hls.isSupported()) {
                const hls = new Hls({
                    enableWorker: true,
                    lowLatencyMode: true,
                    backBufferLength: 90
                });
                
                hls.loadSource(m3u8Url);
                hls.attachMedia(video);
                
                hls.on(Hls.Events.MANIFEST_PARSED, () =&gt; {
                    video.play();
                });

                hls.on(Hls.Events.ERROR, (event, data) =&gt; {
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

                // Store hls instance for cleanup
                video.hlsInstance = hls;
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                // Native HLS support (Safari)
                video.src = m3u8Url;
                video.addEventListener('loadedmetadata', () =&gt; {
                    video.play();
                });
            }

            // Start heartbeat to keep stream alive
            startHeartbeat();
        }

        function startHeartbeat() {
            if (heartbeatInterval) {
                clearInterval(heartbeatInterval);
            }

            heartbeatInterval = setInterval(() =&gt; {
                if (currentSessionId) {
                    fetch(`/api/stream/heartbeat/${currentSessionId}`, {
                        method: 'POST'
                    }).catch(err =&gt; console.error('Heartbeat error:', err));
                }
            }, 10000); // Every 10 seconds
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

        function stopStream() {
            // Remove resize listener
            window.removeEventListener('resize', resizeVideo);
            
            // Remove EPG elements
            const epgSidebar = document.getElementById('epgSidebar');
            const epgToggle = document.getElementById('epgToggle');
            if (epgSidebar) epgSidebar.remove();
            if (epgToggle) epgToggle.remove();
            
            // Stop heartbeat
            if (heartbeatInterval) {
                clearInterval(heartbeatInterval);
                heartbeatInterval = null;
            }

            // Destroy HLS instance
            const video = document.getElementById('videoPlayer');
            if (video &amp;&amp; video.hlsInstance) {
                video.hlsInstance.destroy();
            }

            // Stop stream on backend
            if (currentSessionId) {
                fetch(`/api/stream/stop/${currentSessionId}`, {
                    method: 'POST'
                }).catch(err =&gt; console.error('Error stopping stream:', err));
                
                currentSessionId = null;
            }

            // Hide overlay
            document.getElementById('videoOverlay').classList.remove('active');
        }

        // Close button handlers
        document.getElementById('closeButton').addEventListener('click', stopStream);
        document.getElementById('epgCloseBtn').addEventListener('click', closeEPGOverlay);

        function updateStats(displayed, total) {
            const stats = document.getElementById('stats');
            stats.textContent = `Visualizzati ${displayed} di ${total} canali`;
        }

        // Search functionality
        document.getElementById('searchInput').addEventListener('input', (e) =&gt; {
            const searchTerm = e.target.value.toLowerCase();
            const filtered = allChannels.filter(channel =&gt; 
                channel.name.toLowerCase().includes(searchTerm) ||
                channel.group.toLowerCase().includes(searchTerm)
            );
            displayChannels(filtered);
            updateStats(filtered.length, allChannels.length);
        });

        // EPG functionality
        async function loadEPGBackground() {
            try {
                const response = await fetch('/api/epg');
                const data = await response.json();
                
                if (!data.error) {
                    epgData = data;
                    // Refresh channel display to show current programs
                    displayChannels(allChannels);
                }
            } catch (error) {
                console.error('Error loading EPG in background:', error);
            }
        }

        async function loadPreviewsIndex() {
            try {
                const response = await fetch('/api/previews-index');
                if (response.ok) {
                    previewsIndex = await response.json();
                    console.log('Previews index loaded:', Object.keys(previewsIndex).length, 'channels');
                }
            } catch (error) {
                console.log('No previews index available yet');
            }
        }

        // FFmpeg log management
        function updateFFmpegLog(command, output) {
            if (!ffmpegLogElement) {
                createFFmpegLog();
            }
            
            const fullText = `$ ${command}\n\n${output.join('\n')}`;
            const truncated = fullText.length &gt; 5000 ? fullText.slice(-5000) : fullText;
            
            ffmpegLogElement.textContent = truncated;
            
            // Auto-scroll to bottom if visible
            if (ffmpegLogVisible) {
                ffmpegLogElement.scrollTop = ffmpegLogElement.scrollHeight;
            }
        }
        
        function createFFmpegLog() {
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
                display: ${ffmpegLogVisible ? 'block' : 'none'};
            `;
            document.body.appendChild(logDiv);
            ffmpegLogElement = logDiv;
        }
        
        function toggleFFmpegLog() {
            ffmpegLogVisible = !ffmpegLogVisible;
            if (ffmpegLogElement) {
                ffmpegLogElement.style.display = ffmpegLogVisible ? 'block' : 'none';
                if (ffmpegLogVisible) {
                    ffmpegLogElement.scrollTop = ffmpegLogElement.scrollHeight;
                }
            }
        }
        
        // Keyboard shortcut: H to toggle FFmpeg log
        window.addEventListener('keydown', (e) =&gt; {
            if (e.key === 'h' || e.key === 'H') {
                e.preventDefault();
                toggleFFmpegLog();
            }
        });

        // Toggle EPG-only mode
        document.getElementById('epgOnlyToggle').addEventListener('change', (e) =&gt; {
            epgOnlyMode = e.target.checked;
            
            // Save state to localStorage
            localStorage.setItem('epgOnlyMode', epgOnlyMode);
            
            // Apply search filter
            const searchTerm = document.getElementById('searchInput').value.toLowerCase();
            const filtered = searchTerm ? 
                allChannels.filter(ch => ch.name.toLowerCase().includes(searchTerm)) : 
                allChannels;
            
            displayChannels(filtered);
            updateStats(filtered.length, allChannels.length);
        });

        // Load channels on page load
        loadChannels();
    

