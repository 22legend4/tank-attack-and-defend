"use strict";

const canvas = document.getElementById("arena");
const ctx = canvas.getContext("2d");
const W = canvas.width;
const H = canvas.height;
const LANES = [215, 280, 345];
const CORE_X = { player: 72, enemy: W - 72 };
const HOME_X = { player: 205, enemy: W - 205 };
const SOLDIER_X = { player: 190, enemy: W - 190 };
const BASE_SPEED = (CORE_X.enemy - HOME_X.player) / 8;

const ITEM_DEFAULTS = Object.freeze({ laser: 2, magic: 2, destroy: 1, clone: 10, fan: 4, shield: 5, artillery: 3 });
const COLORS = { player: "#ffb72d", enemy: "#61df3d" };
const LABELS = { normal: "Normal Bullet", laser: "Laser", magic: "Black Hole", clone: "Triple Shot", artillery: "Artillery" };

const ASSET_PATHS = {
  background1: "assets/bg-1.jpg",
  background2: "assets/bg-2.jpg",
  background3: "assets/bg-3.jpg",
  playerTank: "assets/yellow tank.png",
  enemyTank: "assets/green tank.png",
  playerSoldier: "assets/yellow soldier.png",
  enemySoldier: "assets/green soldier.png",
  playerCore: "assets/yellow-table.png",
  enemyCore: "assets/green-table.png",
  playerBullet: "assets/yellow bullet.png",
  enemyBullet: "assets/green-bullet.png",
  playerClone: "assets/yellow-dan-phan-3.png",
  enemyClone: "assets/green-dan-phan-3.png",
  magicVertical: "assets/ho-den-doc.png",
  artillery: "assets/dan-phao.png",
  laser: "assets/Lazer.png"
};
const ASSETS = Object.fromEntries(Object.entries(ASSET_PATHS).map(([key, src]) => {
  const image = new Image();
  image.src = src;
  return [key, image];
}));

let game;
let lastTime = performance.now();
let nextId = 1;
let playMode = "menu";
let localSide = "player";
let network = null;
let networkPolling = false;
let lastStateSent = 0;

async function enterLandscapeMode() {
  const message = document.getElementById("orientationMessage");
  const button = document.getElementById("orientationButton");
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  if (isIOS) {
    message.textContent = "Turn your iPhone sideways to play.";
    button.textContent = "TURN YOUR IPHONE SIDEWAYS";
    return;
  }
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    }
  } catch (_) {}

  try {
    if (screen.orientation?.lock) await screen.orientation.lock("landscape");
  } catch (_) {
    message.textContent = "Please turn your phone sideways to play.";
  }
}

function makeSide(id) {
  return {
    id,
    coreHp: 10,
    ammo: 400,
    tankAlive: true,
    tankX: HOME_X[id],
    shieldUntil: 0,
    soldiers: [false, false],
    soldierTimers: [0, 0],
    items: { ...ITEM_DEFAULTS }
  };
}

function resetGame({ preserveBackground = false } = {}) {
  const previousBackground = game?.backgroundIndex;
  const openingShotCount = Math.floor(Math.random() * 3) + 1;
  game = {
    player: makeSide("player"),
    enemy: makeSide("enemy"),
    projectiles: [],
    effects: [],
    backgroundIndex: preserveBackground && previousBackground
      ? previousBackground
      : Math.floor(Math.random() * 3) + 1,
    over: false,
    now: 0,
    aiTimer: 1.2,
    aiFreeFireTimer: 0,
    aiBurstTimer: 5,
    aiBurstShots: 0,
    aiBurstShotTimer: 0,
    aiOpeningShots: Array.from({ length: openingShotCount }, () => 0.12 + Math.random() * 0.78).sort((a, b) => a - b)
  };
  nextId = 1;
  document.getElementById("restartButton").classList.add("hidden");
  setMessage("Tank Attack and Defend");
  refreshUI();
}

function other(side) { return side === "player" ? "enemy" : "player"; }
function direction(side) { return side === "player" ? 1 : -1; }
function viewX(x) { return localSide === "player" ? x : W - x; }
function viewDirection(dir) { return localSide === "player" ? dir : -dir; }
function isViewLeft(side) { return side === localSide; }

function setMessage(text, ms = 0) {
  const el = document.getElementById("message");
  el.textContent = text;
  if (ms) {
    const stamp = ++setMessage.stamp;
    setTimeout(() => {
      if (stamp === setMessage.stamp && !game.over) el.textContent = "Tank Attack and Defend";
    }, ms);
  }
}
setMessage.stamp = 0;

