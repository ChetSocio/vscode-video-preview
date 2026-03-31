(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const wrapper = document.getElementById("videoWrapper");
  const video = document.getElementById("player");
  const playOverlay = document.getElementById("playPauseOverlay");
  const progressWrap = document.getElementById("progressWrap");
  const progressBg = document.getElementById("progressBg");
  const progressFill = document.getElementById("progressFill");
  const progressThumb = document.getElementById("progressThumb");
  const timeTooltip = document.getElementById("timeTooltip");
  const timeDisplay = document.getElementById("timeDisplay");
  const resBadge = document.getElementById("resBadge");
  const playBtn = document.getElementById("playBtn");
  const muteBtn = document.getElementById("muteBtn");
  const volumeSlider = document.getElementById("volumeSlider");
  const pipBtn = document.getElementById("pipBtn");
  const fsBtn = document.getElementById("fsBtn");
  const openExternalBtn = document.getElementById("openExternal");
  const copyPathBtn = document.getElementById("copyPath");
  const ctxMenu = document.getElementById("contextMenu");
  const backBtn = document.getElementById("backBtn");
  const fwdBtn = document.getElementById("fwdBtn");
  const speedBtn = document.getElementById("speedBtn");

  vscode.postMessage({ type: "ready" });

  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  let speedIdx = 2; // default 1x

  let audioEl = null;
  let videoLoaded = false; // guard — outside handler so it persists across messages

  video.volume = 1.0;
  video.muted = true;
  volumeSlider.value = "1";

  let isDragging = false;
  let boosting = false;
  let boostTimer = null;

  backBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const t = Math.max(0, video.currentTime - 10);
    video.currentTime = t;
    if (audioEl) audioEl.currentTime = t;
  });

  fwdBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const t = Math.min(video.duration || Infinity, video.currentTime + 10);
    video.currentTime = t;
    if (audioEl) audioEl.currentTime = t;
  });

  speedBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    const speed = SPEEDS[speedIdx];
    video.playbackRate = speed;
    if (audioEl) audioEl.playbackRate = speed;
    speedBtn.textContent = speed === 1 ? "1×" : `${speed}×`;
  });
  // ── Metadata ────────────────────────────────────────────
  video.addEventListener("loadedmetadata", () => {
    updateTime();
    const h = video.videoHeight;
    if (h)
      resBadge.textContent =
        h >= 2160 ? "4K" : h >= 1080 ? "HD" : h >= 720 ? "720p" : `${h}p`;
  });

  video.addEventListener("error", () => {
    vscode.postMessage({
      type: "error",
      message: "Failed to load video or unsupported codec.",
    });
  });

  // ── Time ────────────────────────────────────────────────
  function fmt(s) {
    if (!isFinite(s) || isNaN(s)) return "0:00";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60)
      .toString()
      .padStart(2, "0");
    const sec = Math.floor(s % 60)
      .toString()
      .padStart(2, "0");
    return h > 0 ? `${h}:${m}:${sec}` : `${m}:${sec}`;
  }

  function updateTime() {
    timeDisplay.textContent = `${fmt(video.currentTime)} / ${fmt(video.duration)}`;
  }

  // ── Progress ─────────────────────────────────────────────
  video.addEventListener("timeupdate", () => {
    if (isDragging) return;
    const pct = video.duration ? (video.currentTime / video.duration) * 100 : 0;
    progressFill.style.width = `${pct}%`;
    progressThumb.style.left = `${pct}%`;
    updateTime();
  });

  function seekTo(e) {
    const rect = progressBg.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const t = pct * (video.duration || 0);
    video.currentTime = t;
    if (audioEl) audioEl.currentTime = t;
    progressFill.style.width = `${pct * 100}%`;
    progressThumb.style.left = `${pct * 100}%`;
    updateTime();
  }

  progressWrap.addEventListener("mousemove", (e) => {
    const rect = progressBg.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    timeTooltip.textContent = fmt(pct * (video.duration || 0));
    const tipX = Math.min(Math.max(e.clientX - rect.left, 20), rect.width - 20);
    timeTooltip.style.left = `${tipX}px`;
  });

  progressWrap.addEventListener("mousedown", (e) => {
    isDragging = true;
    seekTo(e);
    const mv = (ev) => seekTo(ev);
    const up = () => {
      isDragging = false;
      document.removeEventListener("mousemove", mv);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", mv);
    document.addEventListener("mouseup", up);
  });

  // ── Play / Pause ─────────────────────────────────────────
  function togglePlay() {
    if (video.paused) {
      video.play().catch(() => {});
      if (audioEl) {
        audioEl.currentTime = video.currentTime;
        audioEl.play().catch(() => {});
      }
      flash("play");
    } else {
      video.pause();
      if (audioEl) audioEl.pause();
      flash("pause");
    }
  }

  function flash(mode) {
    playOverlay.innerHTML = mode === "play" ? svgFlashPlay() : svgFlashPause();
    playOverlay.classList.add("show");
    setTimeout(() => playOverlay.classList.remove("show"), 550);
  }

  function updatePlayBtn() {
    playBtn.innerHTML = video.paused ? svgPlayBtn() : svgPauseBtn();
  }

  video.addEventListener("click", togglePlay);
  video.addEventListener("dblclick", () => {});
  playBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePlay();
  });
  video.addEventListener("play", updatePlayBtn);
  video.addEventListener("pause", updatePlayBtn);
  updatePlayBtn();

  // ── Speed boost on hold ──────────────────────────────────
  video.addEventListener("pointerdown", () => {
    boostTimer = setTimeout(() => {
      if (!video.paused) {
        boosting = true;
        video.playbackRate = 2.0;
        if (audioEl) audioEl.playbackRate = 2.0;
      }
    }, 1200);
  });
  const endHold = () => {
    clearTimeout(boostTimer);
    if (boosting) {
      boosting = false;
      video.playbackRate = 1.0;
      if (audioEl) audioEl.playbackRate = 1.0;
    }
  };
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) =>
    video.addEventListener(ev, endHold),
  );

  // ── Mute / Volume ────────────────────────────────────────
  function getActiveAudio() {
    return audioEl || video;
  }

  function toggleMute() {
    const active = getActiveAudio();
    active.muted = !active.muted;
    if (audioEl) video.muted = true;
    if (!active.muted && active.volume === 0) {
      active.volume = 1.0;
      volumeSlider.value = "1";
    }
    updateMuteBtn();
  }

  function updateMuteBtn() {
    const active = getActiveAudio();
    muteBtn.innerHTML =
      active.muted || active.volume === 0 ? svgMuted() : svgVolume();
  }

  muteBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMute();
  });

  volumeSlider.addEventListener("input", () => {
    const v = parseFloat(volumeSlider.value);
    const active = getActiveAudio();
    active.volume = v;
    active.muted = v === 0;
    updateMuteBtn();
  });

  video.addEventListener("volumechange", () => {
    if (audioEl) return;
    if (!isDragging)
      volumeSlider.value = video.muted ? "0" : String(video.volume);
    updateMuteBtn();
  });

  updateMuteBtn();

  // ── PiP ─────────────────────────────────────────────────
  async function togglePiP() {
    try {
      if (document.pictureInPictureElement)
        await document.exitPictureInPicture();
      else if (document.pictureInPictureEnabled)
        await video.requestPictureInPicture();
    } catch (e) {
      vscode.postMessage({
        type: "error",
        message: `PiP error: ${e?.message || e}`,
      });
    }
  }

  pipBtn.innerHTML = svgPiP();
  if (!document.pictureInPictureEnabled) pipBtn.style.display = "none";
  pipBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePiP();
  });

  // ── Fullscreen — blocked by VS Code webview sandbox ──────
  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) await wrapper.requestFullscreen();
      else await document.exitFullscreen();
    } catch (e) {
      // Silently suppressed
    }
  }

  document.addEventListener("fullscreenchange", () => {
    fsBtn.innerHTML = document.fullscreenElement
      ? svgExitFS()
      : svgFullscreen();
  });

  fsBtn.innerHTML = svgFullscreen();
  fsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFullscreen();
  });

  // ── Action bar ───────────────────────────────────────────
  openExternalBtn.addEventListener("click", () =>
    vscode.postMessage({ type: "command", command: "openExternal" }),
  );
  copyPathBtn.addEventListener("click", () =>
    vscode.postMessage({ type: "command", command: "copyPath" }),
  );

  // ── Context menu ─────────────────────────────────────────
  wrapper.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    buildCtxMenu();
    const x = Math.min(e.clientX, window.innerWidth - 185);
    const y = Math.min(e.clientY, window.innerHeight - 175);
    ctxMenu.style.left = `${x}px`;
    ctxMenu.style.top = `${y}px`;
    ctxMenu.classList.add("open");
  });
  document.addEventListener("click", () => ctxMenu.classList.remove("open"));

  function buildCtxMenu() {
    ctxMenu.innerHTML = "";
    const active = getActiveAudio();
    addCtx(
      active.muted ? svgVolume() : svgMuted(),
      active.muted ? "Unmute" : "Mute",
      toggleMute,
    );
    if (document.pictureInPictureEnabled)
      addCtx(svgPiP(), "Picture-in-Picture", togglePiP);
    ctxMenu.appendChild(
      Object.assign(document.createElement("div"), { className: "sep" }),
    );
    addCtx(svgCopy(), "Copy File Path", () =>
      vscode.postMessage({ type: "command", command: "copyPath" }),
    );
  }

  function addCtx(icon, label, fn) {
    const d = document.createElement("div");
    d.className = "item";
    d.innerHTML = `${icon}<span>${label}</span>`;
    d.onclick = (e) => {
      e.stopPropagation();
      ctxMenu.classList.remove("open");
      fn?.();
    };
    ctxMenu.appendChild(d);
  }

  // ── Keyboard ─────────────────────────────────────────────
  window.addEventListener("keydown", (e) => {
    if (["INPUT", "TEXTAREA"].includes(e.target?.tagName)) return;
    switch (e.key) {
      case " ":
      case "k":
      case "K":
        e.preventDefault();
        togglePlay();
        break;
      case "ArrowLeft":
      case "j":
      case "J":
        const tb = Math.max(0, video.currentTime - 10);
        video.currentTime = tb;
        if (audioEl) audioEl.currentTime = tb;
        break;
      case "ArrowRight":
      case "l":
      case "L":
        const tf = Math.min(video.duration || Infinity, video.currentTime + 10);
        video.currentTime = tf;
        if (audioEl) audioEl.currentTime = tf;
        break;
      case "m":
      case "M":
        toggleMute();
        break;
      case "f":
      case "F":
        toggleFullscreen();
        break;
      case "p":
      case "P":
        togglePiP();
        break;
    }
  });

  // ── Message handler ───────────────────────────────────────
  window.addEventListener("message", (event) => {
    const msg = event.data;

    if (msg.type === "video_src") {
      // Guard — only load once, ignore duplicate messages
      if (videoLoaded) return;
      videoLoaded = true;

      fetch(msg.src)
        .then((r) => r.blob())
        .then((blob) => {
          video.src = URL.createObjectURL(blob);
          video.muted = true;
          video.load();
          video.addEventListener(
            "loadeddata",
            () => {
              video.classList.remove("loading");
              document.getElementById("videoSpinner")?.remove();
            },
            { once: true },
          );
        })
        .catch(() =>
          vscode.postMessage({
            type: "error",
            message: "Failed to load video.",
          }),
        );
    }

    if (msg.type === "audio_ready") {
      const currentPos = video.currentTime;
      const wasPlaying = !video.paused;

      audioEl = document.createElement("audio");
      audioEl.src = msg.src;
      audioEl.volume = parseFloat(volumeSlider.value) || 1.0;
      audioEl.muted = false;
      audioEl.preload = "auto";
      audioEl.style.display = "none";

      audioEl.addEventListener("volumechange", () => {
        if (!isDragging)
          volumeSlider.value = audioEl.muted ? "0" : String(audioEl.volume);
        updateMuteBtn();
      });

      document.body.appendChild(audioEl);
      video.muted = true;
      audioEl.currentTime = currentPos;
      if (wasPlaying) audioEl.play().catch(() => {});

      const bar = document.getElementById("transcodeBar");
      if (bar) {
        bar.classList.add("done");
        setTimeout(() => bar.remove(), 400);
      }

      updateMuteBtn();
    }

    if (msg.type === "audio_failed") {
      const bar = document.getElementById("transcodeBar");
      if (bar) {
        bar.innerHTML =
          "⚠ Audio extraction failed. Try opening in external player.";
        bar.classList.add("warn");
        setTimeout(() => bar.remove(), 5000);
      }
    }
  });

  // ── SVG Icons ─────────────────────────────────────────────
  function svgFlashPlay() {
    return `<svg width="68" height="68" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="rgba(0,0,0,0.5)"/><polygon points="26,20 48,32 26,44" fill="#fff"/></svg>`;
  }
  function svgFlashPause() {
    return `<svg width="68" height="68" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="rgba(0,0,0,0.5)"/><rect x="20" y="18" width="7" height="28" fill="#fff" rx="1.5"/><rect x="37" y="18" width="7" height="28" fill="#fff" rx="1.5"/></svg>`;
  }
  function svgPlayBtn() {
    return `<svg viewBox="0 0 24 24"><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg>`;
  }
  function svgPauseBtn() {
    return `<svg viewBox="0 0 24 24"><rect x="5" y="3" width="4" height="18" fill="currentColor" rx="1"/><rect x="15" y="3" width="4" height="18" fill="currentColor" rx="1"/></svg>`;
  }
  function svgVolume() {
    return `<svg viewBox="0 0 24 24" fill="none"><path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  }
  function svgMuted() {
    return `<svg viewBox="0 0 24 24" fill="none"><path d="M11 5L6 9H2v6h4l5 4V5z" fill="currentColor"/><line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  }
  function svgFullscreen() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>`;
  }
  function svgExitFS() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="8 3 3 3 3 8"/><polyline points="21 8 21 3 16 3"/><polyline points="3 16 3 21 8 21"/><polyline points="16 21 21 21 21 16"/></svg>`;
  }
  function svgPiP() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="4" width="20" height="16" rx="2"/><rect x="12" y="11" width="8" height="6" rx="1" fill="currentColor" stroke="none"/></svg>`;
  }
  function svgCopy() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
  }
})();
