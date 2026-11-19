import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';

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

  cbRef.current = onDetected;

  useEffect(() => {
    let controls;
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();

    reader
      .decodeFromConstraints({ video: { facingMode: 'environment' } }, videoRef.current, (result) => {
        if (!result) return;
        const text = result.getText();
        const now = Date.now();
        if (text === lastRef.current.text && now - lastRef.current.at < cooldownMs) return;
        lastRef.current = { text, at: now };
        cbRef.current(text);
      })
      .then((c) => {
        if (cancelled) c.stop();
        else controls = c;
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err?.name === 'NotAllowedError'
            ? 'Camera permission was denied.'
            : !window.isSecureContext
              ? 'Camera requires HTTPS (or localhost).'
              : 'Could not start the camera.'
        );
      });

    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [cooldownMs]);

  return (
    <div className="camera">
      {error ? <p className="camera-error">{error}</p> : <video ref={videoRef} muted playsInline />}
      {!error && <div className="camera-guide" aria-hidden="true" />}
    </div>
  );
}
