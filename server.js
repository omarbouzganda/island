// ── ISLAND RELAY — No database, no storage, pure message relay ──
const http = require('http')
const WebSocket = require('ws')
const PORT = process.env.PORT || 3000

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ name:'Island Relay', status:'online', users:Object.keys(users).length, note:'No database. No storage. Messages pass through RAM only.' }))
})

const wss = new WebSocket.Server({ server })
const users = {}
const pending = {}
const friendReqs = {}

function to(id, data) {
  const ws = users[id]
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(data)); return true } catch(e) {}
  }
  return false
}

function queue(id, data) {
  if (!pending[id]) pending[id] = []
  pending[id].push(data)
  if (pending[id].length > 150) pending[id].shift()
}

wss.on('connection', ws => {
  let id = null

  ws.on('message', raw => {
    let msg
    try { msg = JSON.parse(raw.toString()) } catch(e) { return }

    if (msg.type === 'register') {
      id = msg.userId
      if (!id) return
      users[id] = ws
      ws.send(JSON.stringify({ type:'registered', userId:id, online:Object.keys(users).length }))
      if (pending[id]) { pending[id].forEach(m => { try { ws.send(JSON.stringify(m)) } catch(e) {} }); delete pending[id] }
      if (friendReqs[id]) { friendReqs[id].forEach(r => { try { ws.send(JSON.stringify(r)) } catch(e) {} }); delete friendReqs[id] }
      ws.send(JSON.stringify({ type:'online_list', users:Object.keys(users) }))
      Object.keys(users).forEach(uid => { if (uid !== id) to(uid, { type:'user_online', userId:id }) })
      return
    }

    if (!id) return

    if (msg.type === 'friend_request') {
      const req = { type:'friend_request', from:id, fromName:msg.fromName||id, ts:Date.now() }
      if (!to(msg.toId, req)) {
        if (!friendReqs[msg.toId]) friendReqs[msg.toId] = []
        if (!friendReqs[msg.toId].find(r => r.from === id)) friendReqs[msg.toId].push(req)
      }
      ws.send(JSON.stringify({ type:'request_sent', toId:msg.toId }))
    }
    else if (msg.type === 'accept_friend') {
      to(msg.toId, { type:'friend_accepted', by:id, byName:msg.myName||id })
    }
    else if (msg.type === 'reject_friend') {
      to(msg.toId, { type:'friend_rejected', by:id })
      if (friendReqs[id]) friendReqs[id] = friendReqs[id].filter(r => r.from !== msg.toId)
    }
    else if (msg.type === 'msg') {
      const data = { type:'msg', from:id, fromName:msg.fromName||id, to:msg.to, text:msg.text, id:msg.id, ts:msg.ts||Date.now(), msgType:msg.msgType||'text', fileName:msg.fileName||null, selfDestruct:msg.selfDestruct||false, replyTo:msg.replyTo||null }
      const delivered = to(msg.to, data)
      if (!delivered) queue(msg.to, data)
      ws.send(JSON.stringify({ type:'ack', id:msg.id, delivered }))
    }
    else if (msg.type === 'group_msg') {
      const data = { type:'group_msg', from:id, fromName:msg.fromName||id, groupId:msg.groupId, groupName:msg.groupName||'', text:msg.text, id:msg.id, ts:msg.ts||Date.now() }
      ;(msg.members||[]).forEach(uid => { if (uid !== id) { if (!to(uid, data)) queue(uid, data) } })
    }
    else if (msg.type === 'typing') { to(msg.to, { type:'typing', from:id }) }
    else if (msg.type === 'ping') { ws.send(JSON.stringify({ type:'pong' })) }
  })

  ws.on('close', () => {
    if (id) { delete users[id]; Object.keys(users).forEach(uid => to(uid, { type:'user_offline', userId:id })) }
  })
  ws.on('error', () => {})
})

setInterval(() => {
  const week = 7*24*60*60*1000, now = Date.now()
  Object.keys(pending).forEach(uid => { pending[uid] = pending[uid].filter(m => (now-(m.ts||0)) < week); if (!pending[uid].length) delete pending[uid] })
  Object.keys(friendReqs).forEach(uid => { friendReqs[uid] = friendReqs[uid].filter(r => (now-r.ts) < week); if (!friendReqs[uid].length) delete friendReqs[uid] })
}, 3600000)

server.listen(PORT, () => console.log(`Island Relay on port ${PORT} — no database, pure relay`))
