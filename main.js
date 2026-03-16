// ── FREEISLE MAIN v2 ──
// KEY FIXES:
// 1. Data stored in %APPDATA%/Freeisle (Windows) or ~/.config/Freeisle (Linux) — PERMANENT
// 2. NSIS installer → Next→Next→Finish, shortcut on desktop, stays installed
// 3. Virtual disk auto-mounts on every launch with diskpart/loop
// 4. Chat data stored on disk (not localStorage)
// 5. AppImage works on Kali with single click (no terminal needed)
// 6. ws module bundled inside asar — no missing dependency
// 7. Watchdog remounts disk if lost after sleep/reboot

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path   = require('path')
const fs     = require('fs')
const os     = require('os')
const cp     = require('child_process')

// ── CRITICAL: Force permanent data path for portable EXE ──
// Portable electron apps default to a temp/side-by-side folder.
// We override userData to %APPDATA%\Freeisle BEFORE anything else runs.
// This means data ALWAYS survives closing the app.
if (process.platform === 'win32') {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  app.setPath('userData', path.join(appData, 'Freeisle'))
} else if (process.platform === 'linux') {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  app.setPath('userData', path.join(configHome, 'Freeisle'))
}

// ── CONSTANTS ──
const DISK_LABEL   = 'FREEISLE'
const VHD_SIZE_MB  = 4096   // 4 GB expandable
const LINUX_MOUNT  = '/mnt/freeisle'
const WIN_DRIVES   = ['F','G','H','I','J','K','L','M']

// ── PATHS (permanent — app.getPath('userData') = %APPDATA%\Freeisle on Windows) ──
// These paths are set AFTER app is ready
let USER_DATA    = ''
let CONFIG_FILE  = ''
let CHAT_FILE    = ''
let WIN_VHD      = ''
let LINUX_IMG    = ''

let mainWindow       = null
let vaultPath        = ''      // where all user data lives
let diskMounted      = false
let diskDriveLetter  = null    // Windows only
let watchdogTimer    = null

// ── INIT PATHS (called once app is ready) ──
function initPaths() {
  USER_DATA   = app.getPath('userData')          // e.g. C:\Users\omar\AppData\Roaming\Freeisle
  CONFIG_FILE = path.join(USER_DATA, 'config.json')
  CHAT_FILE   = path.join(USER_DATA, 'chats.json')
  WIN_VHD     = path.join(USER_DATA, 'Freeisle.vhd')
  LINUX_IMG   = path.join(USER_DATA, 'Freeisle.img')
  vaultPath   = path.join(USER_DATA, 'vault')    // fallback vault (always works)
  if (!fs.existsSync(USER_DATA)) fs.mkdirSync(USER_DATA, { recursive: true })
  ensureDirs(vaultPath)
}

// ── ENSURE VAULT DIRECTORIES ──
function ensureDirs(base) {
  ['', 'files', 'gallery', 'notes', 'voice', 'converted', 'chats'].forEach(d => {
    const p = d ? path.join(base, d) : base
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
  })
}

// ══════════════════════════════════════════
// CONFIG — always in USER_DATA (permanent)
// ══════════════════════════════════════════
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    const adj  = ['free','wild','silent','brave','dark','azure','storm','echo','swift','calm','rebel','ghost']
    const noun = ['isle','wave','shore','reef','palm','tide','mist','cove','sail','bay','dock','atoll']
    const id   = `${adj[Math.floor(Math.random()*adj.length)]}${noun[Math.floor(Math.random()*noun.length)]}#${Math.floor(1000+Math.random()*9000)}`
    const cfg  = { userId: id, username: '', theme: 'dark-ocean', pin: null, fakePin: null, firstRun: true }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2))
    return cfg
  }
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) } catch(e) { return { userId:'user#0000', theme:'dark-ocean', firstRun:false } }
}

function saveConfigFile(data) {
  const cur = loadConfig()
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...cur, ...data }, null, 2))
}

