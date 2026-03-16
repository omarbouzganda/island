// ── FREEISLE APP v2 ──
// FIX: uses window.freeisle (not window.island)
// FIX: chats stored on disk via IPC, NOT localStorage
// FIX: real network integration (Net.connect called with username)
// FIX: incoming messages properly received and rendered

let config = {}
let chats = {}
let activeChatId = null
let replyTo = null
let selfDestruct = false
let mediaRecorder = null
let audioChunks = []
let currentNoteId = null
let noteTimer = null
let convFilePath = null
let convSelectedFormat = null
let chatSaveTimer = null

// ── FORMAT MAP ──
const FORMAT_MAP = {
  jpg:  ['png','webp','bmp'], jpeg: ['png','webp','bmp'],
  png:  ['jpg','webp','bmp'], webp: ['jpg','png','bmp'],
  bmp:  ['jpg','png','webp'], gif:  ['png','jpg'],
  md:   ['html','txt'],       html: ['txt','md'],
  txt:  ['md','html'],        csv:  ['json'],
  json: ['csv','txt'],
}

// ── INIT ──
async function init() {
  config = await window.freeisle.getConfig()
  if (config.firstRun || !config.username) {
    document.getElementById('setup-page').classList.add('on')
    updateSetupId()
    return
  }
  startApp()
}

function startApp() {
  applyTheme(config.theme || 'dark-ocean')
  loadChatsFromDisk()
  updateMyId()
  setupDropZone()
  loadFiles()
  loadGallery()
  loadNotes()

  window.freeisle.onShowLock(show => {
    if (show) document.getElementById('lock').classList.add('on')
  })
  if (!config.pin) document.getElementById('lock').classList.remove('on')

  const sid = document.getElementById('sid-disp')
  if (sid) sid.textContent = config.userId

  // Vault mounted event
  window.freeisle.onVaultMounted(info => {
    const badge = document.getElementById('disk-badge')
    badge.textContent = `💾 Disk: ${info.drive ? info.drive + ':\\' : '/mnt/freeisle'}`
    badge.classList.add('show')
    badge.classList.remove('fail')
    notify('💾 Freeisle Disk', 'Virtual disk mounted — all data secured!', 'ns')
    toast('Freeisle disk is ready! 💾', 'ts')
  })
  // Vault failed
  window.freeisle.onVaultFailed(info => {
    const badge = document.getElementById('disk-badge')
    badge.textContent = '⚠️ Disk offline'
    badge.classList.add('show', 'fail')
    notify('⚠️ Disk Warning', info.msg || 'Virtual disk unavailable. Using local fallback.', 'nw')
  })

  setTimeout(() => notify('🏝️ Freeisle', 'Welcome back!', 'ns'), 800)
}

// ── SETUP ──
function updateSetupId() {
  const uname = document.getElementById('setup-username').value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  const num = document.getElementById('setup-custom-num').value.replace(/[^0-9]/g, '') || Math.floor(1000 + Math.random() * 9000).toString()
  const preview = document.getElementById('setup-id-preview')
  preview.textContent = uname.length < 2 ? 'type username above...' : `${uname}#${num}`
}

async function finishSetup() {
  const uname = document.getElementById('setup-username').value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  if (uname.length < 2) { toast('Username must be at least 2 characters', 'te'); return }
  const numRaw = document.getElementById('setup-custom-num').value.replace(/[^0-9]/g, '')
  const num = numRaw.length === 4 ? numRaw : Math.floor(1000 + Math.random() * 9000).toString()
  const userId = `${uname}#${num}`
  config = await window.freeisle.saveConfig({ userId, username: uname, firstRun: false })
  document.getElementById('setup-page').classList.remove('on')
  startApp()
  notify('🏝️ Welcome!', `Your Freeisle ID is ${userId}`, 'ns')
}

// ── LOCK ──
let pinEntry = ''
function pk(k) {
  if (k === 'del') pinEntry = pinEntry.slice(0, -1)
  else if (k === 'ok') checkPin()
  else if (pinEntry.length < 4) pinEntry += k
  updatePinDots()
  if (pinEntry.length === 4) setTimeout(checkPin, 150)
}
function updatePinDots() {
  for (let i = 0; i < 4; i++) document.getElementById('pd' + i).classList.toggle('on', i < pinEntry.length)
}
async function checkPin() {
  if (!pinEntry) return
  const r = await window.freeisle.verifyPin(pinEntry)
  pinEntry = ''; updatePinDots()
  if (r === 'ok' || r === 'fake') {
    document.getElementById('lock').classList.remove('on')
    document.getElementById('perr').textContent = ''
  } else {
    document.getElementById('perr').textContent = 'Wrong PIN'
    setTimeout(() => { document.getElementById('perr').textContent = '' }, 2000)
  }
}