function addProjectile(owner, type, lane = 1, fromSoldier = false) {
  const side = game[owner];
  if (game.over) return false;
  if (!fromSoldier && !side.tankAlive) return false;
  if (type === "normal") {
    if (side.ammo <= 0) return false;
    side.ammo--;
  } else if (type !== "artillery") {
    if (side.items[type] <= 0) return false;
    side.items[type]--;
  }

  const x = fromSoldier ? SOLDIER_X[owner] : side.tankX;
  const speed = type === "laser" ? BASE_SPEED * 2 : BASE_SPEED;
  game.projectiles.push({
    id: nextId++, owner, type, lane, x, y: LANES[lane], speed,
    dir: direction(owner), split: false, alive: true,
    artilleryElapsed: 0, artilleryDuration: 3.2,
    startX: x, targetX: CORE_X[other(owner)]
  });
  if (playMode === "ai" && owner === localSide && type === "normal" && !fromSoldier && game.now >= 1) {
    addProjectile(other(localSide), "normal", 1);
  }
  refreshUI();
  return true;
}

function fireSpecial(side, type) {
  if (game.over) return;
  const unit = game[side];
  if (type === "fan") return useFan(side);
  if (type === "shield") {
    if (unit.items.shield <= 0) return;
    unit.items.shield--;
    unit.shieldUntil = game.now + 2;
    refreshUI();
    return;
  }
  if (type === "destroy") {
    if (unit.items.destroy <= 0 || !unit.tankAlive) return;
    unit.items.destroy--;
    for (const projectile of game.projectiles) {
      if (projectile.alive) addExplosion(projectile.x, projectile.y, COLORS[projectile.owner]);
    }
    game.projectiles.length = 0;
    const teamName = side === "player" ? "YELLOW TEAM" : "GREEN TEAM";
    addEffect(W / 2, H / 2, COLORS[side], `${teamName} USED DESTROY`, 1.8);
    refreshUI();
    return;
  }
  if (type === "artillery") {
    if (!unit.tankAlive || unit.items.artillery <= 0) return;
    unit.items.artillery--;
    const x = unit.tankX;
    game.projectiles.push({
      id: nextId++, owner: side, type, lane: 1, x, y: LANES[1], dir: direction(side),
      alive: true, artilleryElapsed: 0, artilleryDuration: 3.2,
      startX: x, targetX: CORE_X[other(side)]
    });
    refreshUI();
    return;
  }
  addProjectile(side, type, 1);
}

function useFan(side) {
  const unit = game[side];
  if (unit.items.fan <= 0) return;
  unit.items.fan--;
  const incoming = game.projectiles.filter(p => p.alive && p.owner !== side && p.dir === direction(other(side)));
  if (incoming.length) {
    const coreX = CORE_X[side];
    let bestDistance = Math.min(...incoming.map(p => Math.abs(p.x - coreX)));
    const nearest = incoming.filter(p => Math.abs(Math.abs(p.x - coreX) - bestDistance) < 0.5);
    const picked = nearest[Math.floor(Math.random() * nearest.length)];
    picked.owner = side;
    picked.dir *= -1;
    if (picked.type === "artillery") {
      picked.startX = picked.x;
      picked.targetX = CORE_X[other(side)];
      picked.artilleryElapsed = 0;
    }
    addEffect(picked.x, picked.y, "#e5ff70", "REFLECT", 0.8);
  } else {
    addEffect(CORE_X[side] + direction(side) * 80, H / 2, "#9aa8ad", "MISS", 0.7);
  }
  refreshUI();
}

function summon(side) {
  const unit = game[side];
  const empty = [0, 1].filter(i => !unit.soldiers[i]);
  if (unit.ammo < 10 || !empty.length || game.over) return;
  unit.ammo -= 10;
  const slot = empty[Math.floor(Math.random() * empty.length)];
  unit.soldiers[slot] = true;
  unit.soldierTimers[slot] = 0;
  refreshUI();
}

function sacrifice(side, action) {
  const unit = game[side];
  const foe = game[other(side)];
  if (game.over) return false;
  if (action === "ammo" && unit.coreHp >= 1) {
    unit.coreHp -= 1;
    unit.ammo += 5;
  } else if (action === "soldier" && unit.coreHp >= 1) {
    const alive = [0, 1].filter(i => foe.soldiers[i]);
    if (!alive.length) return false;
    unit.coreHp -= 1;
    foe.soldiers[alive[Math.floor(Math.random() * alive.length)]] = false;
  } else if (action === "core" && unit.coreHp >= 2) {
    unit.coreHp -= 2;
    damageCore(other(side), 1);
  } else return false;
  checkEnd();
  refreshUI();
  return true;
}

