// Web Audio chimes for WhatsAppInbox — no asset files, works after first user gesture.

let audioCtx = null;

export function unlockInboxAlertAudio() {
  if (typeof window === "undefined") return;
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }
}

function playTone(freq, startOffsetSec, durationSec, volume = 0.22) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.value = freq;
  osc.type = "sine";
  const t = audioCtx.currentTime + startOffsetSec;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.001, t + durationSec);
  osc.start(t);
  osc.stop(t + durationSec + 0.04);
}

/** Suite guest — bright double chime (higher pitch). */
export function playSuiteGuestAlert() {
  unlockInboxAlertAudio();
  playTone(880, 0, 0.14, 0.2);
  playTone(1174, 0.17, 0.18, 0.22);
}

/** Guest not in resort today — lower two-note alert. */
export function playOffResortGuestAlert() {
  unlockInboxAlertAudio();
  playTone(523, 0, 0.22, 0.2);
  playTone(392, 0.26, 0.32, 0.18);
}