// ── NAV ──
function nav(pageId, btn) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('on'))
  document.querySelectorAll('.nb').forEach(b => b.classList.remove('on'))
  const page = document.getElementById(pageId + '-page')
  if (page) page.classList.add('on')
  if (btn) btn.classList.add('on')
  if (pageId === 'storage') loadStorage()
  if (pageId === 'gallery') loadGallery()
  if (pageId === 'files') loadFiles()
  if (pageId === 'notes') loadNotes()
}

// ── THEME ──
function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme)
  const themes = ['dark-ocean', 'jungle', 'sandy', 'purple', 'midnight']
  document.querySelectorAll('.td').forEach((d, i) => d.classList.toggle('on', themes[i] === theme))
}
async function setTheme(theme, el) {
  applyTheme(theme)
  config = await window.freeisle.saveConfig({ theme })
  toast('Theme changed', 'ts')
}

// ── MY ID ──
function updateMyId() {
  const el = document.getElementById('myid')
  if (el) el.textContent = config.userId
  // Start network after ID is ready
  setupNetwork()
}
function copyId() {
  navigator.clipboard.writeText(config.userId)
  toast('ID copied: ' + config.userId, 'ts')
}
function copyBtc() {
  navigator.clipboard.writeText('bc1qex88c788lfmkhsp8djxzn5t5j8w4xq99e0mzf6')
  toast('BTC address copied!', 'ts')
}
async function copyVaultPath() {
  const p = await window.freeisle.getVaultPath()
  navigator.clipboard.writeText(p)
  toast('Vault path copied', 'ts')
}
async function openVault() {
  const p = await window.freeisle.getVaultPath()
  window.freeisle.openFile(p)
}

// ── CHANGE USERNAME ──
async function changeUsername() {
  const val = document.getElementById('newusername').value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  if (val.length < 2) { toast('Username too short', 'te'); return }
  const num = config.userId.split('#')[1] || '0000'
  const newId = `${val}#${num}`
  config = await window.freeisle.saveConfig({ userId: newId, username: val })
  updateMyId()
  document.getElementById('sid-disp').textContent = newId
  closeM('changeid')
  toast('ID updated: ' + newId, 'ts')
}

// ── CHAT STORAGE (FIX: on disk, not localStorage) ──
async function loadChatsFromDisk() {
  try {
    const data = await window.freeisle.loadChats()
    chats = (data && typeof data === 'object') ? data : {}
  } catch(e) { chats = {} }

  // Seed welcome chat if empty
  if (!Object.keys(chats).length) {
    chats['freeilseteam_0001'] = {
      id: 'freeilseteam#0001', name: 'Freeisle Team',
      messages: [
        { id: '1', from: 'freeilseteam#0001', text: 'Welcome to Freeisle! 🏝️', time: Date.now() - 3600000, type: 'text' },
        { id: '2', from: 'me', text: 'This is amazing!', time: Date.now() - 3000000, type: 'text' },
        { id: '3', from: 'freeilseteam#0001', text: 'Your data stays only on your disk. Always. 🔒', time: Date.now() - 1800000, type: 'text' },
      ],
      online: true, isGroup: false
    }
    await saveChatsToDisk()
  }
  renderChatList()
}

function scheduleChatSave() {
  clearTimeout(chatSaveTimer)
  chatSaveTimer = setTimeout(saveChatsToDisk, 500)
}

async function saveChatsToDisk() {
  try { await window.freeisle.saveChats(chats) } catch(e) {}
}

// ── RENDER CHAT LIST ──
function renderChatList(filter = '') {
  const el = document.getElementById('citems'); if (!el) return
  const entries = Object.entries(chats).filter(([k, c]) =>
    (c.name || '').toLowerCase().includes(filter.toLowerCase()) ||
    (c.id || '').toLowerCase().includes(filter.toLowerCase())
  )
  if (!entries.length) {
    el.innerHTML = '<div style="padding:24px;text-align:center;font-size:12px;color:var(--text3)">No chats yet.<br>Add a friend by their ID.</div>'
    return
  }
  el.innerHTML = entries.map(([key, c]) => {
    const last = c.messages && c.messages[c.messages.length - 1]
    const preview = last ? (last.type === 'voice' ? '🎙️ Voice' : last.type === 'file' ? '📎 ' + (last.fileName || 'File') : (last.text || '')) : 'No messages yet'
    const initial = (c.name || c.id || '?')[0].toUpperCase()
    const unread = c.unread || 0
    return `<div class="ci ${activeChatId === key ? 'on' : ''}" onclick="openChat('${key}')">
      <div class="cav">${initial}${c.online ? '<div class="cavdot"></div>' : ''}</div>
      <div class="cinf">
        <div class="cnm">${escHtml(c.name)}${c.isGroup ? '<span class="grpbdg">GROUP</span>' : ''}</div>
        <div class="cprev">${escHtml((preview + '').substring(0, 40))}</div>
      </div>
      <div class="cmeta">
        <span class="ctm">${last ? formatTime(last.time) : ''}</span>
        ${unread > 0 ? `<span class="cbdg">${unread}</span>` : ''}
      </div>
    </div>`
  }).join('')
}
function filterChats(v) { renderChatList(v) }

