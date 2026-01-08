export const state = {
    allChannels: [],
    currentSessionId: null,
    heartbeatInterval: null,
    epgData: null,
    ffmpegLogVisible: false,
    ffmpegLogElement: null,
    currentChannel: null,
    epgOnlyMode: localStorage.getItem('epgOnlyMode') === 'true',
    previewsIndex: {},
    socket: io(),
    currentPage: 1,
    itemsPerPage: 100,
    filteredChannels: [] // Keep track of current filtered list
};