// ══════════════════════════════════════════
// CHAT STORAGE — on disk, NOT localStorage
// ══════════════════════════════════════════
function chatsFile() {
  // prefer vault location (shared disk), fall back to userData
  const vf = path.join(vaultPath, 'chats', 'chats.json')
  if (diskMounted && fs.existsSync(path.dirname(vf))) return vf
  return CHAT_FILE
}
function loadChats() {
  const f = chatsFile()
  if (!fs.existsSync(f)) return {}
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch(e) { return {} }
}
function saveChats(data) {
  const json = JSON.stringify(data, null, 2)
  // Write to both locations so data survives even if disk isn't mounted
  try { fs.writeFileSync(CHAT_FILE, json) } catch(e) {}
  if (diskMounted) {
    const dir = path.join(vaultPath, 'chats')
    try { if (!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true}); fs.writeFileSync(path.join(dir,'chats.json'), json) } catch(e) {}
  }
}

// ══════════════════════════════════════════
// WINDOWS — VIRTUAL DISK (VHD via diskpart)
// ══════════════════════════════════════════
function createVHDWindows() {
  try {
    const tmp = path.join(os.tmpdir(), 'freeisle_disk.txt')

    // 1. Check if Freeisle disk already mounted (label check)
    for (const d of WIN_DRIVES) {
      try {
        const out = cp.execSync(`vol ${d}:`, { stdio:'pipe', timeout:3000 }).toString()
        if (out.toUpperCase().includes(DISK_LABEL)) {
          return setWinVault(d)
        }
      } catch(e) {}
    }

    // 2. Try to attach existing VHD
    if (fs.existsSync(WIN_VHD)) {
      for (const d of WIN_DRIVES) {
        if (!driveExists(d)) {
          const s = `select vdisk file="${WIN_VHD}"\nattach vdisk\nassign letter=${d}`
          fs.writeFileSync(tmp, s)
          try {
            cp.execSync(`diskpart /s "${tmp}"`, { timeout:30000, stdio:'ignore' })
            if (driveExists(d)) return setWinVault(d)
          } catch(e) {}
          break
        }
      }
    }

    // 3. Create new VHD
    for (const d of WIN_DRIVES) {
      if (!driveExists(d)) {
        const s = [
          `create vdisk file="${WIN_VHD}" maximum=${VHD_SIZE_MB} type=expandable`,
          `select vdisk file="${WIN_VHD}"`,
          `attach vdisk`,
          `create partition primary`,
          `format fs=exfat label=${DISK_LABEL} quick`,
          `assign letter=${d}`
        ].join('\n')
        fs.writeFileSync(tmp, s)
        try {
          cp.execSync(`diskpart /s "${tmp}"`, { timeout:90000, stdio:'ignore' })
          if (driveExists(d)) {
            // Write marker file so Kali can identify this as Freeisle disk
            try { fs.writeFileSync(path.join(`${d}:\\`, 'FREEISLE_DISK'), JSON.stringify({ v:'1.1', os:'windows', ts: Date.now() })) } catch(e) {}
            return setWinVault(d)
          }
        } catch(e) { console.log('VHD create error:', e.message) }
        break
      }
    }
  } catch(e) { console.log('VHD fatal:', e.message) }

  // Fallback — use permanent userData folder (data still persists between sessions!)
  console.log('VHD unavailable — using userData vault (data is still permanent)')
  sendVaultFailed('Virtual disk unavailable. Data saved permanently in AppData\\Freeisle instead.')
  return false
}

function driveExists(letter) {
  try { fs.accessSync(`${letter}:\\`); return true } catch(e) { return false }
}
function setWinVault(drive) {
  vaultPath = path.join(`${drive}:\\`, 'Freeisle')
  diskMounted = true
  diskDriveLetter = drive
  ensureDirs(vaultPath)
  sendVaultMounted()
  return true
}

