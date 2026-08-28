"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const rooms = new Map();
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg" };

function id(length = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let value = "";
  while (value.length < length) value += alphabet[crypto.randomInt(alphabet.length)];
  return value;
}

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", chunk => {
      raw += chunk;
      if (raw.length > 1_000_000) request.destroy();
    });
    request.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); }
    });
    request.on("error", reject);
  });
}

function roomFor(roomId, clientId) {
  const room = rooms.get(String(roomId || "").toUpperCase());
  if (!room || !room.players.some(player => player.clientId === clientId)) return null;
  room.updatedAt = Date.now();
  return room;
}

function roomInfo(room) {
  return { roomId: room.id, private: room.private, connected: room.players.length === 2, players: room.players.length };
}

async function api(request, response, url) {
  if (request.method === "POST" && url.pathname === "/api/create") {
    const body = await readJson(request);
    let roomId;
    do { roomId = id(); } while (rooms.has(roomId));
    const clientId = crypto.randomUUID();
    const hostSide = Math.random() < 0.5 ? "player" : "enemy";
    const now = Date.now();
    const room = { id: roomId, private: Boolean(body.private), players: [{ clientId, side: hostSide }], messages: [], sequence: 0, createdAt: now, updatedAt: now };
    rooms.set(roomId, room);
    return json(response, 200, { ...roomInfo(room), clientId, side: hostSide });
  }

  if (request.method === "POST" && url.pathname === "/api/join") {
    const body = await readJson(request);
    const requestedId = String(body.roomId || "").trim().toUpperCase();
    let room = requestedId ? rooms.get(requestedId) : [...rooms.values()].find(candidate => !candidate.private && candidate.players.length === 1);
    if (!room) return json(response, 404, { error: requestedId ? "Room not found." : "No public room is waiting." });
    if (room.players.length >= 2) return json(response, 409, { error: "Room is full." });
    const clientId = crypto.randomUUID();
    const side = room.players[0].side === "player" ? "enemy" : "player";
    room.players.push({ clientId, side });
    room.updatedAt = Date.now();
    room.sequence++;
    room.messages.push({ sequence: room.sequence, sender: "server", type: "joined", payload: {} });
    return json(response, 200, { ...roomInfo(room), clientId, side });
  }

  if (request.method === "POST" && url.pathname === "/api/message") {
    const body = await readJson(request);
    const room = roomFor(body.roomId, body.clientId);
    if (!room) return json(response, 404, { error: "Room closed." });
    room.sequence++;
    room.messages.push({ sequence: room.sequence, sender: body.clientId, type: body.type, payload: body.payload });
    if (room.messages.length > 250) room.messages.splice(0, room.messages.length - 250);
    return json(response, 200, { sequence: room.sequence });
  }

  if (request.method === "GET" && url.pathname === "/api/poll") {
    const room = roomFor(url.searchParams.get("roomId"), url.searchParams.get("clientId"));
    if (!room) return json(response, 404, { error: "Room closed." });
    const since = Number(url.searchParams.get("since") || 0);
    return json(response, 200, { ...roomInfo(room), sequence: room.sequence, messages: room.messages.filter(message => message.sequence > since) });
  }

  if (request.method === "POST" && url.pathname === "/api/leave") {
    const body = await readJson(request);
    const room = roomFor(body.roomId, body.clientId);
    if (room) rooms.delete(room.id);
    return json(response, 200, { ok: true });
  }

  if (request.method === "POST" && url.pathname === "/api/fallback-ai") {
    const body = await readJson(request);
    const room = roomFor(body.roomId, body.clientId);
    if (!room) return json(response, 404, { error: "Room closed." });
    if (room.private || room.players.length !== 1) return json(response, 200, { fallback: false, connected: room.players.length === 2 });
    rooms.delete(room.id);
    return json(response, 200, { fallback: true });
  }

  return json(response, 404, { error: "Not found." });
}

function staticFile(request, response, url) {
  const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const file = path.resolve(ROOT, `.${relative}`);
  if (!file.startsWith(ROOT + path.sep)) return response.writeHead(403).end("Forbidden");
  fs.readFile(file, (error, data) => {
    if (error) return response.writeHead(404).end("Not found");
    response.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
    response.end(data);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) return await api(request, response, url);
    staticFile(request, response, url);
  } catch (error) {
    json(response, 500, { error: "Server error." });
  }
});

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [roomId, room] of rooms) if (room.updatedAt < cutoff) rooms.delete(roomId);
}, 60_000).unref();

server.listen(PORT, HOST, () => console.log(`Tank Attack and Defend: http://localhost:${PORT}`));
