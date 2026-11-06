(function(){
  const log = window.__castLog = [];
  const L = {}, R = {};
  let session = null, state = 'NOT_CONNECTED';
  const fire = (t) => (L[t] || []).forEach((f) => f({}));
  const rp = { isPaused: false, currentTime: 0, duration: 0, volumeLevel: 1, isMuted: false };
  const rfire = (t) => (R[t] || []).forEach((f) => f());
  const ctx = {
    setOptions(o) { log.push(['setOptions', o.receiverApplicationId]); },
    getCastState() { return state; },
    getCurrentSession() { return session; },
    addEventListener(t, f) { (L[t] = L[t] || []).push(f); },
    removeEventListener() {},
    requestSession() {
      session = { getCastDevice() { return { friendlyName: 'Living Room TV' }; },
        loadMedia(req) { log.push(['load', req.media.contentType, req.media.streamType, req.media.metadata.title, Math.round(req.currentTime || 0), req.media.contentId.slice(0, 60)]); rp.isPaused = false; rp.duration = req.media.streamType === 'BUFFERED' ? 5400 : 0; rp.currentTime = req.currentTime || 0; rfire('isPausedChanged'); rfire('durationChanged'); return Promise.resolve(); } };
      state = 'CONNECTED'; log.push(['connected']); fire('caststatechanged'); fire('sessionstatechanged'); return Promise.resolve();
    },
    endCurrentSession() { session = null; state = 'NOT_CONNECTED'; log.push(['end']); fire('caststatechanged'); fire('sessionstatechanged'); },
  };
  function RemotePlayer() { return rp; }
  function RemotePlayerController() { return {
    addEventListener(t, f) { (R[t] = R[t] || []).push(f); },
    playOrPause() { rp.isPaused = !rp.isPaused; log.push(['playOrPause', rp.isPaused]); rfire('isPausedChanged'); },
    seek() { log.push(['seek', Math.round(rp.currentTime)]); rfire('currentTimeChanged'); },
    setVolumeLevel() { log.push(['volume', rp.volumeLevel]); rfire('volumeLevelChanged'); },
    muteOrUnmute() { rp.isMuted = !rp.isMuted; log.push(['mute', rp.isMuted]); rfire('isMutedChanged'); },
  }; }
  window.cast = { framework: { CastContext: { getInstance: () => ctx },
    CastState: { NO_DEVICES_AVAILABLE: 'NO_DEVICES_AVAILABLE', NOT_CONNECTED: 'NOT_CONNECTED', CONNECTED: 'CONNECTED' },
    CastContextEventType: { CAST_STATE_CHANGED: 'caststatechanged', SESSION_STATE_CHANGED: 'sessionstatechanged' },
    RemotePlayer, RemotePlayerController,
    RemotePlayerEventType: { IS_PAUSED_CHANGED: 'isPausedChanged', CURRENT_TIME_CHANGED: 'currentTimeChanged', DURATION_CHANGED: 'durationChanged', VOLUME_LEVEL_CHANGED: 'volumeLevelChanged', IS_MUTED_CHANGED: 'isMutedChanged' } } };
  function MediaInfo(id, type) { this.contentId = id; this.contentType = type; }
  function GenericMediaMetadata() {}
  function LoadRequest(m) { this.media = m; }
  window.chrome = window.chrome || {};
  window.chrome.cast = { media: { DEFAULT_MEDIA_RECEIVER_APP_ID: 'CC1AD845', MediaInfo, GenericMediaMetadata, LoadRequest, StreamType: { LIVE: 'LIVE', BUFFERED: 'BUFFERED' }, HlsVideoSegmentFormat: { MPEG2_TS: 'mpeg2_ts' } }, AutoJoinPolicy: { ORIGIN_SCOPED: 'origin_scoped' }, Image: function (u) { this.url = u; } };
  setTimeout(() => window.__onGCastApiAvailable && window.__onGCastApiAvailable(true), 30);
})();