function revive(side) {
  const unit = game[side];
  if (game.over || unit.tankAlive || unit.coreHp < 4) return;
  unit.coreHp -= 4;
  unit.tankAlive = true;
  unit.tankX = HOME_X[side];
  addEffect(unit.tankX, LANES[1], COLORS[side], "REVIVED", 1);
  checkEnd();
  refreshUI();
}

function update(dt) {
  if (game.over || playMode === "menu" || playMode === "online-guest") return;
  game.now += dt;
  for (const sideName of ["player", "enemy"]) {
    const side = game[sideName];
    for (let slot = 0; slot < 2; slot++) {
      if (!side.soldiers[slot]) continue;
      side.soldierTimers[slot] += dt;
      if (side.soldierTimers[slot] >= 1) {
        side.soldierTimers[slot] -= 1;
        addProjectile(sideName, "normal", slot === 0 ? 0 : 2, true);
      }
    }
  }

  for (const p of game.projectiles) {
    if (!p.alive) continue;
    p.previousX = p.x;
    if (p.type === "artillery") {
      p.artilleryElapsed += dt;
      const t = Math.min(1, p.artilleryElapsed / p.artilleryDuration);
      p.x = p.startX + (p.targetX - p.startX) * t;
      p.y = LANES[1] - Math.sin(Math.PI * t) * 210;
      const target = other(p.owner);
      const shieldX = shieldBarrierX(target);
      if (game[target].shieldUntil > game.now && crossedBetween(p.previousX, p.x, shieldX, p.dir)) {
        p.alive = false;
        addExplosion(p.x, p.y, "#9df7ff");
        continue;
      }
      if (t >= 1) landArtillery(p);
    } else {
      p.x += p.dir * p.speed * dt;
      if (p.type === "clone" && !p.split && ((p.dir > 0 && p.x >= W / 2) || (p.dir < 0 && p.x <= W / 2))) splitProjectile(p);
    }
  }

  resolveProjectileCollisions();
  resolveImpacts();
  game.projectiles = game.projectiles.filter(p => p.alive && p.x > -80 && p.x < W + 80);
  game.effects = game.effects.filter(e => (e.life -= dt) > 0);
  if (playMode === "ai") updateAI(dt);
  if (playMode === "online-host" && network?.connected && game.now - lastStateSent >= 0.1) {
    lastStateSent = game.now;
    sendRoomMessage("state", game);
  }
  refreshUI();
}

function splitProjectile(p) {
  p.split = true;
  for (const lane of [0, 2]) {
    game.projectiles.push({ ...p, id: nextId++, lane, y: LANES[lane], alive: true });
  }
  addEffect(p.x, p.y, "#ff72d2", "x3", 0.6);
}

function resolveProjectileCollisions() {
  const bullets = game.projectiles.filter(p => p.alive && p.type !== "artillery");
  for (let i = 0; i < bullets.length; i++) {
    const a = bullets[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < bullets.length; j++) {
      if (!a.alive) break;
      const b = bullets[j];
      if (!b.alive || a.owner === b.owner) continue;
      const laneMatch = a.type === "magic" || b.type === "magic" || a.lane === b.lane;
      if (!laneMatch || Math.abs(a.x - b.x) > 22) continue;
      const aActsAsNormal = a.type === "normal" || a.type === "clone";
      const bActsAsNormal = b.type === "normal" || b.type === "clone";
      if (a.type === "magic" && b.type === "magic") {
        a.alive = b.alive = false;
      } else if (a.type === "magic") {
        b.alive = false;
      } else if (b.type === "magic") {
        a.alive = false;
      } else if (a.type === "laser" && b.type === "laser") {
        continue;
      } else if (a.type === "laser" && bActsAsNormal) {
        b.alive = false;
      } else if (b.type === "laser" && aActsAsNormal) {
        a.alive = false;
      } else if (aActsAsNormal && bActsAsNormal) {
        a.alive = b.alive = false;
      }
    }
  }
}

function resolveImpacts() {
  for (const p of game.projectiles) {
    if (!p.alive || p.type === "artillery") continue;
    const target = other(p.owner);
    const unit = game[target];
    const shieldX = shieldBarrierX(target);
    if (unit.shieldUntil > game.now && crossedBetween(p.previousX ?? p.x, p.x, shieldX, p.dir)) {
      p.alive = false;
      continue;
    }

    if (p.lane === 1 && unit.tankAlive && crossed(p, unit.tankX)) {
      p.alive = false;
      destroyTank(target);
      continue;
    }
    const slot = p.lane === 0 ? 0 : p.lane === 2 ? 1 : -1;
    if (slot >= 0 && unit.soldiers[slot] && crossed(p, SOLDIER_X[target])) {
      p.alive = false;
      unit.soldiers[slot] = false;
      addEffect(SOLDIER_X[target], LANES[p.lane], "#ff5959", "SOLDIER DOWN", 0.7);
      continue;
    }
    if (crossed(p, CORE_X[target])) {
      p.alive = false;
      damageCore(target, 1);
    }
  }
}

