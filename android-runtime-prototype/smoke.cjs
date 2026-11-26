const fs = require('fs');
const path = require('path');
(async () => {
  const out = path.join(process.argv[2], 'result.json');
  try {
    const baileys = await import('@whiskeysockets/baileys');
    const crypto = require('node:crypto');
    fs.writeFileSync(out, JSON.stringify({ok: typeof baileys.default === 'function', node: process.version, crypto: crypto.randomBytes(8).length}));
  } catch (e) { fs.writeFileSync(out, JSON.stringify({ok:false, error: e.stack || String(e)})); }
})();