// ══════════════════════════════════════════
// LINUX — LOOP DEVICE (img file)
// ══════════════════════════════════════════
function createLoopLinux() {
  try {
    // 1. Already mounted?
    try {
      const mounts = fs.readFileSync('/proc/mounts', 'utf8')
      if (mounts.includes(LINUX_MOUNT)) {
        return setLinuxVault()
      }
    } catch(e) {}

    // 2. Create mount point
    ensureDir(LINUX_MOUNT)

    // 3. Create img if missing
    if (!fs.existsSync(LINUX_IMG)) {
      try {
        cp.execSync(`dd if=/dev/zero of="${LINUX_IMG}" bs=1M count=${VHD_SIZE_MB}`, { timeout:180000 })
        cp.execSync(`mkfs.exfat -n ${DISK_LABEL} "${LINUX_IMG}"`)
      } catch(e) {
        // mkfs.exfat might not be installed — try mkfs.vfat fallback
        try { cp.execSync(`mkfs.vfat -n ${DISK_LABEL} "${LINUX_IMG}"`) } catch(e2) {}
      }
    }

    // 4. Mount — try pkexec first, then sudo, then direct (if already root)
    const uid = process.getuid ? process.getuid() : 1000
    const gid = process.getgid ? process.getgid() : 1000
    const mountCmd = `mount -o loop,uid=${uid},gid=${gid} "${LINUX_IMG}" ${LINUX_MOUNT}`
    let mounted = false
    for (const prefix of ['', 'pkexec ', 'sudo ']) {
      try {
        cp.execSync(prefix + mountCmd, { timeout:20000 })
        mounted = true
        break
      } catch(e) {}
    }

    // 5. Verify
    const mounts2 = fs.existsSync('/proc/mounts') ? fs.readFileSync('/proc/mounts','utf8') : ''
    if (mounted || mounts2.includes(LINUX_MOUNT)) {
      try { fs.writeFileSync(path.join(LINUX_MOUNT, 'FREEISLE_DISK'), JSON.stringify({ v:'1.1', os:'linux', ts:Date.now() })) } catch(e) {}
      return setLinuxVault()
    }
  } catch(e) { console.log('Linux disk error:', e.message) }

  console.log('Loop device unavailable — using userData vault (data still permanent)')
  sendVaultFailed('Virtual disk unavailable. Run: sudo mount -o loop Freeisle.img /mnt/freeisle\nData is saved permanently in ~/.config/Freeisle instead.')
  return false
}

function ensureDir(p) {
  if (!fs.existsSync(p)) {
    try { cp.execSync(`pkexec mkdir -p "${p}"`, { timeout:8000 }) } catch(e) {
      try { cp.execSync(`sudo mkdir -p "${p}"`, { timeout:8000 }) } catch(e2) {
        try { fs.mkdirSync(p, { recursive:true }) } catch(e3) {}
      }
    }
  }
}
function setLinuxVault() {
  vaultPath = path.join(LINUX_MOUNT, 'Freeisle')
  diskMounted = true
  ensureDirs(vaultPath)
  sendVaultMounted()
  return true
}

// ══════════════════════════════════════════
// DISK EVENTS → renderer
// ══════════════════════════════════════════
function sendVaultMounted() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('vault-mounted', {
    path: vaultPath,
    drive: diskDriveLetter,
    mounted: true,
    platform: process.platform
  })
}
function sendVaultFailed(msg) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('vault-failed', { msg, fallback: vaultPath })
}

async function createVirtualDisk() {
  if (process.platform === 'win32')  return createVHDWindows()
  if (process.platform === 'linux')  return createLoopLinux()
  return false
}

// ══════════════════════════════════════════
// WATCHDOG — remount if disk lost after sleep
// ══════════════════════════════════════════
function startWatchdog() {
  if (watchdogTimer) clearInterval(watchdogTimer)
  watchdogTimer = setInterval(() => {
    if (!diskMounted) return
    try {
      if (process.platform === 'linux') {
        const m = fs.readFileSync('/proc/mounts','utf8')
        if (!m.includes(LINUX_MOUNT)) { diskMounted=false; console.log('Disk lost, remounting...'); createLoopLinux() }
      } else if (process.platform === 'win32' && diskDriveLetter) {
        if (!driveExists(diskDriveLetter)) { diskMounted=false; console.log('VHD lost, reattaching...'); createVHDWindows() }
      }
    } catch(e) {}
  }, 12000)
}