function crossed(p, x) { return p.dir > 0 ? p.x >= x : p.x <= x; }

function crossedBetween(previousX, currentX, targetX, dir) {
  return dir > 0
    ? previousX < targetX && currentX >= targetX
    : previousX > targetX && currentX <= targetX;
}

function shieldBarrierX(side) {
  return side === "player" ? HOME_X.player + 105 : HOME_X.enemy - 105;
}

function landArtillery(p) {
  if (!p.alive) return;
  p.alive = false;
  const target = other(p.owner);
  damageCore(target, 1);
}

function destroyTank(side) {
  const unit = game[side];
  unit.tankAlive = false;
  unit.tankX = HOME_X[side];
  addEffect(unit.tankX, LANES[1], "#ff5959", "TANK DOWN", 1);
}

function damageCore(side, amount) {
  game[side].coreHp = Math.max(0, game[side].coreHp - amount);
  addEffect(CORE_X[side], H / 2, "#ff3f50", `−${amount} HP`, 0.75);
  checkEnd();
}

function checkEnd() {
  if (game.player.coreHp > 0 && game.enemy.coreHp > 0) return;
  game.over = true;
  let result = "DRAW — BOTH CORES DESTROYED";
  if (game[localSide].coreHp <= 0 && game[other(localSide)].coreHp > 0) result = "DEFEAT — YOUR CORE WAS DESTROYED";
  if (game[other(localSide)].coreHp <= 0 && game[localSide].coreHp > 0) result = "VICTORY — ENEMY CORE DESTROYED";
  game.result = result;
  setMessage(result);
  document.getElementById("restartButton").classList.remove("hidden");
}

function addEffect(x, y, color, text, life) { game.effects.push({ x, y, color, text, life, maxLife: life }); }
function addExplosion(x, y, color) {
  const life = 0.65;
  game.effects.push({ type: "explosion", x, y, color, life, maxLife: life, seed: Math.random() * Math.PI * 2 });
}

function updateAI(dt) {
  const aiSide = other(localSide);
  const ai = game[aiSide];
  const human = game[localSide];
  game.aiTimer -= dt;
  while (game.aiOpeningShots?.length && game.aiOpeningShots[0] <= game.now) {
    game.aiOpeningShots.shift();
    addProjectile(aiSide, "normal", 1);
  }
  if (!human.tankAlive && ai.tankAlive) {
    game.aiFreeFireTimer -= dt;
    if (game.aiFreeFireTimer <= 0) {
      addProjectile(aiSide, "normal", 1);
      game.aiFreeFireTimer = 0.35 + Math.random() * 0.55;
    }
  } else {
    game.aiFreeFireTimer = 0;
  }
  if (ai.tankAlive) {
    game.aiBurstTimer -= dt;
    if (game.aiBurstTimer <= 0) {
      game.aiBurstTimer += 5;
      game.aiBurstShots = Math.floor(Math.random() * 2) + 1;
      game.aiBurstShotTimer = 0;
    }
    if (game.aiBurstShots > 0) {
      game.aiBurstShotTimer -= dt;
      if (game.aiBurstShotTimer <= 0) {
        addProjectile(aiSide, "normal", 1);
        game.aiBurstShots--;
        game.aiBurstShotTimer = 0.16;
      }
    }
  } else {
    game.aiBurstShots = 0;
  }
  const incoming = game.projectiles
    .filter(p => p.alive && p.owner === localSide && p.dir === direction(localSide))
    .sort((a, b) => Math.abs(a.x - CORE_X[aiSide]) - Math.abs(b.x - CORE_X[aiSide]));
  const shieldX = shieldBarrierX(aiSide);
  const defensiveThreats = incoming.filter(p => {
    if (!['laser', 'magic', 'clone'].includes(p.type)) return false;
    const hasNotPassedShield = aiSide === "player" ? p.x > shieldX : p.x < shieldX;
    const secondsToShield = Math.abs(p.x - shieldX) / Math.max(1, p.speed || BASE_SPEED);
    return hasNotPassedShield && secondsToShield <= 1.35;
  });
  if (ai.shieldUntil <= game.now && defensiveThreats.length) {
    const nearestIncoming = incoming[0];
    const nearestIsThreat = defensiveThreats.includes(nearestIncoming);
    if (nearestIsThreat) {
      const isLaserOrBlackHole = nearestIncoming.type === "laser" || nearestIncoming.type === "magic";
      const nearestDistance = Math.abs(nearestIncoming.x - CORE_X[aiSide]);
      const tiedNearest = incoming.filter(p => Math.abs(Math.abs(p.x - CORE_X[aiSide]) - nearestDistance) < 0.5);
      if (isLaserOrBlackHole && tiedNearest.every(p => p.type === "laser" || p.type === "magic") && ai.items.fan > 0) return useFan(aiSide);
    }
    if (ai.items.fan <= 0 && ai.items.shield > 0 && defensiveThreats.some(p => p.type === "laser" || p.type === "magic")) return fireSpecial(aiSide, "shield");
    if (ai.items.shield > 0 && defensiveThreats.some(p => p.type === "clone")) return fireSpecial(aiSide, "shield");
  }
  if (game.now < 1) return;
  if (game.aiTimer > 0 || game.over) return;
  game.aiTimer = 0.55 + Math.random() * 0.75;
  if (!ai.tankAlive && ai.coreHp >= 4) return revive(aiSide);
  const playerBulletsInAiHalf = incoming.filter(p => aiSide === "player" ? p.x < W / 2 : p.x > W / 2).length;
  const aiBullets = game.projectiles.filter(p => p.alive && p.owner === aiSide).length;
  if (ai.items.destroy > 0 && playerBulletsInAiHalf > aiBullets) return fireSpecial(aiSide, "destroy");
  if (ai.soldiers.filter(Boolean).length < 2 && ai.ammo >= 10 && Math.random() < 0.25) return summon(aiSide);
  const choices = ["laser", "magic", "clone", "artillery"];
  const type = choices[Math.floor(Math.random() * choices.length)];
  fireSpecial(aiSide, type);
}

