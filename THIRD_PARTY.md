# Third-party materials

This project uses original app and Compact logic. It does not fork an existing event-pass application or redistribute Apple product images/fonts/logos.

Direct browser dependencies:

- React / React DOM 19.3.0: MIT, https://github.com/facebook/react/blob/main/LICENSE
- Lucide React 0.468.0: ISC, https://github.com/lucide-icons/lucide/blob/main/LICENSE
- QRCode 1.5.4: MIT, https://github.com/soldair/node-qrcode/blob/master/license
- jsQR 1.4.0: Apache-2.0, https://github.com/cozmo/jsQR/blob/master/LICENSE (on-device public QR decoding; camera frames are not uploaded)

Development dependencies are recorded with exact versions and integrity hashes in package-lock.json. Their licenses remain applicable. Vite, TypeScript, Playwright and tsx are build/test tools rather than original Guestlist features.

Midnight dependencies and compiler:

- Official Compact compiler/runtime and Midnight.js packages: consult their repository/package licenses at https://github.com/LFDT-Minokawa/compact and https://github.com/midnightntwrk/midnight-js
- Generated JavaScript, type declarations, intermediate circuits and proving/verifier keys were actually emitted from this project's original contract; the generated public artifacts do not contain real issuer or attendee secrets
- Exact supported versions and primary references: contracts/README.md and browser-integration/README.md

No demo photos, music, proprietary fonts, client assets, real contacts or Apple screenshots are redistributed. The favicon is an original simple functional ticket mark; other interface icons come from Lucide.

Browser compatibility shims use module-local imports, not modified global objects: buffer 6.0.3 (MIT), assert 2.1.0 (MIT), process 0.11.10 (MIT). Their official package manifests and licenses are pinned by browser-integration/package-lock.json. The gate service uses Node built-in SQLite and adds no database package; Node/SQLite licensing remains applicable. No original project open-source license grant has been selected.
