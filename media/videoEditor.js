(function () {
  const vscode = acquireVsCodeApi();

  const videoWrapper = document.querySelector(".video-wrapper");
  const video = document.querySelector("#player");
  const meta =
    document.querySelector("#meta") || document.querySelector(".meta");

  // Ensure overlay & UI mounts exist (create if missing in HTML)
  let playOverlay = document.getElementById("playPauseOverlay");
  if (!playOverlay) {
    playOverlay = document.createElement("div");
    playOverlay.id = "playPauseOverlay";
    playOverlay.className = "play-overlay";
    videoWrapper.appendChild(playOverlay);
  }

  // Context menu (single instance)
  let ctxMenu = document.getElementById("contextMenu");
  if (!ctxMenu) {
    ctxMenu = document.createElement("div");
    ctxMenu.id = "contextMenu";
    ctxMenu.className = "context-menu";
    document.body.appendChild(ctxMenu);
  }

  // --- State ---
  let isMuted = !!video.muted;
  let boosting = false;
  let boostTimer = null;
  let pressStart = 0;

  // --- Meta info (Duration • Resolution) ---
  function humanTime(s) {
    if (!isFinite(s)) return "—";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60)
      .toString()
      .padStart(2, "0");
    const sec = Math.floor(s % 60)
      .toString()
      .padStart(2, "0");
    return h > 0 ? `${h}:${m}:${sec}` : `${m}:${sec}`;
  }
  function updateMeta() {
    const duration = humanTime(video.duration || 0);
    const w = video.videoWidth || "—";
    const h = video.videoHeight || "—";
    if (meta)
      meta.textContent = `Duration: ${duration} • Resolution: ${w}×${h}`;
  }
  video.addEventListener("loadedmetadata", updateMeta);
  video.addEventListener("error", () => {
    vscode.postMessage({
      type: "error",
      message: "Failed to load video or unsupported codec.",
    });
  });

  // --- Play/Pause ---
  function togglePlayPause() {
    if (video.paused) {
      video.play();
      showOverlay("play");
    } else {
      video.pause();
      showOverlay("pause");
    }
    // update play button icon
    const playBtn = controls.querySelector('[data-key="play"]');
    if (playBtn) {
      playBtn.innerHTML = video.paused ? playIconSVG() : pauseIconSVG();
    }
  }

  function showOverlay(mode) {
    playOverlay.innerHTML =
      mode === "play" ? playOverlaySVG() : pauseOverlaySVG();
    playOverlay.classList.add("show");
    setTimeout(() => playOverlay.classList.remove("show"), 700);
  }

  // click toggles play/pause
  video.addEventListener("click", togglePlayPause);
  // double click fullscreen
  video.addEventListener("dblclick", toggleFullscreen);

  // --- Press & hold to boost (2s -> 2x while held) ---
  video.addEventListener("pointerdown", () => {
    pressStart = performance.now();
    boostTimer = setTimeout(() => {
      if (!video.paused) {
        boosting = true;
        video.playbackRate = 2.0;
        // subtle feedback via overlay (play icon with tiny ring)
        showOverlay("play");
      }
    }, 1200);
  });
  const endHold = () => {
    clearTimeout(boostTimer);
    if (boosting) {
      boosting = false;
      video.playbackRate = 1.0;
    }
  };
  video.addEventListener("pointerup", endHold);
  video.addEventListener("pointerleave", endHold);
  video.addEventListener("pointercancel", endHold);

  // --- Mute ---
  function toggleMute() {
    video.muted = !video.muted;
    isMuted = video.muted;
    const muteBtn = controls.querySelector('[data-key="mute"]');
    if (muteBtn)
      muteBtn.innerHTML = isMuted ? mutedIconSVG() : volumeIconSVG(false);
  }

  // --- Picture-in-Picture ---
  async function togglePiP() {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
      }
    } catch (e) {
      vscode.postMessage({
        type: "error",
        message: `PiP error: ${e?.message || e}`,
      });
    }
  }

  // --- Fullscreen (wrapper for best results) ---
  function inFullscreen() {
    return !!document.fullscreenElement;
  }
  async function toggleFullscreen() {
    try {
      if (!inFullscreen()) {
        await videoWrapper.requestFullscreen();
        updateFSBtn();
      } else {
        await document.exitFullscreen();
        updateFSBtn();
      }
    } catch (e) {
      vscode.postMessage({
        type: "error",
        message: `Fullscreen error: ${e?.message || e}`,
      });
    }
  }
  document.addEventListener("fullscreenchange", updateFSBtn);
  function updateFSBtn() {
    const fsBtn = controls.querySelector('[data-key="fs"]');
    if (fsBtn)
      fsBtn.innerHTML = inFullscreen()
        ? exitFullscreenIconSVG()
        : fullscreenIconSVG(false);
  }

  // --- Copy Path (ask extension; reliable vs webview URI) ---
  function copyPath() {
    vscode.postMessage({ type: "command", command: "copyPath" });
  }

  // --- Keyboard shortcuts ---
  window.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    switch (e.key) {
      case " ":
        e.preventDefault();
        togglePlayPause();
        break;
      case "ArrowLeft":
        video.currentTime = Math.max(0, video.currentTime - 5);
        break;
      case "ArrowRight":
        video.currentTime = Math.min(
          video.duration || Infinity,
          video.currentTime + 5
        );
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
      case "j":
      case "J":
        video.currentTime = Math.max(0, video.currentTime - 10);
        break;
      case "l":
      case "L":
        video.currentTime = Math.min(
          video.duration || Infinity,
          video.currentTime + 10
        );
        break;
    }
  });

  // --- Context Menu ---
  videoWrapper.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY);
  });
  document.addEventListener("click", () => hideContextMenu());

  function openContextMenu(x, y) {
    ctxMenu.innerHTML = "";

    ctxMenu.appendChild(
      ctxItem(
        inFullscreen() ? exitFullscreenIconSVG() : fullscreenIconSVG(true),
        inFullscreen() ? "Exit Fullscreen" : "Fullscreen",
        () => toggleFullscreen()
      )
    );

    ctxMenu.appendChild(
      ctxItem(
        isMuted ? mutedIconSVG() : volumeIconSVG(true),
        isMuted ? "Unmute" : "Mute",
        () => toggleMute()
      )
    );

    if (document.pictureInPictureEnabled) {
      ctxMenu.appendChild(
        ctxItem(pipIconSVG(), "Picture-in-Picture", () => togglePiP())
      );
    }

    ctxMenu.appendChild(divider());
    ctxMenu.appendChild(
      ctxItem(copyIconSVG(), "Copy File Path", () => copyPath())
    );

    ctxMenu.style.left = `${x}px`;
    ctxMenu.style.top = `${y}px`;
    ctxMenu.style.display = "flex";
  }
  function hideContextMenu() {
    ctxMenu.style.display = "none";
  }

  function ctxItem(svg, label, fn) {
    const d = document.createElement("div");
    d.className = "item";
    d.innerHTML = `${svg}<span>${label}</span>`;
    d.onclick = () => {
      hideContextMenu();
      fn && fn();
    };
    return d;
  }
  function divider() {
    const s = document.createElement("div");
    s.className = "sep";
    return s;
  }

  // --- Footer text: only brand is a link ---
  const footer = document.getElementById("footer");
  if (footer) {
    footer.innerHTML = `Made with ❤️ by <span class="brand"><a href="https://batchnepal.com?utm_source=vs_code&utm_campaign=video_player" target="_blank" rel="noopener">BatchNepal Pvt. Ltd.</a></span>`;
  }

  // --- Helpers to build buttons ---
  function makeCtrlBtn(key, svg, onClick) {
    const b = document.createElement("button");
    b.className = "ctrl";
    b.dataset.key = key;
    b.innerHTML = svg;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick && onClick();
    });
    return b;
  }

  // Grab references to buttons
  const openExternalBtn = document.getElementById("openExternal");
  const copyPathBtn = document.getElementById("copyPath");
  const fullscreenBtn = document.getElementById("fullscreen");

  // --- 1. Open in External Player ---
  openExternalBtn.addEventListener("click", () => {
    vscode.postMessage({
      type: "command",
      command: "openExternal", // Your VS Code extension should handle this
    });
  });

  // --- 2. Copy File Path ---
  copyPathBtn.addEventListener("click", async () => {
    try {
      vscode.postMessage({ type: "command", command: "copyPath" });
    } catch (_) {
      // fallback: copy using clipboard API if available
      if (navigator.clipboard) {
        try {
          await navigator.clipboard.writeText(video.currentSrc || "");
          alert("Video path copied to clipboard!");
        } catch (e) {
          console.warn("Failed to copy path:", e);
        }
      }
    }
  });

  fullscreenBtn.addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) {
        if (video.requestFullscreen) {
          await video.requestFullscreen();
        } else if (video.webkitRequestFullscreen) {
          // Safari
          await video.webkitRequestFullscreen();
        } else if (video.mozRequestFullScreen) {
          // Firefox
          await video.mozRequestFullScreen();
        } else if (video.msRequestFullscreen) {
          // IE/Edge
          await video.msRequestFullscreen();
        }
      } else {
        await document.exitFullscreen();
      }
    } catch (e) {
      console.warn("Fullscreen failed:", e);
    }
  });

  // --- SVG Icons (Apple-ish) ---
  function playOverlaySVG() {
    return `
      <svg width="96" height="96" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="32" r="30" fill="rgba(10,132,255,0.28)"/>
        <polygon points="26,20 46,32 26,44" fill="#0a84ff"/>
      </svg>`;
  }
  function pauseOverlaySVG() {
    return `
      <svg width="96" height="96" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="32" r="30" fill="rgba(10,132,255,0.28)"/>
        <rect x="22" y="20" width="6" height="24" fill="#0a84ff"/>
        <rect x="36" y="20" width="6" height="24" fill="#0a84ff"/>
      </svg>`;
  }
  function playIconSVG() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" xmlns="http://www.w3.org/2000/svg">
      <path d="M8 5v14l11-7z" fill="#fff"/></svg>`;
  }
  function pauseIconSVG() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" xmlns="http://www.w3.org/2000/svg">
      <rect x="6" y="5" width="4" height="14" fill="#fff"/><rect x="14" y="5" width="4" height="14" fill="#fff"/></svg>`;
  }
  function volumeIconSVG(menu = false) {
    const stroke = menu ? "#e8eaed" : "#fff";
    return `<svg viewBox="0 0 24 24" fill="none" stroke="${stroke}" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 10v4h3l4 4V6l-4 4H5z" fill="${stroke}"/></svg>`;
  }
  function mutedIconSVG() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="#fff" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 10v4h3l4 4V6l-4 4H5z" fill="#fff"/>
      <path d="M16 9l4 4m0-4l-4 4" stroke="#ff8a8a" stroke-width="2" stroke-linecap="round"/></svg>`;
  }
  function fullscreenIconSVG(menu = false) {
    const stroke = menu ? "#e8eaed" : "#fff";
    return `<svg viewBox="0 0 24 24" stroke="${stroke}" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M7 14H5v5h5v-2H7v-3zm12 5h-5v-2h3v-3h2v5zM7 5h3V3H5v5h2V5zm12 3V3h-5v2h3v3h2z" fill="${stroke}"/></svg>`;
  }
  function exitFullscreenIconSVG() {
    return `<svg viewBox="0 0 24 24" stroke="#fff" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M9 15v3H6v2h5v-5H9zm10 5h-5v-5h2v3h3v2zM9 4h2v5H6V7h3V4zm7 5V6h-3V4h5v5h-2z" fill="#fff"/></svg>`;
  }
  function pipIconSVG() {
    return `<svg viewBox="0 0 24 24" stroke="#fff" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="5" width="18" height="14" rx="2" ry="2" stroke="#fff"/>
      <rect x="12.5" y="11.5" width="7" height="5" fill="#fff"/></svg>`;
  }
  function copyIconSVG() {
    return `<svg viewBox="0 0 24 24" stroke="#fff" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="9" y="9" width="10" height="10" rx="2" stroke="#fff"/>
      <rect x="5" y="5" width="10" height="10" rx="2" stroke="#fff"/></svg>`;
  }
  function infoIconSVG() {
    return `<svg viewBox="0 0 24 24" stroke="#fff" fill="none" xmlns="http://www.w3.org/2000/svg" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="#fff"/>
      <rect x="11" y="10" width="2" height="7" fill="#fff"/>
      <circle cx="12" cy="7" r="1" fill="#fff"/></svg>`;
  }
})();