function refreshUI() {
  for (const viewSide of ["player", "enemy"]) {
    const sideName = viewSide === "player" ? localSide : other(localSide);
    const side = game[sideName];
    const health = document.getElementById(`${viewSide}Health`);
    const energyImage = sideName === "player" ? "assets/yellow energy.png" : "assets/green energy.png";
    health.innerHTML = Array.from({ length: 10 }, (_, i) =>
      `<img src="${energyImage}" alt="" class="${i < side.coreHp ? "on" : ""}">`
    ).join("");
    document.getElementById(`${viewSide}Ammo`).textContent = side.ammo;
  }
  const local = game[localSide];
  const remote = game[other(localSide)];
  document.getElementById("summonIcon").src = localSide === "player" ? "assets/yellow soldier.png" : "assets/green soldier.png";
  document.getElementById("reviveIcon").src = localSide === "player" ? "assets/yellow tank.png" : "assets/green tank.png";
  for (const key of Object.keys(ITEM_DEFAULTS)) document.getElementById(`${key}Count`).textContent = local.items[key];
  document.getElementById("normalButton").disabled = game.over || !local.tankAlive || local.ammo <= 0;
  document.getElementById("summonButton").disabled = game.over || local.ammo < 10 || local.soldiers.every(Boolean);
  document.getElementById("tradeAmmoButton").disabled = game.over || local.coreHp < 1;
  document.getElementById("destroySoldierButton").disabled = game.over || local.coreHp < 1 || !remote.soldiers.some(Boolean);
  document.getElementById("damageCoreButton").disabled = game.over || local.coreHp < 2;
  document.getElementById("reviveButton").disabled = game.over || local.tankAlive || local.coreHp < 4;
  document.querySelectorAll("[data-action]").forEach(button => {
    const action = button.dataset.action;
    const needsTank = !["fan", "shield"].includes(action);
    button.disabled = game.over || local.items[action] <= 0 || (needsTank && !local.tankAlive);
  });
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  drawField();
  drawSide("player");
  drawSide("enemy");
  for (const p of game.projectiles) if (p.alive) drawProjectile(p);
  for (const e of game.effects) drawEffect(e);
}

function drawField() {
  const background = ASSETS[`background${game.backgroundIndex || 1}`];
  if (background.complete && background.naturalWidth) {
    ctx.drawImage(background, 0, 0, W, H);
    ctx.fillStyle = "#06101542";
    ctx.fillRect(0, 0, W, H);
  }
  ctx.strokeStyle = "#40555e";
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 14]);
  for (const y of LANES) { ctx.beginPath(); ctx.moveTo(100, y); ctx.lineTo(W - 100, y); ctx.stroke(); }
  ctx.setLineDash([]);
  ctx.fillStyle = "#ffffff0c";
  ctx.fillRect(W / 2 - 3, 20, 6, H - 40);
}