// ── OPEN CHAT ──
function openChat(key) {
  activeChatId = key
  const c = chats[key]; if (!c) return
  c.unread = 0
  document.getElementById('cempty').style.display = 'none'
  const ac = document.getElementById('achat')
  ac.style.display = 'flex'; ac.style.flexDirection = 'column'; ac.style.flex = '1'; ac.style.overflow = 'hidden'
  document.getElementById('ahav').textContent = (c.name || c.id || '?')[0].toUpperCase()
  document.getElementById('ahnm').textContent = c.name
  document.getElementById('ahid').textContent = c.isGroup ? `${(c.members || []).length} members` : c.id
  renderMessages(); renderChatList(); scheduleChatSave()
}

// ── RENDER MESSAGES ──
function renderMessages() {
  const c = chats[activeChatId]; if (!c) return
  const el = document.getElementById('msgs')
  if (!c.messages || !c.messages.length) {
    el.innerHTML = `<div class="sysmsg">Start of your conversation with ${escHtml(c.name)}. End-to-end encrypted 🔒</div>`
    return
  }
  el.innerHTML = c.messages.map(m => {
    const mine = m.from === 'me'
    let bubble = ''
    if (m.type === 'voice') bubble = `<div class="mb"><audio controls src="${m.src}" style="max-width:220px;height:34px;"></audio></div>`
    else if (m.type === 'file') bubble = `<div class="mb">📎 <span style="text-decoration:underline;cursor:pointer;">${escHtml(m.fileName || 'File')}</span></div>`
    else bubble = `<div class="mb">${m.replyTo ? `<div class="mrply">${escHtml(m.replyTo.substring(0, 60))}</div>` : ''}${escHtml(m.text)}</div>`
    return `<div class="msg ${mine ? 'sent' : 'recv'} ${m.selfDestruct ? 'sdmsg' : ''}" data-id="${m.id}">
      ${!mine && c.isGroup ? `<div class="msndr">${escHtml(m.from)}</div>` : ''}
      ${bubble}
      <div class="mtm">${formatTime(m.time)}${mine ? ' ✓' : ''}</div>
    </div>`
  }).join('')
  el.scrollTop = el.scrollHeight
}

function msgKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg() } }
function autoH(el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 120) + 'px' }

function sendMsg() {
  if (!activeChatId) return
  const input = document.getElementById('msgin')
  const text = input.value.trim(); if (!text) return
  const c = chats[activeChatId]
  const msg = { id: Date.now().toString(36) + Math.random().toString(36).slice(2), from: 'me', text, time: Date.now(), type: 'text', replyTo: replyTo ? replyTo.substring(0, 60) : null, selfDestruct }
  c.messages.push(msg)
  input.value = ''; input.style.height = 'auto'
  cancelReply(); renderMessages(); renderChatList(); scheduleChatSave()

  if (selfDestruct) {
    setTimeout(() => {
      if (chats[activeChatId]) {
        chats[activeChatId].messages = chats[activeChatId].messages.filter(m => m.id !== msg.id)
        renderMessages(); scheduleChatSave()
      }
    }, 10000)
  }

  // Send over network (FIX: use real Net with correct recipient ID)
  if (c.isGroup) {
    Net.sendGroupMsg(c.id, c.name, c.members || [], text)
  } else {
    const result = Net.sendMsg(c.id, text, { msgType: 'text', replyTo: msg.replyTo, selfDestruct })
    if (!result.sent) toast('Message queued — reconnecting...', 'tw')
  }
}

function cancelReply() { replyTo = null; document.getElementById('rbar').classList.remove('on') }
function toggleSD() {
  selfDestruct = !selfDestruct
  document.getElementById('sdbtn').classList.toggle('tbon', selfDestruct)
  document.getElementById('sdst').textContent = selfDestruct ? '10s' : 'Off'
}
function clearChat() {
  if (!activeChatId) return
  chats[activeChatId].messages = []; renderMessages(); scheduleChatSave(); toast('Chat cleared', 'ts')
}

// ── MODALS ──
function openM(id) { const el = document.getElementById('m-' + id); if (el) el.classList.add('on') }
function closeM(id) { const el = document.getElementById('m-' + id); if (el) el.classList.remove('on') }

