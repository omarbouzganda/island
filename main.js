const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execSync, exec } = require('child_process')

let mainWindow
const USER_DATA = path.join(app.getPath('userData'), 'island-vault')
const CONFIG_FILE = path.join(USER_DATA, 'config.json')
const VHD_PATH = path.join(app.getPath('userData'), 'Island.vhd')
const VHD_SIZE_MB = 2048 // 2GB virtual disk

let vaultMountPoint = USER_DATA // fallback if VHD fails

function ensureVault() {
  ['', 'files', 'gallery', 'notes', 'voice', 'converted'].forEach(d => {
    const p = d ? path.join(vaultMountPoint, d) : vaultMountPoint
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
  })
}

async function createVirtualDisk() {
  if (process.platform === 'win32') {
    return createVHDWindows()
  } else if (process.platform === 'linux') {
    return createLoopLinux()
  }
  return false
}

function createVHDWindows() {
  try {
    // Check if already mounted
    const drives = ['D', 'E', 'F', 'G', 'H', 'I']
    let mountDrive = null
    
    // Create VHD script
    const scriptPath = path.join(os.tmpdir(), 'island_vhd.txt')
    
    // Check if VHD already exists and try to mount it
    if (fs.existsSync(VHD_PATH)) {
      // Try to attach existing VHD
      for (const drive of drives) {
        if (!fs.existsSync(`${drive}:\\`)) {
          const attachScript = `select vdisk file="${VHD_PATH}"\nattach vdisk\nassign letter=${drive}`
          fs.writeFileSync(scriptPath, attachScript)
          try {
            execSync(`diskpart /s "${scriptPath}"`, { timeout: 30000, stdio: 'ignore' })
            if (fs.existsSync(`${drive}:\\`)) {
              mountDrive = drive
              break
            }
          } catch(e) {}
          break
        }
      }
    }
    
    if (!mountDrive) {
      // Create new VHD
      for (const drive of drives) {
        if (!fs.existsSync(`${drive}:\\`)) {
          const createScript = [
            `create vdisk file="${VHD_PATH}" maximum=${VHD_SIZE_MB} type=expandable`,
            `select vdisk file="${VHD_PATH}"`,
            `attach vdisk`,
            `create partition primary`,
            `format fs=exfat label=ISLAND quick`,
            `assign letter=${drive}`
          ].join('\n')
          fs.writeFileSync(scriptPath, createScript)
          try {
            execSync(`diskpart /s "${scriptPath}"`, { timeout: 60000, stdio: 'ignore' })
            if (fs.existsSync(`${drive}:\\`)) {
              mountDrive = drive
              break
            }
          } catch(e) {}
          break
        }
      }
    }
    
    if (mountDrive) {
      vaultMountPoint = `${mountDrive}:\\Island`
      ensureVault()
      mainWindow && mainWindow.webContents.send('vault-mounted', { drive: mountDrive, path: vaultMountPoint })
      return true
    }
  } catch(e) {
    console.log('VHD creation failed:', e.message)
  }
  // Fallback to normal folder
  vaultMountPoint = USER_DATA
  ensureVault()
  return false
}

function createLoopLinux() {
  try {
    const imgPath = path.join(app.getPath('userData'), 'Island.img')
    const mountPoint = '/mnt/island'
    
    // Check if already mounted
    try {
      const mounts = execSync('mount').toString()
      if (mounts.includes(mountPoint)) {
        vaultMountPoint = path.join(mountPoint, 'Island')
        ensureVault()
        return true
      }
    } catch(e) {}
    
    if (!fs.existsSync(imgPath)) {
      execSync(`dd if=/dev/zero of="${imgPath}" bs=1M count=${VHD_SIZE_MB}`, { timeout: 120000 })
      execSync(`mkfs.exfat "${imgPath}"`)
    }
    
    if (!fs.existsSync(mountPoint)) execSync(`mkdir -p ${mountPoint}`)
    execSync(`mount -o loop "${imgPath}" ${mountPoint}`)
    vaultMountPoint = path.join(mountPoint, 'Island')
    ensureVault()
    mainWindow && mainWindow.webContents.send('vault-mounted', { drive: null, path: vaultMountPoint })
    return true
  } catch(e) {
    console.log('Loop device failed:', e.message)
    vaultMountPoint = USER_DATA
    ensureVault()
    return false
  }
}

