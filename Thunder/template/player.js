/**
 * Player page chrome: audio/subtitle pickers, external-player shortcuts,
 * clipboard, share and download feedback. Playback itself belongs to
 * <movi-player>.
 */
(() => {
  "use strict";

  const config = window.__CINEMA_CONFIG__ || {};
  const streamUrl = config.src || "";
  const downloadUrl = config.downloadUrl || streamUrl;
  const mimeType = config.mimeType || "";
  const fileName = config.fileName || document.title || "media";
  // Players need the inline stream; for anything else the download link is the useful one.
  const shareUrl = config.isVideo || config.isAudio ? streamUrl : downloadUrl;

  const TOAST_VISIBLE_MS = 2000;

  const player = document.getElementById("player");
  const copyBtn = document.getElementById("copyBtn");
  const shareBtn = document.getElementById("shareBtn");
  const downloadBtn = document.getElementById("downloadBtn");
  const drawerPanel = document.getElementById("drawerPanel");
  const toastStack = document.getElementById("toastStack");
  const banner = document.getElementById("banner");
  const codecNotice = document.getElementById("codecNotice");
  const androidGroup = document.getElementById("androidGroup");
  const iosGroup = document.getElementById("iosGroup");
  const desktopGroup = document.getElementById("desktopGroup");

  const showToast = (message, kind = "default") => {
    if (!toastStack) return;
    const toast = document.createElement("div");
    toast.className = `toast ${kind}`;
    toast.textContent = message;
    toastStack.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = "toastExit 0.3s ease forwards";
      setTimeout(() => toast.remove(), 300);
    }, TOAST_VISIBLE_MS);
  };

  const say = (message, kind = "") => {
    if (!banner) return;
    banner.className = `f2l-banner show ${kind}`.trim();
    banner.textContent = message;
  };

  const absoluteUrl = (url) => {
    try {
      return new URL(url, window.location.href).href;
    } catch {
      return url;
    }
  };

  // ── External players ─────────────────────────────────────────────────────
  const userAgent = navigator.userAgent;
  const isAndroid = /android/i.test(userAgent);
  const isIOS = /iphone|ipad|ipod/i.test(userAgent) ||
    (/macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1);
  const isMac = /macintosh|mac os x/i.test(userAgent) && !isIOS;
  const isWindows = /windows/i.test(userAgent);

  /** Removes the player groups (and OS-specific links) that do not apply here. */
  const prunePlayerGroups = () => {
    if (isAndroid) {
      iosGroup?.remove();
      desktopGroup?.remove();
      return;
    }
    if (isIOS) {
      androidGroup?.remove();
      desktopGroup?.remove();
      return;
    }
    androidGroup?.remove();
    iosGroup?.remove();
    desktopGroup?.querySelectorAll(".player-link").forEach((link) => {
      const os = link.dataset.os;
      if ((os === "mac" && !isMac) || (os === "windows" && !isWindows)) link.remove();
    });
  };

  /** The Android intent `type=` value, taken from the server's classification. */
  const intentType = (mime) => {
    if (config.isAudio) return "audio/*";
    if (config.isVideo) return "video/*";
    const normalized = String(mime || "").trim().toLowerCase();
    if (normalized.startsWith("audio/")) return "audio/*";
    if (normalized.startsWith("video/")) return "video/*";
    return "";
  };

  const absoluteStreamUrl = () => absoluteUrl(streamUrl);

  /** Splits a URL into its scheme and a scheme-less form for intent:// URIs. */
  const splitUrl = (url) => {
    const parsed = new URL(url, window.location.href);
    return {
      scheme: parsed.protocol.replace(":", "") || "https",
      noScheme: parsed.href.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/#/g, "%23"),
    };
  };

  const buildAndroidIntent = ({ packageName, title = fileName, fallbackURL }) => {
    const { scheme, noScheme } = splitUrl(absoluteStreamUrl());
    const type = intentType(mimeType);
    const parts = [
      `intent://${noScheme}#Intent`,
      `scheme=${encodeURIComponent(scheme)}`,
      "action=android.intent.action.VIEW",
    ];
    if (type) parts.push(`type=${type}`);
    if (packageName) parts.push(`package=${packageName}`);
    if (title) parts.push(`S.title=${encodeURIComponent(title)}`);
    if (fallbackURL) parts.push(`S.browser_fallback_url=${encodeURIComponent(fallbackURL)}`);
    parts.push("end");
    return parts.join(";");
  };

  const playStoreUrl = (packageName) =>
    `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}`;

  const ANDROID_PACKAGES = {
    "android-vlc": "org.videolan.vlc",
    "android-vlc-beta": "org.videolan.vlc.debug",
    "android-mx": "com.mxtech.videoplayer.ad",
    "android-mx-pro": "com.mxtech.videoplayer.pro",
    "android-playit": "com.playit.videoplayer",
    "android-splayer": "com.young.simple.player",
    "android-next": "dev.anilbeesetti.nextplayer",
    "android-nova": "org.courville.nova",
    "android-mpv": "is.xyz.mpv",
    "android-just": "com.brouken.player",
    "android-nplayer": "com.newin.nplayer.pro",
  };

  /** Resolves a `data-player` key to the deep link that opens it, or "". */
  const buildPlayerHref = (playerKey) => {
    if (!streamUrl) return "";
    const absolute = absoluteStreamUrl();
    const encoded = encodeURIComponent(absolute);

    if (playerKey === "android-chooser") return buildAndroidIntent({ packageName: "", title: fileName });

    const androidPackage = ANDROID_PACKAGES[playerKey];
    if (androidPackage) {
      return buildAndroidIntent({
        packageName: androidPackage,
        fallbackURL: playStoreUrl(androidPackage),
      });
    }

    const iosHrefs = {
      "ios-vlc": `vlc-x-callback://x-callback-url/stream?url=${encoded}`,
      "ios-infuse": `infuse://x-callback-url/play?url=${encoded}`,
      "ios-nplayer": `nplayer://weblink?url=${encoded}`,
      "ios-outplayer": `outplayer://x-callback-url/play?url=${encoded}`,
      "ios-oplayer": `oplayer://x-callback-url/play?url=${encoded}`,
    };
    if (iosHrefs[playerKey]) return iosHrefs[playerKey];

    const noFragment = absolute.replace(/#/g, "%23");
    const desktopHrefs = {
      "desktop-vlc": `vlc://${noFragment}`,
      "desktop-potplayer": `potplayer://${noFragment}`,
      "desktop-iina": `iina://weblink?url=${encoded}`,
      "desktop-mpv": `mpv://${noFragment}`,
      "desktop-kmplayer": `kmplayer://${noFragment}`,
    };
    return desktopHrefs[playerKey] || "";
  };

  const wirePlayerLinks = () => {
    document.querySelectorAll(".player-link[data-player]").forEach((link) => {
      const href = buildPlayerHref(link.dataset.player);
      if (!href) {
        link.setAttribute("aria-disabled", "true");
        link.setAttribute("tabindex", "-1");
        link.removeAttribute("href");
        return;
      }
      link.href = href;
    });

    drawerPanel?.addEventListener("click", (event) => {
      const link = event.target.closest(".player-link[data-player]");
      if (!link || link.getAttribute("aria-disabled") === "true") return;
      // Intents carry their own fallback; desktop schemes cannot be detected.
      if (link.href.startsWith("intent://")) return;
      let leftPage = false;
      const onVisibilityChange = () => {
        if (document.hidden) leftPage = true;
      };
      document.addEventListener("visibilitychange", onVisibilityChange, { once: true });
      setTimeout(() => {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        if (!leftPage) {
          showToast("If the player did not open, copy the link and paste it in the app.");
        }
      }, 1100);
    });

    // "Playback issue?" shortcut: the platform's VLC link.
    document.getElementById("codecVlcBtn")?.addEventListener("click", () => {
      const key = isAndroid ? "android-vlc" : isIOS ? "ios-vlc" : "desktop-vlc";
      const href = buildPlayerHref(key);
      if (href) window.location.href = href;
    });
  };

  // ── Playback failures ────────────────────────────────────────────────────
  // fallback="native" keeps a working surface, so that case is only a notice.
  player?.addEventListener("nativefallback", () => {
    say("Using browser-native playback; some audio/subtitle tracks may be unavailable.", "warn");
    showToast("This browser handles the file natively; some tracks may be unavailable.");
  });
  player?.addEventListener("error", () => {
    codecNotice?.classList.add("show");
    say("Advanced player failed on this file. Download it or open it in an external player below.");
    showToast("Playback failed. Try an external player below.", "error");
  });

  if (player && (typeof VideoDecoder === "undefined" || typeof WebAssembly === "undefined")) {
    say(
      "This browser lacks WebCodecs (Chrome/Edge 94+, Safari 16.4+, Firefox 130+): basic playback only. " +
        "Use an external player for other audio tracks.",
      "warn",
    );
  }

  // The library comes from a CDN; if it never loads there is no player at all.
  if (player) {
    setTimeout(() => {
      if (!customElements.get("movi-player")) {
        codecNotice?.classList.add("show");
        say("The player library did not load (first load is large). Download the file or use an external player.");
      }
    }, 25000);
  }

  // ── Track buttons inside the player bar ──────────────────────────────────
  /**
   * movi hides its track buttons in a tray below 721px, and a control anchored
   * `before: "cc"` goes into that tray too. Anchoring before `more` keeps these
   * in the always-visible part of the bar. They open movi's own menus, so the
   * track lists cannot drift from what the player knows.
   */
  const TRACK_BUTTONS = [
    {
      id: "f2l-audio-track",
      label: "Audio track",
      title: "Audio track",
      selector: ".movi-audio-track-btn",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 14v-4a2 2 0 0 1 2-2h2l4-4v16l-4-4H6a2 2 0 0 1-2-2z"/><path d="M16 8.5a5 5 0 0 1 0 7"/><path d="M19 6a9 9 0 0 1 0 12"/></svg>',
    },
    {
      id: "f2l-subtitles",
      label: "Subtitles",
      title: "Subtitles and captions",
      selector: ".movi-subtitle-track-btn",
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 13h4M13 13h4M7 16h6"/></svg>',
    },
  ];

  const addTrackButtons = () => {
    if (typeof player?.addControl !== "function") return;
    const root = player.shadowRoot;
    if (!root) return;

    for (const spec of TRACK_BUTTONS) {
      // Nothing to open if the file has no track of this kind.
      if (!root.querySelector(spec.selector)) continue;
      try {
        player.addControl({
          id: spec.id,
          label: spec.label,
          title: spec.title,
          icon: spec.icon,
          before: "more",
          placement: "bar",
          onSelect: () => root.querySelector(spec.selector)?.click(),
        });
      } catch {
        /* a control that will not register must not break the page */
      }
    }
  };

  // The player builds its chrome once the source is known, so wait for it.
  if (player && config.isVideo) {
    if (customElements.get("movi-player")) addTrackButtons();
    else customElements.whenDefined("movi-player").then(() => setTimeout(addTrackButtons, 0));
  }

  // ── Audio & subtitle pickers (video) ─────────────────────────────────────
  const audioSel = document.getElementById("audioSel");
  const subSel = document.getElementById("subSel");
  const delayInput = document.getElementById("delay");
  const delayValue = document.getElementById("dVal");
  const trackInfo = document.getElementById("trackInfo");
  const memInfo = document.getElementById("memInfo");

  const engine = () => player && player.player;

  const trackLanguage = (t) => (t && (t.language || t.lang)) || "";
  const trackLabel = (t, i, kind) => {
    const parts = [];
    const name = t.label || t.title || t.name;
    if (name) parts.push(name);
    const lang = trackLanguage(t);
    if (lang && lang !== "und") parts.push(lang.toUpperCase());
    if (t.codec) parts.push(t.codec);
    if (kind === "a" && t.channels) parts.push(`${t.channels}ch`);
    return parts.length ? parts.join(" · ") : `${kind === "a" ? "Audio" : "Subtitle"} ${i + 1}`;
  };

  const syncSelection = () => {
    const p = engine();
    if (!p || !audioSel || !subSel) return;
    try {
      const manager = p.trackManager;
      const audio = manager?.getActiveAudioTrack?.();
      if (audio && audio.id != null) audioSel.value = String(audio.id);
      const subtitle = manager?.getActiveSubtitleTrack?.();
      if (!subSel.disabled) subSel.value = subtitle && subtitle.id != null ? String(subtitle.id) : "";
    } catch {
      /* the selection is cosmetic; playback is unaffected */
    }
  };

  const refreshTracks = () => {
    const p = engine();
    if (!p || !audioSel || !subSel) return;
    let audio = [];
    let subtitles = [];
    try {
      audio = p.getAudioTracks() || [];
      subtitles = p.getSubtitleTracks() || [];
    } catch {
      /* tracks are not known yet; the next event retries */
    }

    audioSel.innerHTML = "";
    subSel.innerHTML = "";
    audio.forEach((t, i) => audioSel.add(new Option(trackLabel(t, i, "a"), t.id)));
    audioSel.disabled = audio.length < 2;
    if (!audio.length) audioSel.add(new Option("No audio track", ""));

    if (subtitles.length) {
      subSel.add(new Option("Off", ""));
      subtitles.forEach((t, i) => subSel.add(new Option(trackLabel(t, i, "s"), t.id)));
      subSel.disabled = false;
    } else {
      subSel.add(new Option("No subtitle tracks", ""));
      subSel.disabled = true;
    }
    if (trackInfo) trackInfo.textContent = `${audio.length} audio · ${subtitles.length} subtitle`;
    syncSelection();
  };

  audioSel?.addEventListener("change", () => {
    const p = engine();
    if (!p) return;
    try {
      p.selectAudioTrack(Number(audioSel.value));
      showToast("Audio switched");
    } catch {
      showToast("Audio switch failed", "error");
    }
  });

  subSel?.addEventListener("change", async () => {
    const p = engine();
    if (!p) return;
    try {
      await p.selectSubtitleTrack(subSel.value === "" ? null : Number(subSel.value));
      showToast(subSel.value === "" ? "Subtitles off" : "Subtitles on");
    } catch {
      showToast("Subtitle switch failed", "error");
    }
  });

  const setDelay = (seconds) => {
    const v = Math.max(-10, Math.min(10, Math.round(seconds * 10) / 10));
    if (delayInput) delayInput.value = v;
    if (delayValue) delayValue.textContent = `${v.toFixed(1)}s`;
    if (player) {
      try {
        player.subtitleDelay = v;
      } catch {
        /* player not ready; the slider still reflects the choice */
      }
    }
  };
  delayInput?.addEventListener("input", () => setDelay(parseFloat(delayInput.value)));
  document.getElementById("dMinus")?.addEventListener("click", () => setDelay(parseFloat(delayInput.value) - 0.5));
  document.getElementById("dPlus")?.addEventListener("click", () => setDelay(parseFloat(delayInput.value) + 0.5));

  if (player && config.isVideo) {
    ["loadeddata", "trackschange"].forEach((name) => player.addEventListener(name, refreshTracks));
    ["audiotrackchange", "subtitletrackchange"].forEach((name) => player.addEventListener(name, syncSelection));
  }

  if (memInfo && player) {
    const bytes = Number(player.getAttribute("buffersize")) || 0;
    memInfo.textContent = bytes ? `${Math.round(bytes / 1048576)} MB` : "Default";
  }

  // ── Fit the frame to the video's real aspect ratio ───────────────────────
  const frame = document.getElementById("videoFrame");
  if (player && frame && config.isVideo) {
    let fitted = false;

    const applyAspect = (w, h) => {
      if (!w || !h) return false;
      if (w === 300 && h === 150) return false; // an empty <canvas>'s default size
      frame.style.setProperty("--ar", Math.min(3, Math.max(0.4, w / h)).toFixed(4));
      fitted = true;
      return true;
    };

    // The decoded size lives somewhere inside the player's shadow DOM.
    const findVideoSize = () => {
      if (player.videoWidth && player.videoHeight) return [player.videoWidth, player.videoHeight];
      const scan = (root) => {
        if (!root) return null;
        for (const v of root.querySelectorAll("video")) {
          if (v.videoWidth && v.videoHeight) return [v.videoWidth, v.videoHeight];
        }
        for (const c of root.querySelectorAll("canvas")) {
          if (c.width > 0 && c.height > 0 && !(c.width === 300 && c.height === 150)) return [c.width, c.height];
        }
        for (const node of root.querySelectorAll("*")) {
          if (node.shadowRoot) {
            const found = scan(node.shadowRoot);
            if (found) return found;
          }
        }
        return null;
      };
      return scan(player.shadowRoot);
    };

    const tryFit = () => {
      if (fitted) return true;
      const size = findVideoSize();
      return size ? applyAspect(size[0], size[1]) : false;
    };

    ["loadedmetadata", "loadeddata", "canplay", "playing", "resize"].forEach((name) =>
      player.addEventListener(name, tryFit),
    );
    // Not every build emits those events, so poll for up to 30 seconds as well.
    let tries = 0;
    const timer = setInterval(() => {
      if (tryFit() || ++tries > 60) clearInterval(timer);
    }, 500);
  }

  // Free decoders and WASM memory when leaving the page.
  window.addEventListener("pagehide", () => {
    try {
      player?.player?.dispose?.();
    } catch {
      /* page is going away anyway */
    }
  });

  // ── Copy link ────────────────────────────────────────────────────────────
  let copyResetTimer = null;

  const confirmCopy = () => {
    if (!copyBtn) return;
    clearTimeout(copyResetTimer);
    const label = copyBtn.querySelector("span");
    const originalText = label ? label.textContent : "";
    copyBtn.classList.add("is-confirmed");
    if (label) label.textContent = "Copied";
    copyBtn.setAttribute("aria-label", "Link copied to clipboard");
    copyResetTimer = setTimeout(() => {
      copyBtn.classList.remove("is-confirmed");
      if (label) label.textContent = originalText || "Copy Link";
      copyBtn.setAttribute("aria-label", "Copy Link");
    }, TOAST_VISIBLE_MS);
  };

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      console.warn('Clipboard API unavailable, falling back to execCommand("copy")');
      const scratch = document.createElement("textarea");
      scratch.value = text;
      scratch.style.cssText = "position:fixed;left:-9999px";
      document.body.appendChild(scratch);
      scratch.select();
      try {
        // Returns false without throwing when the browser refuses the copy.
        return document.execCommand("copy");
      } catch {
        return false;
      } finally {
        scratch.remove();
      }
    }
  };

  copyBtn?.addEventListener("click", async () => {
    if (await copyText(absoluteUrl(shareUrl))) confirmCopy();
    else showToast("Failed to copy — try selecting the link manually", "error");
  });

  // ── Share ────────────────────────────────────────────────────────────────
  shareBtn?.addEventListener("click", async () => {
    const url = absoluteUrl(config.pageUrl || shareUrl);
    if (navigator.share) {
      try {
        await navigator.share({ title: fileName, url });
      } catch {
        /* the visitor dismissed the share sheet */
      }
      return;
    }
    if (await copyText(url)) showToast("Link copied");
    else showToast("Failed to copy — try selecting the link manually", "error");
  });

  // ── Download feedback ────────────────────────────────────────────────────
  let downloadResetTimer = null;

  downloadBtn?.addEventListener("click", () => {
    clearTimeout(downloadResetTimer);
    const label = downloadBtn.querySelector("span");
    const originalText = label ? label.textContent : "";
    downloadBtn.classList.add("is-confirmed");
    if (label) label.textContent = "Starting…";
    downloadResetTimer = setTimeout(() => {
      downloadBtn.classList.remove("is-confirmed");
      if (label) label.textContent = originalText || "Direct Download";
    }, 1500);
  });

  // ── Footer year ──────────────────────────────────────────────────────────
  const slot = document.getElementById("copyrightYear");
  if (slot) slot.textContent = new Date().getFullYear();

  prunePlayerGroups();
  wirePlayerLinks();
})();