function addChat() {
  const id = document.getElementById('fi-id').value.trim()
  const name = document.getElementById('fi-name').value.trim()
  if (!id) { toast('Enter an ID', 'te'); return }
  if (!id.includes('#')) { toast('Invalid ID — use name#1234', 'te'); return }
  const key = id.replace(/[#\s]/g, '_')
  chats[key] = { id, name: name || id, messages: [], online: false, isGroup: false }
  closeM('addchat')
  document.getElementById('fi-id').value = ''; document.getElementById('fi-name').value = ''
  renderChatList(); openChat(key); scheduleChatSave()
  toast(`Connected to ${id}`, 'ts')
  // Send friend request
  Net.sendFriendRequest(id)
}

function createGroup() {
  const name = document.getElementById('gi-name').value.trim()
  const membersRaw = document.getElementById('gi-members').value.trim()
  if (!name) { toast('Enter group name', 'te'); return }
  const members = membersRaw.split('\n').map(s => s.trim()).filter(Boolean)
  const key = 'grp_' + Date.now()
  chats[key] = { id: key, name, messages: [], online: false, isGroup: true, members }
  closeM('grp')
  document.getElementById('gi-name').value = ''; document.getElementById('gi-members').value = ''
  renderChatList(); openChat(key); scheduleChatSave()
  toast(`Group "${name}" created`, 'ts')
}

// ── PIN ──
async function savePin(type) {
  const field = type === 'fake' ? 'fakepinval' : 'pinval'
  const modalId = type === 'fake' ? 'fakepin' : 'pin'
  const val = document.getElementById(field).value.trim()
  if (val.length !== 4 || isNaN(val)) { toast('PIN must be 4 digits', 'te'); return }
  if (type === 'fake') config = await window.freeisle.saveConfig({ fakePin: val })
  else config = await window.freeisle.saveConfig({ pin: val })
  closeM(modalId); toast(type === 'fake' ? 'Fake PIN set' : 'PIN set', 'ts')
}
async function doWipe() {
  if (document.getElementById('wipeval').value.trim() !== 'DELETE') { toast('Type DELETE to confirm', 'te'); return }
  await window.freeisle.emergencyWipe()
}

// ── VOICE ──
async function startVoice() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    mediaRecorder = new MediaRecorder(stream); audioChunks = []
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data)
    mediaRecorder.onstop = saveVoiceMsg
    mediaRecorder.start()
    document.getElementById('recbar').classList.add('on')
    document.getElementById('vbtn').style.display = 'none'
  } catch(e) { toast('Microphone access denied', 'te') }
}
function stopVoice() {
  if (mediaRecorder) { mediaRecorder.stop(); mediaRecorder.stream.getTracks().forEach(t => t.stop()) }
  document.getElementById('recbar').classList.remove('on')
  document.getElementById('vbtn').style.display = ''
}
function saveVoiceMsg() {
  if (!activeChatId) return
  const blob = new Blob(audioChunks, { type: 'audio/webm' })
  const src = URL.createObjectURL(blob)
  chats[activeChatId].messages.push({ id: Date.now().toString(), from: 'me', type: 'voice', src, time: Date.now() })
  renderMessages(); scheduleChatSave(); toast('Voice message sent', 'ts')
}

async function sendFileInChat() {
  if (!activeChatId) return
  const paths = await window.freeisle.selectFiles()
  if (!paths || !paths.length) return
  for (const p of paths) {
    const name = p.split(/[/\\]/).pop()
    chats[activeChatId].messages.push({ id: Date.now().toString(), from: 'me', type: 'file', fileName: name, filePath: p, time: Date.now() })
  }
  renderMessages(); scheduleChatSave(); toast(`${paths.length} file(s) shared`, 'ts')
}