function loadConfig() {
  const cfgFile = path.join(USER_DATA, 'config.json')
  if (!fs.existsSync(cfgFile)) {
    if (!fs.existsSync(USER_DATA)) fs.mkdirSync(USER_DATA, { recursive: true })
    const adjs = ['free','wild','silent','brave','dark','azure','storm','echo','swift','calm']
    const nouns = ['island','wave','shore','reef','palm','tide','mist','cove','sail','bay']
    const id = `${adjs[Math.floor(Math.random()*adjs.length)]}${nouns[Math.floor(Math.random()*nouns.length)]}#${Math.floor(1000+Math.random()*9000)}`
    const config = { userId: id, username: '', theme: 'dark-ocean', pin: null, fakePin: null, firstRun: true }
    fs.writeFileSync(cfgFile, JSON.stringify(config, null, 2))
    return config
  }
  return JSON.parse(fs.readFileSync(cfgFile, 'utf8'))
}

function saveConfigFile(data) {
  const cfgFile = path.join(USER_DATA, 'config.json')
  if (!fs.existsSync(USER_DATA)) fs.mkdirSync(USER_DATA, { recursive: true })
  fs.writeFileSync(cfgFile, JSON.stringify(data, null, 2))
}

function createWindow() {
  if (!fs.existsSync(USER_DATA)) fs.mkdirSync(USER_DATA, { recursive: true })
  ensureVault()
  
  const config = loadConfig()
  mainWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 1000, minHeight: 680,
    frame: false, backgroundColor: '#060b18',
    icon: path.join(__dirname, 'assets', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false,
      webSecurity: false
    },
    show: false
  })
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'))
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.webContents.send('show-lock', !!config.pin)
    // Try to create virtual disk after window loads
    setTimeout(() => createVirtualDisk(), 2000)
  })
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

function getDirSize(dir) {
  let s = 0
  try { fs.readdirSync(dir).forEach(f => { const fp = path.join(dir,f), st = fs.statSync(fp); s += st.isDirectory() ? getDirSize(fp) : st.size }) } catch(e) {}
  return s
}

