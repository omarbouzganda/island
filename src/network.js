// ── FREEISLE NETWORK ──
// Relay: wss://island-v6xl.onrender.com (reuse existing relay)
// No database. No storage. Pure message relay.

var RELAY = 'wss://island-v6xl.onrender.com'
var LOCAL = 'ws://localhost:3000'

var ws = null
var myId = null
var myName = null
var alive = false
var retries = 0
var pingLoop = null
var handlers = {}
var sendQueue = []
var currentUrl = RELAY

function on(event, fn) { handlers[event] = fn }
function emit(event, data) { if (handlers[event]) handlers[event](data) }

function connect(userId, displayName) {
  myId = userId
  myName = displayName || userId
  tryConnect(RELAY)
}

function tryConnect(url) {
  currentUrl = url
  try { if (ws) { ws.onclose = null; ws.close() } } catch(e) {}
  try { ws = new WebSocket(url) } catch(e) {
    scheduleReconnect(url)
    return
  }

  ws.onopen = function() {
    alive = true
    retries = 0
    rawSend({ type: 'register', userId: myId })
    // Flush queue
    while (sendQueue.length > 0) rawSend(sendQueue.shift())
    clearInterval(pingLoop)
    pingLoop = setInterval(function() { rawSend({ type: 'ping' }) }, 20000)
    emit('connected', { relay: url })
  }

  ws.onmessage = function(e) {
    var msg
    try { msg = JSON.parse(e.data) } catch(err) { return }
    emit(msg.type, msg)
  }

  ws.onclose = function() {
    alive = false
    clearInterval(pingLoop)
    emit('disconnected', {})
    scheduleReconnect(url)
  }

  ws.onerror = function() {
    // Try the other endpoint on first error
    if (url === RELAY && retries < 2) {
      setTimeout(function() { tryConnect(LOCAL) }, 1000)
    }
  }
}

function scheduleReconnect(url) {
  var delay = Math.min(1000 * Math.pow(1.5, retries++), 15000)
  setTimeout(function() { tryConnect(url) }, delay)
}

function rawSend(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(data)); return true } catch(e) {}
  }
  return false
}

function send(data) {
  if (!rawSend(data)) {
    sendQueue.push(data)
    if (sendQueue.length > 300) sendQueue.shift()
    return false
  }
  return true
}

function sendFriendRequest(toId) {
  return send({ type: 'friend_request', toId: toId, fromName: myName || myId })
}
function acceptFriend(toId) {
  return send({ type: 'accept_friend', toId: toId, myName: myName || myId })
}
function rejectFriend(toId) {
  return send({ type: 'reject_friend', toId: toId })
}
function sendMsg(toId, text, opts) {
  opts = opts || {}
  var id = Date.now().toString(36) + Math.random().toString(36).slice(2)
  var ok = send({
    type: 'msg',
    to: toId,
    fromName: myName || myId,
    text: text,
    id: id,
    ts: Date.now(),
    msgType: opts.msgType || 'text',
    fileName: opts.fileName || null,
    selfDestruct: opts.selfDestruct || false,
    replyTo: opts.replyTo || null
  })
  return { sent: ok, id: id }
}
function sendGroupMsg(groupId, groupName, members, text) {
  var id = Date.now().toString(36) + Math.random().toString(36).slice(2)
  send({ type: 'group_msg', groupId: groupId, groupName: groupName, members: members, text: text, id: id, ts: Date.now(), fromName: myName || myId })
  return id
}
function sendTyping(toId) { send({ type: 'typing', to: toId }) }
function sendRead(toId, msgId) { send({ type: 'read', to: toId, msgId: msgId }) }
function isAlive() { return alive }
function getId() { return myId }
function getName() { return myName }

window.Net = {
  connect, on, sendFriendRequest, acceptFriend, rejectFriend,
  sendMsg, sendGroupMsg, sendTyping, sendRead, isAlive, getId, getName
}