function drawSide(sideName) {
  const side = game[sideName];
  drawCore(viewX(CORE_X[sideName]), H / 2, sideName, side.coreHp);
  if (side.shieldUntil > game.now) drawShield(sideName);
  if (side.tankAlive) drawTank(viewX(side.tankX), LANES[1], sideName);
  if (side.soldiers[0]) drawSoldier(viewX(SOLDIER_X[sideName]), LANES[0], sideName);
  if (side.soldiers[1]) drawSoldier(viewX(SOLDIER_X[sideName]), LANES[2], sideName);
}

function drawCore(x, y, side, hp) {
  const image = ASSETS[side === "player" ? "playerCore" : "enemyCore"];
  if (!image.complete || !image.naturalWidth) return;
  ctx.save();
  ctx.globalAlpha = hp > 0 ? 1 : 0.3;
  ctx.translate(x, y);
  if (!isViewLeft(side)) ctx.scale(-1, 1);
  const height = 205;
  const width = height * image.naturalWidth / image.naturalHeight;
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  ctx.restore();
}

function drawTank(x, y, side) {
  const image = ASSETS[side === "player" ? "playerTank" : "enemyTank"];
  if (!image.complete || !image.naturalWidth) return;
  ctx.save(); ctx.translate(x, y);
  if (!isViewLeft(side)) ctx.scale(-1, 1);
  const width = 154;
  const height = width * image.naturalHeight / image.naturalWidth;
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  ctx.restore();
}

function drawSoldier(x, y, side) {
  const image = ASSETS[side === "player" ? "playerSoldier" : "enemySoldier"];
  if (!image.complete || !image.naturalWidth) return;
  ctx.save(); ctx.translate(x, y);
  if (!isViewLeft(side)) ctx.scale(-1, 1);
  const height = 48;
  const width = height * image.naturalWidth / image.naturalHeight;
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  ctx.restore();
}

function drawShield(side) {
  const x = viewX(shieldBarrierX(side));
  ctx.save(); ctx.strokeStyle = "#9df7ff"; ctx.lineWidth = 7; ctx.shadowBlur = 18; ctx.shadowColor = "#9df7ff";
  ctx.beginPath();
  ctx.moveTo(x, LANES[0] - 78);
  ctx.quadraticCurveTo(x + viewDirection(direction(side)) * 26, H / 2, x, LANES[2] + 78);
  ctx.stroke();
  ctx.restore();
}

function drawProjectile(p) {
  const screenDirection = viewDirection(p.dir);
  ctx.save(); ctx.translate(viewX(p.x), p.y);
  if (p.type === "artillery") {
    const image = ASSETS.artillery;
    if (image.complete && image.naturalWidth) {
      if (screenDirection < 0) ctx.scale(-1, 1);
      const width = 58;
      const height = width * image.naturalHeight / image.naturalWidth;
      ctx.drawImage(image, -width / 2, -height / 2, width, height);
    }
  } else if (p.type === "laser") {
    const image = ASSETS.laser;
    if (image.complete && image.naturalWidth) {
      if (screenDirection < 0) ctx.scale(-1, 1);
      const width = 72;
      const height = width * image.naturalHeight / image.naturalWidth;
      ctx.drawImage(image, -width / 2, -height / 2, width, height);
    }
  } else if (p.type === "magic") {
    const image = ASSETS.magicVertical;
    if (image.complete && image.naturalWidth) {
      const height = 180;
      const width = height * image.naturalWidth / image.naturalHeight;
      ctx.drawImage(image, -width / 2, -height / 2, width, height);
    }
  } else if (p.type === "clone") {
    const image = ASSETS[p.owner === "player" ? "playerClone" : "enemyClone"];
    if (image.complete && image.naturalWidth) {
      if (screenDirection < 0) ctx.scale(-1, 1);
      const width = 38;
      const height = width * image.naturalHeight / image.naturalWidth;
      ctx.drawImage(image, -width / 2, -height / 2, width, height);
    }
  } else {
    const image = ASSETS[p.owner === "player" ? "playerBullet" : "enemyBullet"];
    if (image.complete && image.naturalWidth) {
      if (screenDirection < 0) ctx.scale(-1, 1);
      const width = 31;
      const height = width * image.naturalHeight / image.naturalWidth;
      ctx.drawImage(image, -width / 2, -height / 2, width, height);
    }
  }
  ctx.restore();
}