// ── DISCOVER ──
function searchDiscover(query) {
  const el = document.getElementById('disc-results'); if (!el) return
  const q = query.trim().toLowerCase()
  if (!q) { el.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:20px 0;">Type a username or ID to search</div>'; return }
  // Search in online users from relay
  const onlineUsers = Net.isAlive() ? [] : [] // Would come from relay in real DHT
  const results = []
  if (q.includes('#')) {
    results.push({ id: q, name: q.split('#')[0], online: false })
  }
  if (!results.length) {
    el.innerHTML = `<div style="color:var(--text3);font-size:13px;padding:20px 0;">No users found for "${escHtml(query)}".<br><br>If you know their ID, add them directly from Chat → + button.</div>`
    return
  }
  el.innerHTML = results.map(u => `
    <div class="disc-user">
      <div class="disc-av">${(u.name || u.id)[0].toUpperCase()}</div>
      <div class="disc-info">
        <div class="disc-name">${escHtml(u.name)}</div>
        <div class="disc-id">${escHtml(u.id)}</div>
        <div class="disc-status ${u.online ? 'online' : 'offline'}">${u.online ? '● Online' : '○ Offline'}</div>
      </div>
      <button class="btn btn-p" onclick="addFromDiscover('${u.id}','${u.name}')">Message</button>
    </div>`).join('')
}
function addFromDiscover(id, name) {
  const key = id.replace(/[#\s]/g, '_')
  if (!chats[key]) chats[key] = { id, name, messages: [], online: false, isGroup: false }
  scheduleChatSave()
  nav('chat', document.querySelector('.nb[onclick*="chat"]'))
  renderChatList(); openChat(key)
  toast(`Added ${id}`, 'ts')
}

// ── FILES ──
function setupDropZone() {
  const z = document.getElementById('dz'); if (!z) return
  z.addEventListener('dragover', e => { e.preventDefault(); z.classList.add('dov') })
  z.addEventListener('dragleave', () => z.classList.remove('dov'))
  z.addEventListener('drop', async e => {
    e.preventDefault(); z.classList.remove('dov')
    const files = Array.from(e.dataTransfer.files)
    for (const f of files) {
      const buf = await f.arrayBuffer()
      await window.freeisle.saveFile({ name: f.name, buffer: Array.from(new Uint8Array(buf)) })
    }
    loadFiles(); toast(`${files.length} file(s) added`, 'ts')
  })
}

async function pickFiles() {
  const paths = await window.freeisle.selectFiles()
  if (!paths || !paths.length) return
  let added = 0
  for (const srcPath of paths) {
    try { await window.freeisle.copyFileToVault({ srcPath, dest: 'files' }); added++ } catch(e) {}
  }
  loadFiles()
  if (added > 0) toast(`${added} file(s) added to vault`, 'ts')
}

async function loadFiles() {
  const files = await window.freeisle.getFiles()
  const el = document.getElementById('flist'); if (!el) return
  if (!files.length) { el.innerHTML = '<div class="empty" style="padding:40px 0;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><h3>No files yet</h3><p>Drop files above or click to browse</p></div>'; return }
  el.innerHTML = files.map(f => `
    <div class="fi">
      <div class="fic">${fileIcon(f.name)}</div>
      <div class="fif"><div class="fin">${escHtml(f.name)}</div><div class="fis">${fmtSize(f.size)} · ${new Date(f.modified).toLocaleDateString()}</div></div>
      <div class="fac">
        <button class="ib" onclick="window.freeisle.openFile('${f.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>
        <button class="ib" onclick="delFile('${escHtml(f.name)}')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
      </div>
    </div>`).join('')
}

async function delFile(name) {
  await window.freeisle.deleteFile(name); loadFiles(); toast('File deleted', 'ts')
}

// ── GALLERY ──
async function pickGallery() {
  const paths = await window.freeisle.selectFiles({ images: true })
  if (!paths || !paths.length) return
  let added = 0
  for (const srcPath of paths) {
    try { await window.freeisle.copyFileToVault({ srcPath, dest: 'gallery' }); added++ } catch(e) {}
  }
  loadGallery()
  if (added > 0) toast(`${added} media file(s) added`, 'ts')
}

async function loadGallery() {
  const items = await window.freeisle.getGallery()
  const grid = document.getElementById('ggrid'); if (!grid) return
  if (!items.length) {
    grid.innerHTML = '<div class="empty" style="padding:40px 0;"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/></svg><h3>No media yet</h3><p>Add photos and videos to your gallery</p></div>'
    return
  }
  grid.innerHTML = items.map(item => {
    const isVid = ['.mp4', '.webm', '.mov'].includes(item.ext)
    const fp = item.path.replace(/\\/g, '/')
    return `<div class="gi" onclick="window.freeisle.openFile('${item.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')">
      ${isVid ? `<video src="file:///${fp}" muted preload="metadata"></video>` : `<img src="file:///${fp}" alt="" loading="lazy">`}
      <div class="giov"><span>${escHtml(item.name)}</span></div>
    </div>`
  }).join('')
}

// ── NOTES ──
async function loadNotes() {
  const notes = await window.freeisle.getNotes()
  const el = document.getElementById('nitems'); if (!el) return
  if (!notes.length) { el.innerHTML = '<div style="padding:16px;font-size:12px;color:var(--text3)">No notes. Click + to create one.</div>'; return }
  el.innerHTML = notes.map(n => `
    <div class="ni ${currentNoteId === n.id ? 'on' : ''}" onclick="openNote('${n.id}','${encodeURIComponent(n.title || '')}','${encodeURIComponent(n.content || '')}')">
      <div class="nt">${escHtml(n.title || 'Untitled')}</div>
      <div class="np">${escHtml((n.content || '').substring(0, 55))}</div>
      <div class="nd">${new Date(n.updated).toLocaleDateString()}</div>
    </div>`).join('')
}
function newNote() {
  currentNoteId = 'note_' + Date.now()
  document.getElementById('ned').style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;'
  document.getElementById('nempty').style.display = 'none'
  document.getElementById('ntitle').value = ''
  document.getElementById('nbody').value = ''
  document.getElementById('ntitle').focus()
}
function openNote(id, title, content) {
  currentNoteId = id
  document.getElementById('ned').style.cssText = 'display:flex;flex-direction:column;flex:1;overflow:hidden;'
  document.getElementById('nempty').style.display = 'none'
  document.getElementById('ntitle').value = decodeURIComponent(title)
  document.getElementById('nbody').value = decodeURIComponent(content)
  loadNotes()
}
function autoSave() {
  clearTimeout(noteTimer)
  noteTimer = setTimeout(async () => {
    const title = document.getElementById('ntitle').value
    const content = document.getElementById('nbody').value
    await window.freeisle.saveNote({ id: currentNoteId, title, content })
    loadNotes()
  }, 700)
}

// ── STORAGE ──
async function loadStorage() {
  const stats = await window.freeisle.getDiskStats()
  const sg = document.getElementById('sgrid'); if (!sg) return
  sg.innerHTML = [
    { l: 'Vault Size', v: fmtSize(stats.vaultSize || 0), s: 'Total Freeisle data' },
    { l: 'Free RAM', v: fmtSize(stats.freeMem || 0), s: 'Available memory' },
    { l: 'Chats', v: fmtSize(stats.chatsSize || 0), s: 'Chat history on disk' },
    { l: 'Files', v: fmtSize(stats.filesSize || 0), s: 'Stored files' },
    { l: 'Gallery', v: fmtSize(stats.gallerySize || 0), s: 'Photos & videos' },
    { l: 'Voice', v: fmtSize(stats.voiceSize || 0), s: 'Voice messages' },
  ].map(c => `<div class="sc"><div class="slb">${c.l}</div><div class="svl">${c.v}</div><div class="ssb">${c.s}</div></div>`).join('')
  const bars = [
    { l: 'Chats', s: stats.chatsSize || 0, c: '#4f9eff' },
    { l: 'Files', s: stats.filesSize || 0, c: '#22d98a' },
    { l: 'Gallery', s: stats.gallerySize || 0, c: '#ffaa40' },
    { l: 'Voice', s: stats.voiceSize || 0, c: '#ff4f6e' },
  ]
  const maxS = Math.max(...bars.map(b => b.s), 1)
  document.getElementById('ubars').innerHTML = bars.map(b => `
    <div class="ubi">
      <div class="ubhd"><span class="ubl">${b.l}</span><span class="ubv">${fmtSize(b.s)}</span></div>
      <div class="ubtr"><div class="ubfl" style="width:${(b.s / maxS * 100).toFixed(1)}%;background:${b.c}"></div></div>
    </div>`).join('')
  const vp = document.getElementById('vpath')
  if (vp) vp.textContent = stats.vaultPath || 'Unknown'
}

// ── BRIDGE ──
async function scanParts() {
  toast('Scanning...', 'tw')
  const parts = await window.freeisle.detectDualBoot()
  const el = document.getElementById('partslist'); if (!el) return
  if (!parts.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:12px 0;">No partitions found.<br><span style="font-size:11px;">On Kali: this detects NTFS, exFAT, FAT32, and ext4 partitions. Make sure lsblk is installed.</span></div>'
    return
  }
  el.innerHTML = parts.map(p => `
    <div class="pcard ${p.isFreeisle ? 'freeisle-disk' : ''}">
      <div style="font-size:24px;">${p.isFreeisle ? '🏝️' : '💿'}</div>
      <div style="flex:1;">
        <div class="pcnm">/dev/${p.name} ${p.label ? '· ' + p.label : ''}</div>
        <div class="pcmt">${p.type} · ${p.size}${p.mount ? ' · Mounted at ' + p.mount : ''}${p.isFreeisle ? ' · <strong>Freeisle Disk</strong>' : ''}</div>
      </div>
      <button class="btn btn-p" onclick="mountPart('${p.name}')">${p.mount ? 'Browse' : 'Mount'}</button>
    </div>`).join('')
}

async function mountPart(name) {
  toast('Mounting...', 'tw')
  const r = await window.freeisle.mountPartition(name)
  if (r.ok) {
    toast(`Mounted at ${r.path}`, 'ts')
    notify('🌉 Dual Bridge', `Partition mounted at ${r.path}${r.hasFreeisle ? ' — Freeisle disk found!' : ''}`, 'ns')
  } else {
    toast('Failed: ' + r.msg, 'te')
  }
}

// ── NETWORK (FIX: real integration) ──
function setupNetwork() {
  if (!config.userId) return
  Net.connect(config.userId, config.username || config.userId)

  Net.on('connected', () => {
    setNetIndicator(true)
    toast('Connected to relay ✓', 'ts')
  })
  Net.on('disconnected', () => {
    setNetIndicator(false)
  })
  Net.on('registered', (data) => {
    // Flush any pending messages
  })
  Net.on('online_list', (data) => {
    // Mark online users
    const online = data.users || []
    Object.keys(chats).forEach(key => {
      const c = chats[key]
      if (!c.isGroup) {
        const wasOnline = c.online
        c.online = online.includes(c.id)
        if (c.online !== wasOnline) renderChatList()
      }
    })
  })
  Net.on('user_online', (data) => {
    Object.keys(chats).forEach(key => {
      if (chats[key].id === data.userId) { chats[key].online = true; renderChatList() }
    })
  })
  Net.on('user_offline', (data) => {
    Object.keys(chats).forEach(key => {
      if (chats[key].id === data.userId) { chats[key].online = false; renderChatList() }
    })
  })
  Net.on('msg', (data) => {
    // FIX: Find or create chat for incoming message
    const fromId = data.from
    let chatKey = Object.keys(chats).find(k => chats[k].id === fromId)
    if (!chatKey) {
      chatKey = fromId.replace(/[#\s]/g, '_')
      chats[chatKey] = { id: fromId, name: data.fromName || fromId, messages: [], online: true, isGroup: false }
    }
    const c = chats[chatKey]
    c.online = true
    // Avoid duplicates
    if (!c.messages.find(m => m.id === data.id)) {
      const msg = { id: data.id, from: fromId, text: data.text, time: data.ts || Date.now(), type: data.msgType || 'text', fileName: data.fileName, replyTo: data.replyTo, selfDestruct: data.selfDestruct }
      c.messages.push(msg)
      if (activeChatId !== chatKey) {
        c.unread = (c.unread || 0) + 1
        document.getElementById('cbdg').style.display = 'block'
        notify('💬 ' + (c.name || fromId), (data.text || '').substring(0, 60), 'nm')
      } else {
        renderMessages()
      }
      renderChatList()
      scheduleChatSave()
      if (data.selfDestruct) {
        setTimeout(() => {
          if (chats[chatKey]) { chats[chatKey].messages = chats[chatKey].messages.filter(m => m.id !== data.id); if (activeChatId === chatKey) renderMessages(); scheduleChatSave() }
        }, 10000)
      }
    }
  })
  Net.on('group_msg', (data) => {
    const groupId = data.groupId
    const chatKey = Object.keys(chats).find(k => chats[k].id === groupId || k === groupId)
    if (!chatKey) return
    const c = chats[chatKey]
    if (!c.messages.find(m => m.id === data.id)) {
      c.messages.push({ id: data.id, from: data.from, text: data.text, time: data.ts || Date.now(), type: 'text' })
      if (activeChatId !== chatKey) { c.unread = (c.unread || 0) + 1; document.getElementById('cbdg').style.display = 'block' }
      else renderMessages()
      renderChatList(); scheduleChatSave()
    }
  })
  Net.on('friend_request', (data) => {
    notify('👋 Friend Request', `${data.from} wants to connect`, 'nm')
    toast(`Friend request from ${data.from}`, 'ts')
    // Auto-add them to chat list
    const key = data.from.replace(/[#\s]/g, '_')
    if (!chats[key]) {
      chats[key] = { id: data.from, name: data.fromName || data.from, messages: [], online: true, isGroup: false }
      Net.acceptFriend(data.from)
      renderChatList(); scheduleChatSave()
    }
  })
  Net.on('friend_accepted', (data) => {
    const key = Object.keys(chats).find(k => chats[k].id === data.by)
    if (key) { chats[key].online = true; renderChatList() }
    notify('✅ Connected', `${data.byName || data.by} accepted your request`, 'ns')
  })
  Net.on('typing', (data) => {
    const key = Object.keys(chats).find(k => chats[k].id === data.from)
    if (key && activeChatId === key) {
      const el = document.getElementById('ahid')
      if (el) { const orig = el.textContent; el.textContent = 'typing...'; setTimeout(() => { el.textContent = orig }, 2000) }
    }
  })
}

function setNetIndicator(online) {
  const el = document.getElementById('net-indicator')
  if (!el) return
  el.className = 'netbdg ' + (online ? 'on' : 'off')
  el.textContent = online ? '● online' : '● offline'
}

// ── NOTIFICATIONS ──
function notify(title, text, type = 'nm') {
  const el = document.createElement('div')
  el.className = 'notif ' + type
  const icons = { ns: '✅', ne: '❌', nm: '💬', nw: '⚠️' }
  el.innerHTML = `<div class="nic">${icons[type] || '🔔'}</div><div class="nib"><div class="nit">${escHtml(title)}</div><div class="nitx">${escHtml(text)}</div><div class="nitm">Just now</div></div>`
  el.onclick = () => { el.classList.add('nout'); setTimeout(() => el.remove(), 350) }
  document.getElementById('nstack').appendChild(el)
  setTimeout(() => { el.classList.add('nout'); setTimeout(() => el.remove(), 350) }, 5000)
}

function toast(msg, type = '') {
  const el = document.getElementById('toast')
  el.textContent = msg; el.className = 'toast on ' + (type || '')
  clearTimeout(el._t)
  el._t = setTimeout(() => el.classList.remove('on'), 3000)
}

// ── CONVERTER ──
async function pickConvertFile() {
  const paths = await window.freeisle.selectFiles()
  if (!paths || !paths.length) return
  const filePath = paths[0]
  const name = filePath.split(/[/\\]/).pop()
  const ext = name.split('.').pop().toLowerCase()
  const formats = FORMAT_MAP[ext]
  if (!formats) { toast(`.${ext} not supported for conversion`, 'te'); return }
  convFilePath = filePath; convSelectedFormat = null
  document.getElementById('conv-selected').style.display = 'block'
  document.getElementById('conv-result').style.display = 'none'
  document.getElementById('conv-filename').textContent = name
  document.getElementById('conv-icon').textContent = fileIcon(name)
  document.getElementById('conv-formats').innerHTML = formats.map(f => `<button onclick="selectConvFormat('${f}',this)" style="padding:10px 20px;border-radius:10px;background:var(--bg3);border:2px solid var(--border);color:var(--text2);font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer;transition:all 0.2s;">.${f.toUpperCase()}</button>`).join('')
}
function selectConvFormat(fmt, btn) {
  convSelectedFormat = fmt
  document.querySelectorAll('#conv-formats button').forEach(b => { b.style.background='var(--bg3)'; b.style.borderColor='var(--border)'; b.style.color='var(--text2)' })
  btn.style.background='var(--glow)'; btn.style.borderColor='var(--accent)'; btn.style.color='var(--accent)'
  document.getElementById('conv-btn').style.display = 'block'
}
async function doConvert() {
  if (!convFilePath || !convSelectedFormat) return
  const btn = document.getElementById('conv-btn')
  btn.textContent = 'Converting...'; btn.disabled = true
  const result = await window.freeisle.convertFile({ srcPath: convFilePath, outputFormat: convSelectedFormat })
  btn.textContent = 'Convert Now'; btn.disabled = false
  if (result.ok) {
    document.getElementById('conv-result').style.display = 'block'
    document.getElementById('conv-result-name').textContent = `Saved to vault: ${result.name}`
    document.getElementById('conv-open-btn').onclick = () => window.freeisle.openFile(result.path)
    toast('Conversion complete! ✅', 'ts')
  } else toast('Conversion failed: ' + result.msg, 'te')
}
function clearConverter() {
  convFilePath = null; convSelectedFormat = null
  document.getElementById('conv-selected').style.display = 'none'
  document.getElementById('conv-result').style.display = 'none'
}
document.addEventListener('DOMContentLoaded', () => {
  const drop = document.getElementById('conv-drop'); if (!drop) return
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.borderColor='var(--accent)' })
  drop.addEventListener('dragleave', () => { drop.style.borderColor='var(--border2)' })
  drop.addEventListener('drop', async e => {
    e.preventDefault(); drop.style.borderColor='var(--border2)'
    const file = e.dataTransfer.files[0]; if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (!FORMAT_MAP[ext]) { toast(`.${ext} not supported`, 'te'); return }
    const buf = await file.arrayBuffer()
    await window.freeisle.saveFile({ name: file.name, buffer: Array.from(new Uint8Array(buf)) })
    const files = await window.freeisle.getFiles()
    const saved = files.find(f => f.name === file.name)
    if (saved) {
      convFilePath = saved.path
      document.getElementById('conv-selected').style.display = 'block'
      document.getElementById('conv-filename').textContent = file.name
      document.getElementById('conv-icon').textContent = fileIcon(file.name)
      document.getElementById('conv-formats').innerHTML = FORMAT_MAP[ext].map(f => `<button onclick="selectConvFormat('${f}',this)" style="padding:10px 20px;border-radius:10px;background:var(--bg3);border:2px solid var(--border);color:var(--text2);font-family:var(--font);font-size:13px;font-weight:600;cursor:pointer;">.${f.toUpperCase()}</button>`).join('')
      document.getElementById('conv-result').style.display = 'none'
    }
  })
})

// ── UTILS ──
function formatTime(ts) {
  const d = new Date(ts), now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
function fmtSize(b) {
  if (!b) return '0 B'
  const k = 1024, s = ['B', 'KB', 'MB', 'GB'], i = Math.floor(Math.log(b) / Math.log(k))
  return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i]
}
function fileIcon(name) {
  const ext = name.split('.').pop().toLowerCase()
  return { pdf:'📄',doc:'📝',docx:'📝',xls:'📊',xlsx:'📊',zip:'🗜️',rar:'🗜️',jpg:'🖼️',jpeg:'🖼️',png:'🖼️',gif:'🖼️',webp:'🖼️',mp4:'🎬',mkv:'🎬',mp3:'🎵',wav:'🎵',exe:'⚙️',sh:'⚙️',py:'🐍',js:'📜',html:'🌐',css:'🎨',txt:'📃',json:'📋',md:'📝',csv:'📊' }[ext] || '📄'
}
function escHtml(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\n/g,'<br>')
}

init()