// ══════════════════════════════════════════
// WINDOW
// ══════════════════════════════════════════
function createWindow() {
  initPaths()
  const config = loadConfig()

  mainWindow = new BrowserWindow({
    width: 1300, height: 840, minWidth: 1000, minHeight: 680,
    frame: false,
    backgroundColor: '#060b18',
    title: 'Freeisle',
    icon: path.join(__dirname, 'assets', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    },
    show: false
  })

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'))

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    mainWindow.webContents.send('show-lock', !!config.pin)
    // Mount disk after UI visible
    setTimeout(() => {
      createVirtualDisk().then(() => startWatchdog())
    }, 1200)
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (watchdogTimer) clearInterval(watchdogTimer)
  // Clean unmount on Linux
  if (process.platform === 'linux' && diskMounted) {
    try { cp.execSync(`umount ${LINUX_MOUNT}`, { timeout:5000 }) } catch(e) {}
  }
  if (process.platform !== 'darwin') app.quit()
})

// ══════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════
function getDirSize(dir) {
  let s = 0
  try { fs.readdirSync(dir).forEach(f => { const fp=path.join(dir,f), st=fs.statSync(fp); s += st.isDirectory()?getDirSize(fp):st.size }) } catch(e) {}
  return s
}

// ══════════════════════════════════════════
// IPC
// ══════════════════════════════════════════
ipcMain.handle('get-config', () => loadConfig())
ipcMain.handle('save-config', (e, u) => { saveConfigFile(u); return loadConfig() })
ipcMain.handle('verify-pin', (e, pin) => {
  const c = loadConfig()
  if (c.fakePin && pin === c.fakePin) return 'fake'
  if (pin === c.pin) return 'ok'
  return 'wrong'
})
ipcMain.handle('get-vault-info', () => ({ path:vaultPath, isVirtualDisk:diskMounted, mounted:diskMounted, drive:diskDriveLetter, platform:process.platform }))
ipcMain.handle('get-disk-stats', () => {
  try {
    const fs2 = getDirSize(path.join(vaultPath,'files'))
    const gs  = getDirSize(path.join(vaultPath,'gallery'))
    const vs  = getDirSize(path.join(vaultPath,'voice'))
    const cs  = getDirSize(path.join(vaultPath,'chats'))
    const tot = getDirSize(vaultPath)
    return { vaultSize:tot, filesSize:fs2, gallerySize:gs, voiceSize:vs, chatsSize:cs, freeMem:os.freemem(), totalMem:os.totalmem(), vaultPath, isVirtualDisk:diskMounted }
  } catch(e) { return { vaultSize:0, filesSize:0, gallerySize:0, voiceSize:0, chatsSize:0, freeMem:0, totalMem:0, vaultPath, isVirtualDisk:false } }
})

// Chats on disk
ipcMain.handle('load-chats', () => loadChats())
ipcMain.handle('save-chats', (e, data) => { saveChats(data); return true })

// Notes
ipcMain.handle('save-note', (e, { id, title, content }) => {
  const dir = path.join(vaultPath,'notes')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir,{recursive:true})
  fs.writeFileSync(path.join(dir,`${id}.json`), JSON.stringify({id,title,content,updated:Date.now()}))
  return true
})
ipcMain.handle('get-notes', () => {
  const dir = path.join(vaultPath,'notes')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f=>f.endsWith('.json'))
    .map(f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')))
    .sort((a,b)=>b.updated-a.updated)
})
ipcMain.handle('delete-note', (e,id) => { const p=path.join(vaultPath,'notes',`${id}.json`); if(fs.existsSync(p))fs.unlinkSync(p); return true })