function drawEffect(e) {
  if (e.type === "explosion") {
    const progress = 1 - e.life / e.maxLife;
    const x = viewX(e.x);
    const radius = 7 + progress * 27;
    ctx.save();
    ctx.globalAlpha = Math.max(0, e.life / e.maxLife);
    const glow = ctx.createRadialGradient(x, e.y, 0, x, e.y, radius);
    glow.addColorStop(0, "#ffffff");
    glow.addColorStop(0.28, "#ffe866");
    glow.addColorStop(0.58, e.color);
    glow.addColorStop(1, "#ff3b1600");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, e.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff3a8";
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const angle = e.seed + i * Math.PI / 4;
      const inner = radius * 0.55;
      const outer = radius * (1.05 + (i % 3) * 0.13);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(angle) * inner, e.y + Math.sin(angle) * inner);
      ctx.lineTo(x + Math.cos(angle) * outer, e.y + Math.sin(angle) * outer);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  const alpha = Math.min(1, e.life / Math.min(0.3, e.maxLife));
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = e.color; ctx.font = "900 17px system-ui"; ctx.textAlign = "center"; ctx.fillText(e.text, viewX(e.x), e.y - 45 - (1 - e.life / e.maxLife) * 20); ctx.restore();
}

function executeAction(side, action) {
  if (action.kind === "normal") addProjectile(side, "normal", 1);
  else if (action.kind === "summon") summon(side);
  else if (action.kind === "revive") revive(side);
  else if (action.kind === "sacrifice") sacrifice(side, action.value);
  else if (action.kind === "special") fireSpecial(side, action.value);
  else if (action.kind === "restart" && playMode !== "online-guest") resetGame({ preserveBackground: true });
}

function control(action) {
  if (playMode === "menu") return;
  if (playMode === "online-guest") sendRoomMessage("action", action);
  else executeAction(localSide, action);
}

document.getElementById("normalButton").addEventListener("click", () => control({ kind: "normal" }));
document.getElementById("summonButton").addEventListener("click", () => control({ kind: "summon" }));
document.getElementById("reviveButton").addEventListener("click", () => control({ kind: "revive" }));
document.getElementById("tradeAmmoButton").addEventListener("click", () => control({ kind: "sacrifice", value: "ammo" }));
document.getElementById("destroySoldierButton").addEventListener("click", () => control({ kind: "sacrifice", value: "soldier" }));
document.getElementById("damageCoreButton").addEventListener("click", () => control({ kind: "sacrifice", value: "core" }));
document.getElementById("restartButton").addEventListener("click", () => control({ kind: "restart" }));
document.querySelectorAll("[data-action]").forEach(button => button.addEventListener("click", () => control({ kind: "special", value: button.dataset.action })));

function showLobbyView(viewId) {
  document.querySelectorAll(".lobby-view").forEach(view => view.classList.add("hidden"));
  document.getElementById(viewId).classList.remove("hidden");
  document.getElementById("lobbyError").textContent = "";
}

function lobbyError(message) { document.getElementById("lobbyError").textContent = message; }

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store"
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to connect to the room server.");
  return data;
}

async function createOnlineRoom() {
  try {
    const data = await apiRequest("/api/create", { method: "POST", body: { private: document.getElementById("privateRoomInput").checked } });
    network = { ...data, sequence: 0, connected: false };
    playMode = "online-host";
    localSide = data.side;
    document.getElementById("roomIdDisplay").textContent = data.roomId;
    document.getElementById("waitingMessage").textContent = data.private ? "Private room — share this ID with a friend." : "Public room — waiting for another player...";
    showLobbyView("waitingView");
    startNetworkPolling();
    if (!data.private) {
      const waitingRoomId = data.roomId;
      const waitingClientId = data.clientId;
      setTimeout(() => tryPublicAiFallback(waitingRoomId, waitingClientId), 120_000);
    }
  } catch (error) { lobbyError(error.message); }
}

async function tryPublicAiFallback(roomId, clientId) {
  if (!network || network.roomId !== roomId || network.clientId !== clientId || network.connected || playMode !== "online-host") return;
  try {
    const result = await apiRequest("/api/fallback-ai", { method: "POST", body: { roomId, clientId } });
    if (!result.fallback || !network || network.roomId !== roomId) return;
    network = null;
    networkPolling = false;
    playMode = "ai";
    resetGame();
    document.getElementById("lobby").classList.add("hidden");
  } catch (error) {
    if (network?.roomId === roomId) handleRoomClosed(error.message);
  }
}

