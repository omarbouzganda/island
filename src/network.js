// ── ISLAND NETWORK ──
// Relay = free server that passes messages, stores NOTHING
// Deploy server.js on render.com then update RELAY below

var RELAY = 'wss://island-relay-omar.onrender.com'
var LOCAL = 'ws://localhost:3000'

var ws = null
var myId = null
var alive = false
var retries = 0
var pingLoop = null
var handlers = {}
var queue = []

function on(event, fn) { handlers[event] = fn }
function emit(event, data) { if (handlers[event]) handlers[event](data) }

function connect(userId) {
  myId = userId
  tryConnect(RELAY)
}

function tryConnect(url) {
  try { if (ws) ws.close() } catch(e) {}

  try { ws = new WebSocket(url) }
  catch(e) {
    setTimeout(function() { tryConnect(url === RELAY ? LOCAL : RELAY) }, 3000)
    return
  }

  ws.onopen = function() {
    alive = true
    retries = 0
    send({ type: 'register', userId: myId })
    while (queue.length > 0) send(queue.shift())
    clearInterval(pingLoop)
    pingLoop = setInterval(function() { send({ type: 'ping' }) }, 20000)
    emit('connected', {})
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
    var delay = Math.min(1000 * Math.pow(2, retries++), 10000)
    setTimeout(function() { tryConnect(url) }, delay)
  }

  ws.onerror = function() {
    if (url === RELAY && retries < 1) setTimeout(function() { tryConnect(LOCAL) }, 1000)
  }
}

function send(data) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(data))
    return true
  }
  queue.push(data)
  if (queue.length > 200) queue.shift()
  return false
}

function sendFriendRequest(toId, myName) {
  return send({ type: 'friend_request', toId: toId, fromName: myName || myId })
}

function acceptFriend(toId, myName) {
  return send({ type: 'accept_friend', toId: toId, myName: myName || myId })
}

function rejectFriend(toId) {
  return send({ type: 'reject_friend', toId: toId })
}

function sendMsg(toId, text, opts) {
  opts = opts || {}
  var id = Date.now().toString(36) + Math.random().toString(36).slice(2)
  var sent = send({
    type: 'msg',
    to: toId,
    fromName: myId,
    text: text,
    id: id,
    ts: Date.now(),
    msgType: opts.msgType || 'text',
    fileName: opts.fileName || null,
    selfDestruct: opts.selfDestruct || false,
    replyTo: opts.replyTo || null
  })
  return { sent: sent, id: id }
}

function sendGroupMsg(groupId, groupName, members, text) {
  var id = Date.now().toString(36)
  send({ type: 'group_msg', groupId: groupId, groupName: groupName, members: members, text: text, id: id, ts: Date.now(), fromName: myId })
  return id
}

function sendTyping(toId) {
  send({ type: 'typing', to: toId })
}

function isAlive() { return alive }
function getId() { return myId }

window.Net = {
  connect: connect,
  on: on,
  sendFriendRequest: sendFriendRequest,
  acceptFriend: acceptFriend,
  rejectFriend: rejectFriend,
  sendMsg: sendMsg,
  sendGroupMsg: sendGroupMsg,
  sendTyping: sendTyping,
  isAlive: isAlive,
  getId: getId
}
