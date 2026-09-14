// Generate tiny, original browser media for the editor acceptance tests.
const { chromium } = require('../web/node_modules/@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const directory = path.join(__dirname, 'fixtures'); fs.mkdirSync(directory, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge' });
  try {
    const page = await browser.newPage();
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 300;
      const ctx = canvas.getContext('2d'); const fill = ctx.createLinearGradient(0, 0, 480, 300);
      fill.addColorStop(0, '#1d4ed8'); fill.addColorStop(1, '#0891b2'); ctx.fillStyle = fill; ctx.fillRect(0, 0, 480, 300);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 28px sans-serif'; ctx.fillText('ITMAO / MEDIA', 32, 145);
      ctx.font = '16px sans-serif'; ctx.fillText('Editor acceptance sample', 34, 180);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    fs.writeFileSync(path.join(directory, 'editor.png'), Buffer.from(png, 'base64'));
    for (const [extension, mime] of [['mp4', 'video/mp4;codecs=vp9'], ['webm', 'video/webm;codecs=vp8']]) {
      const bytes = await page.evaluate(async mime => {
        const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
        const ctx = canvas.getContext('2d'); const stream = canvas.captureStream(10);
        const recorder = new MediaRecorder(stream, { mimeType: mime }); const chunks = [];
        recorder.ondataavailable = e => chunks.push(e.data);
        const finished = new Promise(resolve => { recorder.onstop = resolve; }); recorder.start();
        let n = 0; const interval = setInterval(() => { ctx.fillStyle = n++ % 2 ? '#2563eb' : '#10b981'; ctx.fillRect(0, 0, 160, 90); }, 100);
        await new Promise(resolve => setTimeout(resolve, 1600)); recorder.stop(); await finished; clearInterval(interval); stream.getTracks().forEach(t => t.stop());
        return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
      }, mime);
      if (bytes.length < 32) throw new Error(`Recorder did not produce ${extension}`);
      fs.writeFileSync(path.join(directory, `editor.${extension}`), Buffer.from(bytes));
    }
    const samples = 4000, wav = Buffer.alloc(44 + samples * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * i / 8000) * 1000), 44 + i * 2);
    fs.writeFileSync(path.join(directory, 'editor.wav'), wav);
    console.log('Generated MP4, WebM and WAV fixtures.');
  } finally { await browser.close(); }
})();
