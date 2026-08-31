(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const wrapper = $("videoWrapper");
  const video = $("player");
  const playBtn = $("playBtn");
  const centerPlay = $("centerPlay");
  const muteBtn = $("muteBtn");
  const volumeSlider = $("volumeSlider");
  const timeDisplay = $("timeDisplay");
  const progressWrap = $("progressWrap");
  const progressBg = $("progressBg");
  const progressBuffered = $("progressBuffered");
  const progressFill = $("progressFill");
  const progressThumb = $("progressThumb");
  const timeTooltip = $("timeTooltip");
  const speedBtn = $("speedBtn");
  const fitBtn = $("fitBtn");
  const pipBtn = $("pipBtn");
  const fsBtn = $("fsBtn");
  const moreBtn = $("moreBtn");
  const menu = $("contextMenu");
  const loadingLayer = $("loadingLayer");
  const loadingText = $("loadingText");
  const statusPill = $("statusPill");
  const errorLayer = $("errorLayer");
  const errorMessage = $("errorMessage");
  const errorOpenExternal = $("errorOpenExternal");
  const seekFeedback = $("seekFeedback");

  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
  const fits = [
    ["contain", "Fit"],
    ["cover", "Fill"],
    ["none", "Original"],
  ];

  let speedIndex = 2;
  let fitIndex = 0;
  let audio = null;
  let controlsTimer = null;
  let statusTimer = null;
  let clickTimer = null;
  let dragging = false;
  let sourceLoaded = false;
  let fallbackRequested = false;
  let usingFallback = false;
  let restorePosition = 0;

  const icons = {
    play: '<svg viewBox="0 0 24 24"><path d="M7 4.8v14.4L19 12z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zm8 0h4v16h-4z" fill="currentColor"/></svg>',
    volume: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 4V5L7 9H3zm12.5-.5a5 5 0 010 7M18 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    muted: '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 4V5L7 9H3z" fill="currentColor"/><path d="M16 9l5 6m0-6l-5 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    pip: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="12" y="11" width="7" height="5" rx=".8" fill="currentColor"/></svg>',
    fullscreen: '<svg viewBox="0 0 24 24"><path d="M8 3H3v5m13-5h5v5M8 21H3v-5m13 5h5v-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    exitFullscreen: '<svg viewBox="0 0 24 24"><path d="M3 8h5V3m13 5h-5V3M3 16h5v5m13-5h-5v5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  };

  function fmt(value) {
    if (!Number.isFinite(value) || value < 0) return "0:00";
    const total = Math.floor(value);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  }

  function activeAudio() {
    return audio || video;
  }

  function showControls() {
    wrapper.classList.add("controls-visible");
    clearTimeout(controlsTimer);
    if (!video.paused && !dragging && errorLayer.hidden) {
      controlsTimer = setTimeout(() => wrapper.classList.remove("controls-visible"), 2500);
    }
  }

  function showLoading(message) {
    loadingText.textContent = message;
    loadingLayer.hidden = false;
  }

  function hideLoading() {
    loadingLayer.hidden = true;
  }

  function showStatus(message, timeout) {
    clearTimeout(statusTimer);
    statusPill.textContent = message;
    statusPill.hidden = false;
    if (timeout) statusTimer = setTimeout(() => (statusPill.hidden = true), timeout);
  }

  function showError(message) {
    hideLoading();
    statusPill.hidden = true;
    errorMessage.textContent = message;
    errorLayer.hidden = false;
    video.pause();
    audio?.pause();
    showControls();
  }

  function updateButtons() {
    playBtn.innerHTML = video.paused ? icons.play : icons.pause;
    centerPlay.innerHTML = icons.play;
    centerPlay.classList.toggle("visible", video.paused && errorLayer.hidden);
    const target = activeAudio();
    muteBtn.innerHTML = target.muted || target.volume === 0 ? icons.muted : icons.volume;
    pipBtn.innerHTML = icons.pip;
    fsBtn.innerHTML = document.fullscreenElement ? icons.exitFullscreen : icons.fullscreen;
  }

  function updateProgress() {
    timeDisplay.textContent = `${fmt(video.currentTime)} / ${fmt(video.duration)}`;
    if (!Number.isFinite(video.duration) || video.duration <= 0 || dragging) return;
    const value = (video.currentTime / video.duration) * 100;
    progressFill.style.width = `${value}%`;
    progressThumb.style.left = `${value}%`;
  }

  function updateBuffered() {
    if (!video.buffered.length || !Number.isFinite(video.duration) || video.duration <= 0) return;
    let end = 0;
    for (let i = 0; i < video.buffered.length; i++) end = Math.max(end, video.buffered.end(i));
    progressBuffered.style.width = `${Math.min(100, (end / video.duration) * 100)}%`;
  }

  function setTime(value) {
    if (!Number.isFinite(value)) return;
    const end = Number.isFinite(video.duration) ? video.duration : value;
    const next = Math.max(0, Math.min(end, value));
    video.currentTime = next;
    if (audio && audio.readyState) audio.currentTime = Math.min(next, audio.duration || next);
  }

  function seek(seconds) {
    setTime(video.currentTime + seconds);
    seekFeedback.textContent = seconds > 0 ? `+${seconds}s` : `${seconds}s`;
    seekFeedback.classList.remove("show");
    void seekFeedback.offsetWidth;
    seekFeedback.classList.add("show");
    setTimeout(() => seekFeedback.classList.remove("show"), 500);
  }

  function syncAudio(force) {
    if (!audio || !audio.readyState) return;
    if (force || Math.abs(audio.currentTime - video.currentTime) > 0.2) {
      audio.currentTime = Math.min(video.currentTime, audio.duration || video.currentTime);
    }
    audio.playbackRate = video.playbackRate;
  }

  function togglePlay() {
    if (!video.src || !errorLayer.hidden) return;
    if (video.paused) {
      video.play().catch(() => {});
      if (audio) {
        syncAudio(true);
        audio.play().catch(() => {});
      }
    } else {
      video.pause();
    }
  }

  function toggleMute() {
    const target = activeAudio();
    target.muted = !target.muted;
    if (!target.muted && target.volume === 0) target.volume = 1;
    if (audio) video.muted = true;
    volumeSlider.value = target.muted ? "0" : String(target.volume);
    updateButtons();
  }

  function cycleSpeed() {
    speedIndex = (speedIndex + 1) % speeds.length;
    video.playbackRate = speeds[speedIndex];
    if (audio) audio.playbackRate = video.playbackRate;
    speedBtn.textContent = `${speeds[speedIndex]}×`;
  }

  function cycleFit() {
    fitIndex = (fitIndex + 1) % fits.length;
    video.dataset.fit = fits[fitIndex][0];
    fitBtn.textContent = fits[fitIndex][1];
  }

  async function togglePiP() {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (document.pictureInPictureEnabled) await video.requestPictureInPicture();
    } catch (error) {
      showStatus(error?.message || "Picture-in-Picture unavailable", 2500);
    }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await wrapper.requestFullscreen();
    } catch (error) {
      showStatus(error?.message || "Fullscreen unavailable", 2500);
    }
  }

  function addMenuItem(label, command) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-item";
    button.textContent = label;
    button.onclick = () => {
      menu.classList.remove("open");
      if (command === "speed") cycleSpeed();
      else if (command === "fit") cycleFit();
      else vscode.postMessage({ type: "command", command });
    };
    menu.appendChild(button);
  }

  function openMenu(x, y) {
    menu.innerHTML = "";
    addMenuItem("Open externally", "openExternal");
    addMenuItem("Copy file path", "copyPath");
    addMenuItem(`Speed: ${speeds[speedIndex]}×`, "speed");
    addMenuItem(`Sizing: ${fits[fitIndex][1]}`, "fit");
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - 210))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - 170))}px`;
    menu.classList.add("open");
  }

  function seekFromPointer(event) {
    if (!Number.isFinite(video.duration)) return;
    const rect = progressBg.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    setTime(video.duration * pct);
    progressFill.style.width = `${pct * 100}%`;
    progressThumb.style.left = `${pct * 100}%`;
  }

  wrapper.onpointermove = showControls;
  wrapper.onpointerenter = showControls;
  wrapper.onmouseleave = () => {
    if (!video.paused && !dragging && !menu.classList.contains("open")) wrapper.classList.remove("controls-visible");
  };

  video.onclick = () => {
    clearTimeout(clickTimer);
    clickTimer = setTimeout(togglePlay, 220);
  };

  video.ondblclick = (event) => {
    clearTimeout(clickTimer);
    const rect = video.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    if (x < 0.4) seek(-10);
    else if (x > 0.6) seek(10);
    else toggleFullscreen();
  };

  playBtn.onclick = togglePlay;
  centerPlay.onclick = togglePlay;
  muteBtn.onclick = toggleMute;
  speedBtn.onclick = cycleSpeed;
  fitBtn.onclick = cycleFit;
  pipBtn.onclick = togglePiP;
  fsBtn.onclick = toggleFullscreen;
  errorOpenExternal.onclick = () => vscode.postMessage({ type: "command", command: "openExternal" });

  volumeSlider.oninput = () => {
    const target = activeAudio();
    target.volume = Number(volumeSlider.value);
    target.muted = target.volume === 0;
    if (audio) video.muted = true;
    updateButtons();
  };

  moreBtn.onclick = (event) => {
    event.stopPropagation();
    const rect = moreBtn.getBoundingClientRect();
    openMenu(rect.right - 200, rect.bottom + 6);
  };

  wrapper.oncontextmenu = (event) => {
    event.preventDefault();
    openMenu(event.clientX, event.clientY);
  };

  document.addEventListener("click", (event) => {
    if (!menu.contains(event.target) && event.target !== moreBtn) menu.classList.remove("open");
  });

  progressWrap.onpointermove = (event) => {
    if (!Number.isFinite(video.duration)) return;
    const rect = progressBg.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    timeTooltip.textContent = fmt(video.duration * pct);
    timeTooltip.style.left = `${pct * 100}%`;
  };

  progressWrap.onpointerdown = (event) => {
    event.stopPropagation();
    dragging = true;
    seekFromPointer(event);
    const move = (e) => seekFromPointer(e);
    const up = () => {
      dragging = false;
      syncAudio(true);
      document.removeEventListener("pointermove", move);
      showControls();
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up, { once: true });
  };

  video.onloadedmetadata = () => {
    if (restorePosition > 0 && restorePosition < video.duration - 2) video.currentTime = restorePosition;
    updateProgress();
  };
  video.onloadeddata = hideLoading;
  video.oncanplay = hideLoading;
  video.onprogress = updateBuffered;
  video.onwaiting = () => !video.paused && showLoading("Buffering…");
  video.onplaying = () => {
    hideLoading();
    updateButtons();
    showControls();
  };
  video.onplay = () => {
    if (audio) {
      syncAudio(true);
      audio.play().catch(() => {});
    }
    updateButtons();
    showControls();
  };
  video.onpause = () => {
    audio?.pause();
    updateButtons();
    showControls();
    vscode.postMessage({ type: "position", seconds: video.currentTime });
  };
  video.ontimeupdate = () => {
    updateProgress();
    syncAudio(false);
  };
  video.onseeking = () => syncAudio(true);
  video.onseeked = () => syncAudio(true);
  video.onerror = () => {
    if (!video.src) return;
    if (!usingFallback && !fallbackRequested) {
      fallbackRequested = true;
      showLoading("Preparing compatible video…");
      vscode.postMessage({ type: "native_playback_failed" });
    } else {
      showError("The video stream could not be decoded.");
    }
  };

  document.onfullscreenchange = () => {
    updateButtons();
    showControls();
  };

  window.onkeydown = (event) => {
    if (["INPUT", "TEXTAREA"].includes(event.target?.tagName)) return;
    if (event.key === " " || event.key.toLowerCase() === "k") {
      event.preventDefault();
      togglePlay();
    } else if (event.key === "ArrowLeft") seek(-5);
    else if (event.key === "ArrowRight") seek(5);
    else if (event.key.toLowerCase() === "j") seek(-10);
    else if (event.key.toLowerCase() === "l") seek(10);
    else if (event.key.toLowerCase() === "m") toggleMute();
    else if (event.key.toLowerCase() === "f") toggleFullscreen();
    else if (event.key.toLowerCase() === "p") togglePiP();
    else if (/^[0-9]$/.test(event.key) && Number.isFinite(video.duration)) setTime(video.duration * Number(event.key) / 10);
    showControls();
  };

  window.onmessage = (event) => {
    const msg = event.data;

    if (msg.type === "video_src") {
      if (sourceLoaded && !msg.replace) return;
      sourceLoaded = true;
      usingFallback = Boolean(msg.replace);
      restorePosition = Number(msg.position) || 0;
      errorLayer.hidden = true;
      showLoading(usingFallback ? "Opening compatible video…" : "Opening video…");
      video.pause();
      video.src = msg.src;
      video.muted = Boolean(msg.separateAudio);
      video.load();
      updateButtons();
    } else if (msg.type === "status") {
      showStatus(msg.message);
    } else if (msg.type === "audio_ready") {
      const volume = Number(volumeSlider.value);
      const wasPlaying = !video.paused;
      audio?.remove();
      audio = document.createElement("audio");
      audio.src = msg.src;
      audio.preload = "metadata";
      audio.volume = Number.isFinite(volume) ? volume : 1;
      audio.muted = audio.volume === 0;
      audio.playbackRate = video.playbackRate;
      audio.hidden = true;
      document.body.appendChild(audio);
      video.muted = true;
      audio.onloadedmetadata = () => {
        syncAudio(true);
        if (wasPlaying) audio.play().catch(() => {});
      };
      showStatus("Audio ready", 900);
      updateButtons();
    } else if (msg.type === "audio_unavailable") {
      showStatus(msg.message, 6000);
    } else if (msg.type === "audio_failed") {
      showStatus("Audio could not be prepared", 5000);
    } else if (msg.type === "fatal") {
      showError(msg.message);
    }
  };

  video.dataset.fit = fits[fitIndex][0];
  speedBtn.textContent = "1×";
  fitBtn.textContent = fits[fitIndex][1];
  updateButtons();
  showControls();
  vscode.postMessage({ type: "ready" });
})();
