# Сторонние библиотеки

- `livekit-client.umd.js`, `livekit-client.e2ee.worker.js` — [livekit-client](https://github.com/livekit/client-sdk-js) 2.23.0 (Apache-2.0, `LICENSE-livekit-client`), из npm-пакета как есть. Голос больших комнат через медиасервер LiveKit.
- `noise/` — [@sapphi-red/web-noise-suppressor](https://github.com/sapphi-red/web-noise-suppressor) 0.4.1 (MIT, `noise/LICENSE`; внутри нейросеть [RNNoise](https://github.com/xiph/rnnoise), BSD): шумоподавление микрофона. Из npm-пакета как есть: `index.js`, `rnnoise/workletProcessor.js`, `rnnoise*.wasm`.
