// Entry point. In the iPhone app, native pieces are set up first (durable storage must be
// loaded before the game reads its profile); in a browser the game starts straight away.

const native = !!window.Capacitor?.isNativePlatform?.();

(native ? import('./native/native.js').then((m) => m.startNative()).catch((e) => console.warn('native start', e)) : Promise.resolve())
  .then(() => import('./main.js'));