async function joinOnlineRoom() {
  try {
    const roomId = document.getElementById("roomIdInput").value.trim().toUpperCase();
    const data = await apiRequest("/api/join", { method: "POST", body: { roomId } });
    network = { ...data, sequence: 0, connected: true };
    playMode = "online-guest";
    localSide = data.side;
    document.getElementById("roomIdDisplay").textContent = data.roomId;
    document.getElementById("waitingMessage").textContent = "Connecting to the match...";
    showLobbyView("waitingView");
    startNetworkPolling();
  } catch (error) { lobbyError(error.message); }
}

async function sendRoomMessage(type, payload) {
  if (!network) return;
  try {
    await apiRequest("/api/message", { method: "POST", body: { roomId: network.roomId, clientId: network.clientId, type, payload } });
  } catch (error) { handleRoomClosed(error.message); }
}

function startNetworkPolling() {
  if (networkPolling) return;
  networkPolling = true;
  const poll = async () => {
    if (!network) { networkPolling = false; return; }
    try {
      const query = new URLSearchParams({ roomId: network.roomId, clientId: network.clientId, since: String(network.sequence) });
      const data = await apiRequest(`/api/poll?${query}`);
      network.sequence = data.sequence;
      network.connected = data.connected;
      if (playMode === "online-host" && data.connected && !document.getElementById("lobby").classList.contains("hidden")) {
        resetGame();
        document.getElementById("lobby").classList.add("hidden");
        sendRoomMessage("state", game);
      }
      for (const message of data.messages) {
        if (message.sender === network.clientId) continue;
        if (playMode === "online-host" && message.type === "action") executeAction(other(localSide), message.payload);
        if (playMode === "online-guest" && message.type === "state") {
          game = message.payload;
          document.getElementById("lobby").classList.add("hidden");
          if (game.over) {
            let result = "DRAW — BOTH CORES DESTROYED";
            if (game[localSide].coreHp <= 0 && game[other(localSide)].coreHp > 0) result = "DEFEAT — YOUR CORE WAS DESTROYED";
            if (game[other(localSide)].coreHp <= 0 && game[localSide].coreHp > 0) result = "VICTORY — ENEMY CORE DESTROYED";
            setMessage(result);
            document.getElementById("restartButton").classList.remove("hidden");
          }
          refreshUI();
        }
      }
    } catch (error) {
      handleRoomClosed(error.message);
      return;
    }
    setTimeout(poll, 200);
  };
  poll();
}

function handleRoomClosed(message) {
  network = null;
  networkPolling = false;
  playMode = "menu";
  document.getElementById("lobby").classList.remove("hidden");
  showLobbyView("lobbyHome");
  lobbyError(message || "The room was closed.");
}

async function leaveRoom() {
  const current = network;
  network = null;
  networkPolling = false;
  if (current) {
    try { await apiRequest("/api/leave", { method: "POST", body: { roomId: current.roomId, clientId: current.clientId } }); } catch (_) {}
  }
  playMode = "menu";
  showLobbyView("lobbyHome");
}

document.getElementById("playAiButton").addEventListener("click", () => {
  playMode = "ai";
  localSide = Math.random() < 0.5 ? "player" : "enemy";
  resetGame();
  document.getElementById("lobby").classList.add("hidden");
});
document.getElementById("showCreateButton").addEventListener("click", () => showLobbyView("createView"));
document.getElementById("showJoinButton").addEventListener("click", () => showLobbyView("joinView"));
document.getElementById("showHowToPlayButton").addEventListener("click", () => showLobbyView("howToPlayView"));
document.querySelectorAll("[data-lobby-back]").forEach(button => button.addEventListener("click", () => showLobbyView("lobbyHome")));
document.getElementById("createRoomButton").addEventListener("click", createOnlineRoom);
document.getElementById("joinRoomButton").addEventListener("click", joinOnlineRoom);
document.getElementById("cancelRoomButton").addEventListener("click", leaveRoom);
document.getElementById("copyRoomButton").addEventListener("click", async () => {
  if (!network) return;
  try {
    await navigator.clipboard.writeText(network.roomId);
    document.getElementById("waitingMessage").textContent = "Room ID copied.";
  } catch (_) { document.getElementById("waitingMessage").textContent = `Room ID: ${network.roomId}`; }
});
document.getElementById("roomIdInput").addEventListener("input", event => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
document.getElementById("orientationButton").addEventListener("click", enterLandscapeMode);

if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) {
  document.getElementById("orientationMessage").textContent = "Turn your iPhone sideways to play.";
  document.getElementById("orientationButton").textContent = "TURN YOUR IPHONE SIDEWAYS";
}

function frame(time) {
  const dt = Math.min(0.05, (time - lastTime) / 1000);
  lastTime = time;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

resetGame();
requestAnimationFrame(frame);
