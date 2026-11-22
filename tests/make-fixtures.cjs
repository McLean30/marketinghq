// Generates clearly labelled TEST assets (not real photography, not the official logo). Run: node tests/make-fixtures.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, 'fixtures');

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  const photo = await p.evaluate(() => {
    const W = 3000, H = 2000, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    // overcast UK sky
    let gr = g.createLinearGradient(0, 0, 0, 900); gr.addColorStop(0, '#9fb2c4'); gr.addColorStop(1, '#d9dfe4'); g.fillStyle = gr; g.fillRect(0, 0, W, 900);
    g.fillStyle = 'rgba(255,255,255,.35)'; for (let i = 0; i < 14; i++) { g.beginPath(); g.ellipse(200 + i * 230, 180 + (i % 3) * 90, 260, 60, 0, 0, 7); g.fill(); }
    // distant skyline
    g.fillStyle = '#8a96a3'; for (let i = 0; i < 26; i++) { const w = 90 + (i * 37) % 120, h = 120 + (i * 53) % 260; g.fillRect(i * 118, 900 - h, w, h); }
    g.fillStyle = '#76828f'; for (let i = 0; i < 18; i++) { const w = 140, h = 80 + (i * 71) % 180; g.fillRect(40 + i * 170, 900 - h, w, h); }
    // roof membrane with perspective lines
    gr = g.createLinearGradient(0, 860, 0, H); gr.addColorStop(0, '#6f7378'); gr.addColorStop(1, '#4b4e52'); g.fillStyle = gr; g.fillRect(0, 860, W, H - 860);
    g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 4; for (let i = -10; i < 30; i++) { g.beginPath(); g.moveTo(W / 2 + i * 40, 860); g.lineTo(W / 2 + i * 260, H); g.stroke(); }
    // parapet + handrail
    g.fillStyle = '#5c6066'; g.fillRect(0, 840, W, 40);
    g.strokeStyle = '#e3c22b'; g.lineWidth = 10; g.beginPath(); g.moveTo(0, 760); g.lineTo(W, 760); g.stroke(); for (let x = 60; x < W; x += 240) { g.beginPath(); g.moveTo(x, 760); g.lineTo(x, 860); g.stroke(); }
    // big AHU unit (left-centre)
    const box = (x, y, w, h, c1, c2) => { const q = g.createLinearGradient(x, y, x, y + h); q.addColorStop(0, c1); q.addColorStop(1, c2); g.fillStyle = q; g.fillRect(x, y, w, h); g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 3; g.strokeRect(x, y, w, h); };
    box(300, 980, 1300, 560, '#c9ced3', '#9aa1a8');
    for (let i = 0; i < 6; i++) { box(340 + i * 205, 1030, 180, 440, '#b9bfc5', '#8f969d'); g.fillStyle = '#2b3036'; for (let k = 0; k < 9; k++) g.fillRect(360 + i * 205, 1070 + k * 42, 140, 8); }
    g.fillStyle = '#1d4f8f'; g.fillRect(320, 1000, 260, 40); g.fillStyle = '#fff'; g.font = 'bold 28px Arial'; g.fillText('AHU-02', 360, 1030);
    // ductwork
    box(1600, 1120, 640, 140, '#d7dbdf', '#a9aeb3'); box(2140, 1000, 140, 260, '#d7dbdf', '#a9aeb3');
    g.strokeStyle = 'rgba(0,0,0,.2)'; for (let x = 1640; x < 2240; x += 80) { g.beginPath(); g.moveTo(x, 1120); g.lineTo(x, 1260); g.stroke(); }
    // condenser units with fans (right)
    for (let i = 0; i < 2; i++) { const x = 1750 + i * 520; box(x, 1380, 460, 360, '#e2e5e8', '#b3b8bd'); for (let f = 0; f < 2; f++) { const cx = x + 120 + f * 220, cy = 1470; g.fillStyle = '#2d3238'; g.beginPath(); g.arc(cx, cy, 88, 0, 7); g.fill(); g.strokeStyle = '#8b939b'; g.lineWidth = 4; for (let r = 20; r < 90; r += 16) { g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke(); } } }
    // engineer (right side): hi-vis, hard hat, kneeling at condenser with tablet
    const ex = 2700, ey = 1180;
    g.fillStyle = 'rgba(0,0,0,.3)'; g.beginPath(); g.ellipse(ex, ey + 640, 220, 40, 0, 0, 7); g.fill();
    g.fillStyle = '#1f2a3d'; g.fillRect(ex - 80, ey + 330, 70, 300); g.fillRect(ex + 10, ey + 330, 70, 300);
    g.fillStyle = '#111'; g.fillRect(ex - 95, ey + 610, 95, 36); g.fillRect(ex + 5, ey + 610, 95, 36);
    g.fillStyle = '#e8f03a'; g.beginPath(); g.moveTo(ex - 120, ey + 90); g.lineTo(ex + 120, ey + 90); g.lineTo(ex + 110, ey + 340); g.lineTo(ex - 110, ey + 340); g.fill();
    g.fillStyle = '#c9d1d9'; g.fillRect(ex - 118, ey + 230, 236, 22); g.fillRect(ex - 118, ey + 280, 236, 22); g.fillRect(ex - 14, ey + 90, 28, 250);
    g.fillStyle = '#c98e6b'; g.beginPath(); g.arc(ex, ey + 30, 70, 0, 7); g.fill();
    g.fillStyle = '#f4f6f8'; g.beginPath(); g.ellipse(ex, ey - 10, 92, 60, 0, Math.PI, 0); g.fill(); g.fillRect(ex - 100, ey - 14, 200, 18);
    g.save(); g.translate(ex - 170, ey + 190); g.rotate(-0.25); g.fillStyle = '#0e1626'; g.fillRect(0, 0, 150, 110); g.fillStyle = '#2b6a9a'; g.fillRect(12, 12, 126, 86); g.restore();
    g.strokeStyle = '#e8f03a'; g.lineWidth = 46; g.lineCap = 'round'; g.beginPath(); g.moveTo(ex - 100, ey + 120); g.lineTo(ex - 150, ey + 230); g.stroke();
    // label: this is a test asset
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(30, H - 90, 1260, 60); g.fillStyle = '#fff'; g.font = 'bold 34px Arial'; g.fillText('TEST ASSET · synthetic rooftop HVAC scene · not a real photo', 50, H - 48);
    return c.toDataURL('image/jpeg', 0.92);
  });
  fs.writeFileSync(path.join(out, 'TEST-ASSET-rooftop-hvac-synthetic.jpg'), Buffer.from(photo.split(',')[1], 'base64'));
  const logo = await p.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 400; const g = c.getContext('2d');
    g.strokeStyle = '#2EE6FF'; g.lineWidth = 18; g.beginPath(); g.moveTo(30, 90); g.lineTo(150, 30); g.lineTo(270, 90); g.lineTo(270, 310); g.lineTo(150, 370); g.lineTo(30, 310); g.closePath(); g.stroke();
    g.strokeStyle = '#fff'; g.lineWidth = 26; g.lineJoin = 'round'; g.beginPath(); g.moveTo(95, 280); g.lineTo(95, 120); g.lineTo(205, 280); g.lineTo(205, 120); g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 170px Arial'; g.fillText('NEXAI', 320, 240);
    g.fillStyle = '#2EE6FF'; g.font = 'bold 52px Arial'; g.fillText('TEST LOGO · not official', 326, 330);
    return c.toDataURL('image/png');
  });
  fs.writeFileSync(path.join(out, 'TEST-ASSET-nexai-logo-not-official.png'), Buffer.from(logo.split(',')[1], 'base64'));
  await b.close();
  console.log('fixtures written');
})();