// Files
ipcMain.handle('save-file', (e,{name,buffer}) => {
  const dir=path.join(vaultPath,'files'); if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true})
  const dest=path.join(dir,name); fs.writeFileSync(dest,Buffer.from(buffer)); return dest
})
ipcMain.handle('get-files', () => {
  const dir=path.join(vaultPath,'files'); if(!fs.existsSync(dir))return []
  return fs.readdirSync(dir).map(f=>{const fp=path.join(dir,f),s=fs.statSync(fp);return{name:f,size:s.size,modified:s.mtimeMs,path:fp}}).sort((a,b)=>b.modified-a.modified)
})
ipcMain.handle('open-file', (e,fp) => shell.openPath(fp))
ipcMain.handle('delete-file', (e,name) => { const fp=path.join(vaultPath,'files',name); if(fs.existsSync(fp))fs.unlinkSync(fp); return true })
ipcMain.handle('get-gallery', () => {
  const dir=path.join(vaultPath,'gallery'); if(!fs.existsSync(dir))return []
  const exts=['.jpg','.jpeg','.png','.gif','.webp','.mp4','.webm','.mov']
  return fs.readdirSync(dir).filter(f=>exts.includes(path.extname(f).toLowerCase()))
    .map(f=>{const fp=path.join(dir,f),s=fs.statSync(fp);return{name:f,size:s.size,path:fp,ext:path.extname(f).toLowerCase()}})
})
ipcMain.handle('save-gallery-file', (e,{name,buffer}) => {
  const dir=path.join(vaultPath,'gallery'); if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true})
  const dest=path.join(dir,name); fs.writeFileSync(dest,Buffer.from(buffer)); return dest
})
ipcMain.handle('copy-file-to-vault', async (e,{srcPath,dest}) => {
  const destDir=path.join(vaultPath,dest); if(!fs.existsSync(destDir))fs.mkdirSync(destDir,{recursive:true})
  const name=path.basename(srcPath); let fn=name,c=1
  while(fs.existsSync(path.join(destDir,fn))){const ext=path.extname(name);fn=`${path.basename(name,ext)}_${c}${ext}`;c++}
  const dp=path.join(destDir,fn); fs.copyFileSync(srcPath,dp); return{name:fn,path:dp,size:fs.statSync(dp).size}
})

// Emergency wipe — deletes EVERYTHING including the disk image
ipcMain.handle('emergency-wipe', () => {
  try { fs.rmSync(vaultPath, { recursive:true, force:true }) } catch(e) {}
  try { fs.rmSync(USER_DATA,  { recursive:true, force:true }) } catch(e) {}
  try { if (process.platform==='win32' && fs.existsSync(WIN_VHD))   fs.unlinkSync(WIN_VHD) } catch(e) {}
  try { if (process.platform==='linux' && fs.existsSync(LINUX_IMG)) fs.unlinkSync(LINUX_IMG) } catch(e) {}
  try { if (process.platform==='linux') cp.execSync(`umount ${LINUX_MOUNT}`,{timeout:3000}) } catch(e) {}
  app.quit()
})

// Dual Boot Bridge
ipcMain.handle('detect-dual-boot', () => {
  const parts = []
  if (process.platform === 'linux') {
    try {
      const raw  = cp.execSync('lsblk -o NAME,FSTYPE,SIZE,MOUNTPOINT,LABEL -J 2>/dev/null').toString()
      const data = JSON.parse(raw)
      const walk = devs => { for (const d of (devs||[])) { const ft=(d.fstype||'').toLowerCase(); if(['ntfs','exfat','vfat','fat32','ext4'].includes(ft)) parts.push({name:d.name,type:d.fstype,size:d.size,mount:d.mountpoint,label:d.label||'',isFreeisle:(d.label||'').toUpperCase().includes(DISK_LABEL)}); walk(d.children) } }
      walk(data.blockdevices)
    } catch(e) {}
  } else if (process.platform === 'win32') {
    try {
      const out = cp.execSync('wmic logicaldisk get DeviceID,VolumeName,FileSystem /value',{stdio:'pipe'}).toString()
      out.split('\r\r\n\r\r\n').forEach(entry => {
        const dev  = (entry.match(/DeviceID=(.*)/)||[])[1]?.trim()
        const vol  = (entry.match(/VolumeName=(.*)/)||[])[1]?.trim()
        const fst  = (entry.match(/FileSystem=(.*)/)||[])[1]?.trim()
        if (dev && fst) parts.push({name:dev,label:vol||'',type:fst,mount:dev+'\\',isFreeisle:(vol||'').toUpperCase().includes(DISK_LABEL)})
      })
    } catch(e) {}
  }
  return parts
})