// ── IPC ──
ipcMain.handle('get-config', () => loadConfig())
ipcMain.handle('save-config', (e, u) => {
  const c = { ...loadConfig(), ...u }
  saveConfigFile(c)
  return c
})
ipcMain.handle('verify-pin', (e, pin) => {
  const c = loadConfig()
  if (c.fakePin && pin === c.fakePin) return 'fake'
  if (pin === c.pin) return 'ok'
  return 'wrong'
})
ipcMain.handle('get-vault-info', () => ({
  path: vaultMountPoint,
  isVirtualDisk: vaultMountPoint !== USER_DATA,
  vhdPath: VHD_PATH,
  platform: process.platform
}))
ipcMain.handle('get-disk-stats', () => {
  try {
    const fs2 = getDirSize(path.join(vaultMountPoint, 'files'))
    const gs = getDirSize(path.join(vaultMountPoint, 'gallery'))
    const vs = getDirSize(path.join(vaultMountPoint, 'voice'))
    const total = getDirSize(vaultMountPoint)
    return { vaultSize: total, filesSize: fs2, gallerySize: gs, voiceSize: vs, messagesSize: Math.max(0, total-fs2-gs-vs), freeMem: os.freemem(), totalMem: os.totalmem(), vaultPath: vaultMountPoint, isVirtualDisk: vaultMountPoint !== USER_DATA }
  } catch(e) { return { vaultSize:0, filesSize:0, gallerySize:0, voiceSize:0, messagesSize:0, freeMem:0, totalMem:0, vaultPath: vaultMountPoint, isVirtualDisk: false } }
})
ipcMain.handle('save-note', (e, { id, title, content }) => {
  const dir = path.join(vaultMountPoint, 'notes')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ id, title, content, updated: Date.now() }))
  return true
})
ipcMain.handle('get-notes', () => {
  const dir = path.join(vaultMountPoint, 'notes')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f=>f.endsWith('.json'))
    .map(f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')))
    .sort((a,b)=>b.updated-a.updated)
})
ipcMain.handle('delete-note', (e, id) => {
  const p = path.join(vaultMountPoint, 'notes', `${id}.json`)
  if (fs.existsSync(p)) fs.unlinkSync(p)
  return true
})
ipcMain.handle('save-file', (e, { name, buffer }) => {
  const dir = path.join(vaultMountPoint, 'files')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, name)
  fs.writeFileSync(dest, Buffer.from(buffer))
  return dest
})
ipcMain.handle('get-files', () => {
  const dir = path.join(vaultMountPoint, 'files')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).map(f => { const fp=path.join(dir,f), s=fs.statSync(fp); return { name:f, size:s.size, modified:s.mtimeMs, path:fp } }).sort((a,b)=>b.modified-a.modified)
})
ipcMain.handle('open-file', (e, fp) => shell.openPath(fp))
ipcMain.handle('delete-file', (e, name) => {
  const fp = path.join(vaultMountPoint, 'files', name)
  if (fs.existsSync(fp)) fs.unlinkSync(fp)
  return true
})
ipcMain.handle('get-gallery', () => {
  const dir = path.join(vaultMountPoint, 'gallery')
  if (!fs.existsSync(dir)) return []
  const exts = ['.jpg','.jpeg','.png','.gif','.webp','.mp4','.webm','.mov']
  return fs.readdirSync(dir).filter(f=>exts.includes(path.extname(f).toLowerCase()))
    .map(f => { const fp=path.join(dir,f), s=fs.statSync(fp); return { name:f, size:s.size, path:fp, ext:path.extname(f).toLowerCase() } })
})
ipcMain.handle('save-gallery-file', (e, { name, buffer }) => {
  const dir = path.join(vaultMountPoint, 'gallery')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, name)
  fs.writeFileSync(dest, Buffer.from(buffer))
  return dest
})
ipcMain.handle('copy-file-to-vault', async (e, { srcPath, dest }) => {
  const destDir = path.join(vaultMountPoint, dest)
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
  const name = path.basename(srcPath)
  // handle duplicate names
  let finalName = name, counter = 1
  while (fs.existsSync(path.join(destDir, finalName))) {
    const ext = path.extname(name)
    finalName = `${path.basename(name, ext)}_${counter}${ext}`
    counter++
  }
  const destPath = path.join(destDir, finalName)
  fs.copyFileSync(srcPath, destPath)
  return { name: finalName, path: destPath, size: fs.statSync(destPath).size }
})
ipcMain.handle('emergency-wipe', () => {
  try { fs.rmSync(USER_DATA, { recursive: true, force: true }) } catch(e) {}
  try { if (fs.existsSync(VHD_PATH)) fs.unlinkSync(VHD_PATH) } catch(e) {}
  app.quit()
})
ipcMain.handle('detect-dual-boot', () => {
  const parts = []
  if (process.platform === 'linux') {
    try {
      const data = JSON.parse(execSync('lsblk -o NAME,FSTYPE,SIZE,MOUNTPOINT -J 2>/dev/null').toString())
      const walk = devs => { for (const d of (devs||[])) { if (['ntfs','exfat','vfat'].includes((d.fstype||'').toLowerCase())) parts.push({ name:d.name, type:d.fstype, size:d.size, mount:d.mountpoint }); walk(d.children) } }
      walk(data.blockdevices)
    } catch(e) {}
  }
  return parts
})
ipcMain.handle('mount-partition', async (e, name) => {
  if (process.platform !== 'linux') return { ok: false, msg: 'Linux only' }
  try {
    const mp = `/mnt/island-bridge-${name}`
    if (!fs.existsSync(mp)) fs.mkdirSync(mp, { recursive: true })
    execSync(`pkexec mount /dev/${name} ${mp}`)
    return { ok: true, path: mp }
  } catch(e) { return { ok: false, msg: e.message } }
})
ipcMain.handle('select-files', async (e, opts) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile','multiSelections'],
    filters: opts && opts.images ? [{ name: 'Media', extensions: ['jpg','jpeg','png','gif','webp','mp4','webm','mov'] }] : []
  })
  return r.filePaths
})
ipcMain.handle('get-vault-path', () => vaultMountPoint)

