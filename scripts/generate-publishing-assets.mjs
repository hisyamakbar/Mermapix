import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const assetsDir = path.resolve(rootDir, 'plugin/assets')

if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true })
}

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9444
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function launchChrome() {
  const profile = await mkdtemp(path.join(tmpdir(), 'mermapix-assets-'))
  const proc = spawn(
    chromePath,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      '--window-size=1920,1080',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const pages = await res.json()
      const page = pages.find((p) => p.type === 'page')
      if (page) return { proc, profile, wsUrl: page.webSocketDebuggerUrl }
    } catch {}
    await sleep(150)
  }
  proc.kill('SIGKILL')
  throw new Error('Chrome failed to start within timeout')
}

function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let nextId = 1
  const pending = new Map()

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    }
  })

  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => {
      const send = (method, params = {}) =>
        new Promise((res, rej) => {
          const id = nextId++
          pending.set(id, { resolve: res, reject: rej })
          ws.send(JSON.stringify({ id, method, params }))
        })
      resolve({ send, close: () => ws.close() })
    })
    ws.addEventListener('error', reject)
  })
}

async function main() {
  console.log('🎨 Generating Figma Community Publishing Assets...')
  const { proc, profile, wsUrl } = await launchChrome()
  const { send, close } = await connectCdp(wsUrl)

  try {
    await send('Page.enable')

    // 1. Generate 128x128 Plugin Icon
    console.log('📌 Rendering 128x128 Plugin Icon...')
    const iconHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 128px;
      height: 128px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
    }
    svg {
      width: 128px;
      height: 128px;
    }
  </style>
</head>
<body>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <path fill="#D1336A" d="M204.80 0.00L307.20 0.00C479.23 0.00 512.00 32.77 512.00 204.80L512.00 307.20C512.00 479.23 479.23 512.00 307.20 512.00L204.80 512.00C32.77 512.00 0.00 479.23 0.00 307.20L0.00 204.80C0.00 32.77 32.77 0.00 204.80 0.00Z"/>
    <path fill="#FFFFFF" d="M281.68 122.80L395.66 122.80C409.01 122.80 419.84 133.62 419.84 146.98C419.84 160.33 409.01 171.15 395.66 171.15L330.03 171.15L330.03 202.24L368.03 202.24C381.38 202.24 392.21 213.07 392.21 226.42C392.21 239.77 381.38 250.60 368.03 250.60L330.03 250.60L330.03 307.59C330.03 357.19 289.83 397.39 240.23 397.39C190.63 397.39 150.42 357.19 150.42 307.59L150.42 281.68C114.48 266.90 92.16 230.63 95.16 191.88C124.16 200.20 151.18 214.30 174.60 233.33C198.02 214.30 225.04 200.20 254.05 191.88C257.04 230.63 234.72 266.90 198.78 281.68L198.78 307.59C198.78 330.48 217.34 349.04 240.23 349.04C263.12 349.04 281.68 330.48 281.68 307.59Z"/>
  </svg>
</body>
</html>`

    await send('Emulation.setDeviceMetricsOverride', {
      width: 128,
      height: 128,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await send('Page.navigate', {
      url: `data:text/html;charset=utf-8,${encodeURIComponent(iconHtml)}`,
    })
    await sleep(200)

    const iconScreenshot = await send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    })
    const iconPath = path.join(assetsDir, 'icon-128.png')
    fs.writeFileSync(iconPath, Buffer.from(iconScreenshot.data, 'base64'))
    console.log(`✅ Saved icon: ${iconPath}`)

    // 2. Generate 1920x1080 Community Cover Banner
    console.log('🖼️ Rendering 1920x1080 Community Cover Banner...')
    const coverHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 1920px;
      height: 1080px;
      overflow: hidden;
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      background: radial-gradient(100% 120% at 50% 0%, #151d28 0%, #080d14 100%);
      color: #f1f5f9;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      padding: 70px 100px;
      position: relative;
    }
    .grid-bg {
      position: absolute;
      inset: 0;
      background-image: linear-gradient(to right, rgba(255, 255, 255, 0.04) 1px, transparent 1px),
                        linear-gradient(to bottom, rgba(255, 255, 255, 0.04) 1px, transparent 1px);
      background-size: 40px 40px;
      mask-image: radial-gradient(circle at 50% 50%, black 50%, transparent 90%);
      pointer-events: none;
    }
    .glow {
      position: absolute;
      width: 800px;
      height: 400px;
      background: radial-gradient(circle, rgba(209, 51, 106, 0.22) 0%, transparent 70%);
      top: 15%;
      left: 50%;
      transform: translate(-50%, -50%);
      filter: blur(80px);
      pointer-events: none;
    }
    header {
      z-index: 10;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 16px;
    }
    .brand-row {
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .logo-icon {
      width: 64px;
      height: 64px;
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(209, 51, 106, 0.4);
    }
    h1 {
      font-size: 64px;
      font-weight: 800;
      letter-spacing: -0.03em;
      background: linear-gradient(180deg, #ffffff 0%, #cbd5e1 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .badge {
      background: rgba(209, 51, 106, 0.15);
      border: 1px solid rgba(209, 51, 106, 0.4);
      color: #ff6b98;
      font-size: 15px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 6px 16px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    p.subtitle {
      font-size: 26px;
      color: #94a3b8;
      max-width: 900px;
      line-height: 1.4;
      font-weight: 400;
    }
    p.subtitle strong {
      color: #38bdf8;
      font-weight: 600;
    }
    .visual-stage {
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 50px;
      width: 100%;
      margin: 20px 0;
    }
    .card {
      background: rgba(21, 29, 39, 0.85);
      border: 1.5px solid rgba(138, 148, 166, 0.35);
      border-radius: 14px;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(20px);
      width: 380px;
      overflow: hidden;
    }
    .card-header {
      background: rgba(255, 255, 255, 0.05);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding: 14px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .card-title {
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: #ffffff;
    }
    .autolayout-tag {
      font-size: 11px;
      font-weight: 600;
      color: #38bdf8;
      background: rgba(56, 189, 248, 0.12);
      border: 1px solid rgba(56, 189, 248, 0.3);
      padding: 3px 8px;
      border-radius: 6px;
    }
    .card-body {
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
    }
    .card-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: #cbd5e1;
    }
    .row-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .col-type {
      color: #38bdf8;
      font-size: 12px;
    }
    .col-name {
      font-weight: 600;
      color: #ffffff;
    }
    .key-badge {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .key-pk {
      background: rgba(244, 63, 94, 0.2);
      color: #fb7185;
      border: 1px solid rgba(244, 63, 94, 0.4);
    }
    .key-fk {
      background: rgba(168, 85, 247, 0.2);
      color: #c084fc;
      border: 1px solid rgba(168, 85, 247, 0.4);
    }
    .key-uk {
      background: rgba(234, 179, 8, 0.2);
      color: #fde047;
      border: 1px solid rgba(234, 179, 8, 0.4);
    }
    .arrow-connector {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      color: #64748b;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
    }
    .arrow-line {
      width: 100px;
      height: 2px;
      background: linear-gradient(90deg, #38bdf8, #d1336a);
      position: relative;
    }
    .features-pill {
      z-index: 10;
      display: flex;
      align-items: center;
      gap: 24px;
      background: rgba(15, 22, 31, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.1);
      padding: 12px 36px;
      border-radius: 999px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    }
    .feature-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 15px;
      font-weight: 600;
      color: #e2e8f0;
    }
    .feature-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #38bdf8;
    }
  </style>
</head>
<body>
  <div class="grid-bg"></div>
  <div class="glow"></div>

  <header>
    <div class="badge">✦ Native Figma Plugin</div>
    <div class="brand-row">
      <svg class="logo-icon" viewBox="0 0 512 512">
        <path fill="#D1336A" d="M204.80 0.00L307.20 0.00C479.23 0.00 512.00 32.77 512.00 204.80L512.00 307.20C512.00 479.23 479.23 512.00 307.20 512.00L204.80 512.00C32.77 512.00 0.00 479.23 0.00 307.20L0.00 204.80C0.00 32.77 32.77 0.00 204.80 0.00Z"/>
        <path fill="#FFFFFF" d="M281.68 122.80L395.66 122.80C409.01 122.80 419.84 133.62 419.84 146.98C419.84 160.33 409.01 171.15 395.66 171.15L330.03 171.15L330.03 202.24L368.03 202.24C381.38 202.24 392.21 213.07 392.21 226.42C392.21 239.77 381.38 250.60 368.03 250.60L330.03 250.60L330.03 307.59C330.03 357.19 289.83 397.39 240.23 397.39C190.63 397.39 150.42 357.19 150.42 307.59L150.42 281.68C114.48 266.90 92.16 230.63 95.16 191.88C124.16 200.20 151.18 214.30 174.60 233.33C198.02 214.30 225.04 200.20 254.05 191.88C257.04 230.63 234.72 266.90 198.78 281.68L198.78 307.59C198.78 330.48 217.34 349.04 240.23 349.04C263.12 349.04 281.68 330.48 281.68 307.59Z"/>
      </svg>
      <h1>Mermapix</h1>
    </div>
    <p class="subtitle">
      Paste Mermaid, DBML, or SQL schemas & get <strong>editable Auto Layout Figma layers</strong>. Not a flat image.
    </p>
  </header>

  <div class="visual-stage">
    <!-- CUSTOMER Table -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">CUSTOMER</span>
        <span class="autolayout-tag">Auto Layout</span>
      </div>
      <div class="card-body">
        <div class="card-row">
          <div class="row-left">
            <span class="col-type">uuid</span>
            <span class="col-name">id</span>
          </div>
          <span class="key-badge key-pk">PK</span>
        </div>
        <div class="card-row">
          <div class="row-left">
            <span class="col-type">string</span>
            <span class="col-name">email</span>
          </div>
          <span class="key-badge key-uk">UK</span>
        </div>
        <div class="card-row">
          <div class="row-left">
            <span class="col-type">string</span>
            <span class="col-name">full_name</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Connector -->
    <div class="arrow-connector">
      <span>||--o{</span>
      <div class="arrow-line"></div>
      <span>places</span>
    </div>

    <!-- ORDER Table -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">ORDER</span>
        <span class="autolayout-tag">Auto Layout</span>
      </div>
      <div class="card-body">
        <div class="card-row">
          <div class="row-left">
            <span class="col-type">uuid</span>
            <span class="col-name">id</span>
          </div>
          <span class="key-badge key-pk">PK</span>
        </div>
        <div class="card-row">
          <div class="row-left">
            <span class="col-type">uuid</span>
            <span class="col-name">customer_id</span>
          </div>
          <span class="key-badge key-fk">FK</span>
        </div>
        <div class="card-row">
          <div class="row-left">
            <span class="col-type">timestamp</span>
            <span class="col-name">created_at</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Connector -->
    <div class="arrow-connector">
      <span>||--|{</span>
      <div class="arrow-line"></div>
      <span>contains</span>
    </div>

    <!-- ORDER_ITEM Table -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">ORDER_ITEM</span>
        <span class="autolayout-tag">Auto Layout</span>
      </div>
      <div class="card-body">
        <div class="card-row">
          <div class="row-left">
            <span class="col-type">uuid</span>
            <span class="col-name">order_id</span>
          </div>
          <span class="key-badge key-fk">FK</span>
        </div>
        <div class="card-row">
          <div class="row-left">
            <span class="col-type">int</span>
            <span class="col-name">quantity</span>
          </div>
        </div>
        <div class="card-row">
          <div class="row-left">
            <span class="col-type">decimal</span>
            <span class="col-name">unit_price</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="features-pill">
    <div class="feature-item"><div class="feature-dot"></div> Native Auto Layout</div>
    <div class="feature-item"><div class="feature-dot"></div> DBML & SQL Importer</div>
    <div class="feature-item"><div class="feature-dot"></div> 100% Offline & Private</div>
    <div class="feature-item"><div class="feature-dot"></div> Light & Dark Sync</div>
    <div class="feature-item"><div class="feature-dot"></div> Flowchart & Sequence</div>
  </div>
</body>
</html>`

    await send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await send('Page.navigate', {
      url: `data:text/html;charset=utf-8,${encodeURIComponent(coverHtml)}`,
    })
    // Give fonts a moment to render
    await sleep(600)

    const coverScreenshot = await send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    })
    const coverPath = path.join(assetsDir, 'cover-1920x1080.png')
    fs.writeFileSync(coverPath, Buffer.from(coverScreenshot.data, 'base64'))
    console.log(`✅ Saved cover banner: ${coverPath}`)
  } finally {
    close()
    proc.kill('SIGKILL')
    await rm(profile, { recursive: true, force: true }).catch(() => {})
  }

  console.log('🎉 All Figma publishing visual assets generated successfully!')
}

main().catch((err) => {
  console.error('Error generating assets:', err)
  process.exit(1)
})
