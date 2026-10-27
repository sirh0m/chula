import { useCallback, useEffect, useState } from 'react';

/** Browser location as [lat, lng], requested once on mount. Never blocks the UI. */
export function useGeolocation({ auto = true } = {}) {
  const [position, setPosition] = useState(null);
  const [status, setStatus] = useState('idle');

  const request = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setStatus('unsupported');
      return;
    }
    setStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition([pos.coords.latitude, pos.coords.longitude]);
        setStatus('ready');
      },
      () => setStatus('denied'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 },
    );
  }, []);

  useEffect(() => {
    if (auto) request();
  }, [auto, request]);

  return { position, status, request };
}