// ── FILE CONVERTER ──
ipcMain.handle('convert-file', async (e, { srcPath, outputFormat }) => {
  const outputDir = path.join(vaultMountPoint, 'converted')
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })
  const inputName = path.basename(srcPath, path.extname(srcPath))
  const outputPath = path.join(outputDir, `${inputName}_converted.${outputFormat}`)
  
  // Read the source file
  const inputExt = path.extname(srcPath).toLowerCase().replace('.', '')
  
  try {
    // Text conversions (no external tools needed)
    if (['txt','md','html','csv','json'].includes(inputExt) && ['txt','md','html','csv','json'].includes(outputFormat)) {
      let content = fs.readFileSync(srcPath, 'utf8')
      // Simple conversions
      if (inputExt === 'md' && outputFormat === 'html') {
        content = content
          .replace(/^### (.*$)/gm, '<h3>$1</h3>')
          .replace(/^## (.*$)/gm, '<h2>$1</h2>')
          .replace(/^# (.*$)/gm, '<h1>$1</h1>')
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
          .replace(/\*(.*?)\*/g, '<em>$1</em>')
          .replace(/\n/g, '<br>\n')
        content = `<!DOCTYPE html><html><body>${content}</body></html>`
      } else if (inputExt === 'html' && outputFormat === 'txt') {
        content = content.replace(/<[^>]*>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
      } else if (inputExt === 'csv' && outputFormat === 'json') {
        const lines = content.split('\n').filter(l => l.trim())
        const headers = lines[0].split(',').map(h => h.trim())
        const rows = lines.slice(1).map(line => {
          const vals = line.split(',')
          const obj = {}
          headers.forEach((h, i) => obj[h] = (vals[i] || '').trim())
          return obj
        })
        content = JSON.stringify(rows, null, 2)
      } else if (inputExt === 'json' && outputFormat === 'csv') {
        const data = JSON.parse(content)
        if (Array.isArray(data) && data.length > 0) {
          const headers = Object.keys(data[0])
          const rows = data.map(row => headers.map(h => row[h] || '').join(','))
          content = [headers.join(','), ...rows].join('\n')
        }
      }
      fs.writeFileSync(outputPath, content)
      return { ok: true, path: outputPath, name: path.basename(outputPath) }
    }
    
    // Image conversion using canvas (Electron has canvas support)
    const imageExts = ['jpg','jpeg','png','gif','webp','bmp']
    if (imageExts.includes(inputExt) && imageExts.includes(outputFormat)) {
      // Use nativeImage from Electron
      const { nativeImage } = require('electron')
      const img = nativeImage.createFromPath(srcPath)
      let buffer
      if (outputFormat === 'png') buffer = img.toPNG()
      else if (outputFormat === 'jpg' || outputFormat === 'jpeg') buffer = img.toJPEG(90)
      else {
        // For other formats, save as PNG
        buffer = img.toPNG()
      }
      fs.writeFileSync(outputPath.replace(`.${outputFormat}`, '.'+outputFormat), buffer)
      return { ok: true, path: outputPath, name: path.basename(outputPath) }
    }
    
    return { ok: false, msg: `Conversion from ${inputExt} to ${outputFormat} not supported yet` }
  } catch(err) {
    return { ok: false, msg: err.message }
  }
})

ipcMain.handle('window-minimize', () => mainWindow.minimize())
ipcMain.handle('window-maximize', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize())
ipcMain.handle('window-close', () => mainWindow.close())
