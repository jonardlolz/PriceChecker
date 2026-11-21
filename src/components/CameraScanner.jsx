import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';

const PREF_KEY = 'pc_camera_id';

const loadPref = () => {
  try { return localStorage.getItem(PREF_KEY); } catch { return null; }
};
const savePref = (id) => {
  try { localStorage.setItem(PREF_KEY, id); } catch { /* ignore */ }
};

// Higher resolution makes thin barcode bars readable; the browser picks the closest it supports.
const RESOLUTION = { width: { ideal: 1920 }, height: { ideal: 1080 } };

const isBack = (label) => /back|rear|environment|facing back/i.test(label);
// Lenses that are bad for barcodes: ultra-wide (0.5x, can't focus close), telephoto, depth/IR sensors.
const isSpecialLens = (label) => /ultra|0\.5|tele|depth|macro|infrared|\bir\b|desk view/i.test(label);
// Android labels look like "camera2 0, facing back"; the lowest number is normally the main camera.
const androidIndex = (label) => Number(/camera2?\s*(\d+)/i.exec(label)?.[1] ?? 99);

/**
 * Orders cameras so the best one for barcodes comes first: main back camera, then other
 * back cameras, then special lenses, then front cameras.
 */
function rankCameras(devices) {
  const score = (d) => {
    const l = d.label || '';
    let s = 0;
    if (!isBack(l)) s += 1000;
    if (isSpecialLens(l)) s += 100;
    // iPhone: "Back Camera" is the plain 1x wide lens; virtual "Dual/Triple" cameras may switch lenses.
    if (/^back camera$/i.test(l.trim())) s -= 50;
    else if (/dual|triple/i.test(l)) s += 10;
    return s + Math.min(androidIndex(l), 99) / 100;
  };
  return [...devices].sort((a, b) => score(a) - score(b));
}

/** Start at 1x (some phones expose the ultra-wide as zoom 0.5 on one camera) and keep autofocus on. */
async function tuneTrack(track) {
  const caps = track.getCapabilities?.() ?? {};
  const advanced = [];
  if (caps.zoom && caps.zoom.min < 1 && caps.zoom.max >= 1) advanced.push({ zoom: 1 });
  if (caps.focusMode?.includes('continuous')) advanced.push({ focusMode: 'continuous' });
  for (const c of advanced) {
    try { await track.applyConstraints({ advanced: [c] }); } catch { /* unsupported on this device */ }
  }
}

const stopStream = (stream) => stream?.getTracks().forEach((t) => t.stop());

/**
 * Live camera barcode scanner (EAN-13, EAN-8, UPC-A/E, Code 128, Code 39, QR, etc.).
 * Calls onDetected(text) for each new code; repeated reads of the same code
 * within `cooldownMs` are ignored so a held-up item isn't re-scanned constantly.
 */
export default function CameraScanner({ onDetected, cooldownMs = 2000 }) {
  const videoRef = useRef(null);
  const lastRef = useRef({ text: '', at: 0 });
  const cbRef = useRef(onDetected);
  const [error, setError] = useState('');
  const [cameras, setCameras] = useState([]); // ranked list, best first
  const [deviceId, setDeviceId] = useState(loadPref); // null = choose automatically

  cbRef.current = onDetected;

  useEffect(() => {
    let controls;
    let stream;
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();

    const open = (id) =>
      navigator.mediaDevices.getUserMedia({
        audio: false,
        video: id ? { deviceId: { exact: id }, ...RESOLUTION } : { facingMode: { ideal: 'environment' }, ...RESOLUTION },
      });

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error(), { name: 'NoMediaDevices' });

        // 1. Open the saved camera, or let the browser pick a back camera.
        try {
          stream = await open(deviceId);
        } catch (err) {
          if (!deviceId || err?.name === 'NotAllowedError') throw err;
          stream = await open(null); // saved camera is gone (e.g. new phone) — fall back
        }
        if (cancelled) return stopStream(stream);

        // 2. Camera names are only visible after permission is granted; rank them now.
        const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
        const ranked = rankCameras(all);
        if (cancelled) return stopStream(stream);
        setCameras(ranked);

        // 3. On automatic choice, switch away from e.g. the 0.5x ultra-wide to the main back camera.
        const current = stream.getVideoTracks()[0]?.getSettings().deviceId;
        const best = ranked[0]?.deviceId;
        if (!deviceId && best && current && best !== current) {
          stopStream(stream);
          stream = await open(best);
          if (cancelled) return stopStream(stream);
        }

        const track = stream.getVideoTracks()[0];
        await tuneTrack(track);
        if (cancelled) return stopStream(stream);

        controls = await reader.decodeFromStream(stream, videoRef.current, (result) => {
          if (!result) return;
          const text = result.getText();
          const now = Date.now();
          if (text === lastRef.current.text && now - lastRef.current.at < cooldownMs) return;
          lastRef.current = { text, at: now };
          cbRef.current(text);
        });
        if (cancelled) controls.stop();
      } catch (err) {
        stopStream(stream);
        if (cancelled) return;
        setError(
          err?.name === 'NotAllowedError'
            ? 'Camera permission was denied.'
            : !window.isSecureContext
              ? 'Camera requires HTTPS (or localhost).'
              : 'Could not start the camera.'
        );
      }
    })();

    return () => {
      cancelled = true;
      controls?.stop(); // also stops the stream's tracks
      stopStream(stream);
    };
  }, [cooldownMs, deviceId]);

  // Cycle through cameras; the choice is remembered on this device.
  const switchCamera = () => {
    if (cameras.length < 2) return;
    const current = deviceId ?? cameras[0].deviceId;
    const i = cameras.findIndex((c) => c.deviceId === current);
    const next = cameras[(i + 1) % cameras.length].deviceId;
    savePref(next);
    setError('');
    setDeviceId(next);
  };

  const activeIndex = Math.max(0, cameras.findIndex((c) => c.deviceId === (deviceId ?? cameras[0]?.deviceId)));

  return (
    <div className="camera-wrap">
      <div className="camera">
        {error ? <p className="camera-error">{error}</p> : <video ref={videoRef} muted playsInline />}
        {!error && <div className="camera-guide" aria-hidden="true" />}
      </div>
      {cameras.length > 1 && (
        <button type="button" className="secondary small camera-switch" onClick={switchCamera}>
          Switch camera ({activeIndex + 1}/{cameras.length})
        </button>
      )}
    </div>
  );
}