ipcMain.handle('mount-partition', async (e, name) => {
  if (process.platform !== 'linux') return { ok:false, msg:'Linux only' }
  try {
    const mp = `/mnt/freeisle-bridge-${name}`
    try { fs.mkdirSync(mp,{recursive:true}) } catch(e) {}
    let ok = false
    for (const pre of ['pkexec ','sudo ','']) {
      try { cp.execSync(`${pre}mount /dev/${name} ${mp}`, {timeout:15000}); ok=true; break } catch(e) {}
    }
    if (!ok) return { ok:false, msg:`Could not mount. Try: sudo mount /dev/${name} ${mp}` }
    const hasFreeisle = fs.existsSync(path.join(mp,'FREEISLE_DISK'))
    return { ok:true, path:mp, hasFreeisle }
  } catch(e) { return { ok:false, msg:e.message } }
})

ipcMain.handle('select-files', async (e, opts) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile','multiSelections'],
    filters: opts?.images ? [{name:'Media',extensions:['jpg','jpeg','png','gif','webp','mp4','webm','mov']}] : []
  })
  return r.filePaths
})
ipcMain.handle('get-vault-path', () => vaultPath)

// File converter
ipcMain.handle('convert-file', async (e, { srcPath, outputFormat }) => {
  const outDir  = path.join(vaultPath,'converted'); if(!fs.existsSync(outDir))fs.mkdirSync(outDir,{recursive:true})
  const inName  = path.basename(srcPath, path.extname(srcPath))
  const outPath = path.join(outDir, `${inName}_converted.${outputFormat}`)
  const inExt   = path.extname(srcPath).toLowerCase().replace('.','')
  try {
    if (['txt','md','html','csv','json'].includes(inExt) && ['txt','md','html','csv','json'].includes(outputFormat)) {
      let c = fs.readFileSync(srcPath,'utf8')
      if (inExt==='md'&&outputFormat==='html') { c=c.replace(/^### (.*$)/gm,'<h3>$1</h3>').replace(/^## (.*$)/gm,'<h2>$1</h2>').replace(/^# (.*$)/gm,'<h1>$1</h1>').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\*(.*?)\*/g,'<em>$1</em>').replace(/\n/g,'<br>'); c=`<!DOCTYPE html><html><body>${c}</body></html>` }
      else if (inExt==='html'&&outputFormat==='txt') c=c.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
      else if (inExt==='csv'&&outputFormat==='json') { const lines=c.split('\n').filter(l=>l.trim()); const hdr=lines[0].split(',').map(h=>h.trim()); c=JSON.stringify(lines.slice(1).map(l=>{const v=l.split(',');const o={};hdr.forEach((h,i)=>o[h]=(v[i]||'').trim());return o}),null,2) }
      else if (inExt==='json'&&outputFormat==='csv') { const d=JSON.parse(c);if(Array.isArray(d)&&d.length>0){const h=Object.keys(d[0]);c=[h.join(','),...d.map(r=>h.map(k=>r[k]||'').join(','))].join('\n')} }
      fs.writeFileSync(outPath,c); return{ok:true,path:outPath,name:path.basename(outPath)}
    }
    const imgE=['jpg','jpeg','png','gif','webp','bmp']
    if (imgE.includes(inExt)&&imgE.includes(outputFormat)) {
      const {nativeImage}=require('electron'); const img=nativeImage.createFromPath(srcPath)
      const buf=(outputFormat==='jpg'||outputFormat==='jpeg')?img.toJPEG(90):img.toPNG()
      fs.writeFileSync(outPath,buf); return{ok:true,path:outPath,name:path.basename(outPath)}
    }
    return{ok:false,msg:`${inExt} → ${outputFormat} not supported`}
  } catch(err){return{ok:false,msg:err.message}}
})

// Window controls
ipcMain.handle('window-minimize', () => mainWindow?.minimize())
ipcMain.handle('window-maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize())
ipcMain.handle('window-close',    () => mainWindow?.close())
