/**
 * =======================================================
 *  SERVIDOR DE NOTIFICACOES - Financas Compartilhadas
 *  Conecta ao Firestore em tempo real e envia push (FCM)
 *  + Telegram para todos os usuarios.
 *
 *  COMO USAR:
 *    1. Coloque serviceAccount.json nesta pasta
 *    2. Copie .env.example para .env e preencha
 *    3. npm install
 *    4. npm start
 *
 *  PRODUCAO (rodar 24/7 com PM2):
 *    npm install -g pm2
 *    pm2 start server.js --name financas-notif
 *    pm2 save && pm2 startup
 * =======================================================
 */
require('dotenv').config();
const admin = require('firebase-admin');
const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

// ── CONFIGURACAO ─────────────────────────────────────────
const CFG = {
  TELEGRAM_TOKEN   : process.env.TELEGRAM_BOT_TOKEN || '8794766706:AAEtC7rTdDu_T-8rHDdFyvV0g3LemReSLC0',
  APP_URL          : process.env.APP_URL            || 'https://financas-main-tau.vercel.app/',
  STATUS_PORT      : Number(process.env.STATUS_PORT || 3000),
  HORA_RESUMO      : Number(process.env.HORA_RESUMO || 8),   // 08:00 Brasilia
  DIAS_ANTECEDENCIA: 3,
  ADMIN_SECRET     : process.env.ADMIN_SECRET || 'luan2025',
};

// ── FIREBASE ADMIN ─────────────────────────────────────────
let svcAccount;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    svcAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log('Firebase: credencial via ENV');
  } else if (fs.existsSync(path.join(__dirname, 'serviceAccount.json'))) {
    svcAccount = require('./serviceAccount.json');
    console.log('Firebase: credencial via serviceAccount.json');
  } else {
    throw new Error('Configure FIREBASE_SERVICE_ACCOUNT no .env ou coloque serviceAccount.json aqui!');
  }
  admin.initializeApp({ credential: admin.credential.cert(svcAccount) });
  console.log('Firebase Admin inicializado!');
} catch (e) {
  console.error('ERRO CRITICO Firebase:', e.message);
  process.exit(1);
}

const db        = admin.firestore();
const messaging = admin.messaging();

// ── ESTADO ────────────────────────────────────────────────
const usersCache     = new Map();  // uid -> userData
const gruposOuvidos  = new Set();
let   resumoHoje     = null;
const stats = {
  iniciado   : new Date().toISOString(),
  enviadas   : 0,
  erros      : 0,
  ultimaCheck: null,
};

// ── UTILITARIOS ───────────────────────────────────────────
function hojeISO() {
  const d = new Date();
  d.setHours(d.getUTCHours() - 3);
  return d.toISOString().split('T')[0];
}
function horaBrasilia() {
  const d = new Date();
  return ((d.getUTCHours() - 3 + 24) % 24);
}
function diffDias(a, b) {
  return Math.round((new Date(b+'T00:00:00') - new Date(a+'T00:00:00')) / 86400000);
}
function ptBRL(v) {
  return Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
}
function ptData(s) {
  if (!s) return '-';
  const [y,m,d] = s.split('-');
  return `${d}/${m}/${y}`;
}
function lg(msg, t='info') {
  const h = new Date().toLocaleTimeString('pt-BR');
  const e = {info:'[i]',ok:'[+]',warn:'[!]',error:'[x]',send:'[>]'}[t]||'[-]';
  console.log(`${h} ${e} ${msg}`);
}

// ── TELEGRAM ─────────────────────────────────────────────
function sendTelegram(chatId, text) {
  return new Promise((ok, fail) => {
    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' });
    const req  = https.request({
      hostname: 'api.telegram.org',
      path    : `/bot${CFG.TELEGRAM_TOKEN}/sendMessage`,
      method  : 'POST',
      headers : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => {
      let d=''; r.on('data',c=>d+=c); r.on('end',()=>ok(d));
    });
    req.on('error', fail);
    req.setTimeout(10000, () => { req.destroy(); fail(new Error('timeout')); });
    req.write(body); req.end();
  });
}

// ── FCM PUSH ─────────────────────────────────────────────
async function sendFCM(token, title, body) {
  await messaging.send({
    token,
    notification: { title, body },
    data: { url: CFG.APP_URL },
    android: { priority: 'high', notification: { sound: 'default', channelId: 'financas', priority: 'high' } },
    apns:    { payload: { aps: { sound: 'default', badge: 1 } } },
  });
}

// ── NOTIFICAR UM USUARIO ──────────────────────────────────
async function notificar(uid, user, title, body) {
  if (user.notificationsEnabled === false) return 0;
  let n = 0;
  if (user.fcmToken) {
    try {
      await sendFCM(user.fcmToken, title, body);
      lg(`FCM -> ${user.email||uid}`, 'send');
      n++;
    } catch (e) {
      if (e.code?.includes('registration-token')) {
        await db.collection('users').doc(uid).update({ fcmToken: null }).catch(()=>{});
      }
      lg(`FCM erro ${user.email}: ${e.message}`, 'error');
      stats.erros++;
    }
  }
  if (user.telegramChatId) {
    try {
      await sendTelegram(user.telegramChatId, `*${title}*\n\n${body}`);
      lg(`Telegram -> ${user.email||uid}`, 'send');
      n++;
    } catch (e) {
      lg(`Telegram erro ${user.email}: ${e.message}`, 'error');
      stats.erros++;
    }
  }
  stats.enviadas += n;
  return n;
}

// ── CHECAR VENCIMENTOS DE UM GRUPO ───────────────────────
async function checarGrupo(groupId) {
  const hoje = hojeISO();
  const limite = new Date(hoje+'T00:00:00');
  limite.setDate(limite.getDate() + CFG.DIAS_ANTECEDENCIA);
  const limiteStr = limite.toISOString().split('T')[0];

  const col = groupId
    ? db.collection('grupos').doc(groupId).collection('despesas')
    : db.collection('despesas');
  const snap = await col.get();

  const vencidas = [], hoje_list = [], breve = [];
  snap.forEach(doc => {
    const d = doc.data();
    let pago = d.pago;
    if (d.vencimento && d.ajustesMensais) {
      const mk = d.vencimento.substring(0,7);
      if (d.ajustesMensais[mk]?.pago === true) pago = true;
    }
    if (pago || !d.vencimento) return;
    const v = d.vencimento;
    if      (v < hoje)       { const dias = Math.abs(diffDias(hoje,v)); if (dias<=7) vencidas.push({...d,dias}); }
    else if (v === hoje)      { hoje_list.push(d); }
    else if (v <= limiteStr) { breve.push({...d,dias:diffDias(hoje,v)}); }
  });

  return { vencidas, hoje_list, breve };
}

// ── MONTAR MENSAGEM ───────────────────────────────────────
function montarMsg({vencidas, hoje_list, breve}) {
  const l = [];
  if (vencidas.length)  { l.push(`🚨 *VENCIDAS (${vencidas.length}):*`);  vencidas.forEach(d=>l.push(`  • ${d.descricao}${d.valor?` - ${ptBRL(d.valor)}`:''} _(${d.dias}d atraso)_`));  l.push(''); }
  if (hoje_list.length) { l.push(`⚠️ *VENCE HOJE (${hoje_list.length}):*`); hoje_list.forEach(d=>l.push(`  • ${d.descricao}${d.valor?` - ${ptBRL(d.valor)}`:''}`)); l.push(''); }
  if (breve.length)     { l.push(`📅 *NOS PROXIMOS ${CFG.DIAS_ANTECEDENCIA} DIAS (${breve.length}):*`); breve.forEach(d=>l.push(`  • ${d.descricao}${d.valor?` - ${ptBRL(d.valor)}`:''} _(${ptData(d.vencimento)})_`)); }
  return l.join('\n');
}

// ── RESUMO DIARIO ─────────────────────────────────────────
async function resumoDiario() {
  const hoje = hojeISO();
  if (resumoHoje === hoje) return;
  resumoHoje = hoje;
  lg('Iniciando resumo diario...', 'info');

  const gruposFeitos = new Set();
  for (const [uid, user] of usersCache) {
    if (!user.fcmToken && !user.telegramChatId) continue;
    const key = user.groupId || uid;
    if (gruposFeitos.has(key)) continue;
    gruposFeitos.add(key);

    try {
      const r = await checarGrupo(user.groupId);
      const total = r.vencidas.length + r.hoje_list.length + r.breve.length;

      // Notifica todos os membros do grupo
      const membros = [...usersCache.entries()].filter(([,u])=>(u.groupId||u.uid)===key);
      for (const [mUid, mUser] of membros) {
        if (total === 0) {
          await notificar(mUid, mUser, '✅ Tudo em dia!', `Nenhuma conta vencendo nos proximos ${CFG.DIAS_ANTECEDENCIA} dias. Otimo trabalho! 💪`);
        } else {
          const urgente = r.vencidas.length > 0 || r.hoje_list.length > 0;
          await notificar(mUid, mUser, urgente ? '⚠️ Contas pendentes!' : '📅 Resumo de Contas', montarMsg(r));
        }
      }
    } catch (e) {
      lg(`Erro no grupo ${key}: ${e.message}`, 'error');
    }
  }

  stats.ultimaCheck = new Date().toISOString();
  lg('Resumo diario concluido!', 'ok');
}

// ── VERIFICACAO URGENTE (TEMPO REAL) ─────────────────────
async function verificarUrgente(groupId, uid, user) {
  if (!user.fcmToken && !user.telegramChatId) return;
  try {
    const r = await checarGrupo(groupId);
    if (r.hoje_list.length > 0) {
      const nomes = r.hoje_list.map(d=>d.descricao).join(', ');
      await notificar(uid, user, '⚠️ Conta vence HOJE!', `Nao esqueca: ${nomes} vence hoje!`);
    }
    if (r.vencidas.length > 0) {
      const d = r.vencidas[0];
      await notificar(uid, user, '🚨 Conta em atraso!', `"${d.descricao}" esta vencida ha ${d.dias} dia(s). Regularize agora!`);
    }
  } catch(e) { lg(`Erro urgente: ${e.message}`, 'error'); }
}

// ── LISTENER USUARIOS ─────────────────────────────────────
function ouvirUsuarios() {
  lg('Ouvindo usuarios...', 'info');
  db.collection('users').onSnapshot(snap => {
    snap.docChanges().forEach(c => {
      const uid = c.doc.id, data = c.doc.data();
      if (c.type === 'removed') { usersCache.delete(uid); return; }
      usersCache.set(uid, {...data, uid});
      if (c.type === 'modified') verificarUrgente(data.groupId, uid, data).catch(()=>{});
    });
    lg(`Cache: ${usersCache.size} usuarios`, 'info');
  }, e => {
    lg(`Erro listener users: ${e.message}`, 'error');
    setTimeout(ouvirUsuarios, 30000);
  });
}

// ── LISTENER DESPESAS POR GRUPO ───────────────────────────
function ouvirGrupo(groupId) {
  if (gruposOuvidos.has(groupId)) return;
  gruposOuvidos.add(groupId);
  const hoje = hojeISO();
  db.collection('grupos').doc(groupId).collection('despesas')
    .onSnapshot(snap => {
      const changes = snap.docChanges().filter(c => c.type !== 'removed');
      if (!changes.length) return;
      const relevante = changes.some(c => {
        const d = c.doc.data();
        return d.vencimento >= hoje && !d.pago;
      });
      if (!relevante) return;
      [...usersCache.entries()]
        .filter(([,u])=>u.groupId===groupId)
        .forEach(([uid,user])=>verificarUrgente(groupId,uid,user).catch(()=>{}));
    }, e => {
      lg(`Erro grupo ${groupId}: ${e.message}`, 'error');
      gruposOuvidos.delete(groupId);
      setTimeout(()=>ouvirGrupo(groupId), 60000);
    });
  lg(`Ouvindo grupo: ${groupId}`, 'ok');
}

// ── AGENDAMENTO ───────────────────────────────────────────
function agendarResumo() {
  setInterval(() => {
    if (horaBrasilia() === CFG.HORA_RESUMO) {
      resumoDiario().catch(e=>lg(`Erro resumo: ${e.message}`,'error'));
    }
  }, 60000);
  lg(`Resumo diario agendado: ${CFG.HORA_RESUMO}:00 (Brasilia)`, 'ok');
}

// ── SERVIDOR HTTP STATUS ──────────────────────────────────
function statusHTML() {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Financas Notif</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px}
h1{color:#6366f1;font-size:22px;margin-bottom:6px}p{color:#64748b;font-size:13px;margin-bottom:20px}
.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px}
.c{background:#1e293b;border-radius:10px;padding:16px;border:1px solid #334155}
.cl{font-size:11px;color:#64748b;margin-bottom:4px}.cv{font-size:22px;font-weight:700;color:#6366f1}
.cv.g{color:#22c55e;display:block}.cv.r{color:#ef4444;display:block}
.btn{padding:10px 18px;border-radius:8px;border:none;cursor:pointer;font-size:13px;font-weight:600;margin:4px}
.bp{background:#6366f1;color:#fff}.bg{background:#16a34a;color:#fff}.br{background:#dc2626;color:#fff}
.res{background:#1e293b;border-radius:8px;padding:14px;margin-top:14px;font-size:12px;border:1px solid #334155;white-space:pre-wrap;color:#94a3b8;max-height:400px;overflow-y:auto}
</style></head><body>
<h1>💰 Servidor de Notificacoes</h1><p>Financas Compartilhadas — Tempo real</p>
<div class="g">
  <div class="c"><div class="cl">Status</div><div class="cv g" id="st">Online ✅</div></div>
  <div class="c"><div class="cl">Usuarios</div><div class="cv" id="us">—</div></div>
  <div class="c"><div class="cl">Grupos</div><div class="cv" id="gr">—</div></div>
  <div class="c"><div class="cl">Enviadas</div><div class="cv" id="en">—</div></div>
  <div class="c"><div class="cl">Erros</div><div class="cv r" id="er">—</div></div>
  <div class="c"><div class="cl">Ultima check</div><div class="cv" style="font-size:12px" id="uc">—</div></div>
</div>
<button class="btn bg" onclick="acao('/resumo')">📨 Enviar Resumo</button>
<button class="btn bp" onclick="atualizar()">🔄 Atualizar</button>
<div class="res" id="res">Aguardando...</div>
<script>
const S=prompt('Senha admin:')||'luan2025';
async function atualizar(){
  const r=await fetch('/status');const d=await r.json();
  document.getElementById('us').textContent=d.usuarios;
  document.getElementById('gr').textContent=d.grupos;
  document.getElementById('en').textContent=d.enviadas;
  document.getElementById('er').textContent=d.erros;
  document.getElementById('uc').textContent=d.ultimaCheck?new Date(d.ultimaCheck).toLocaleString('pt-BR'):'—';
  document.getElementById('res').textContent=JSON.stringify(d,null,2);
}
async function acao(url){
  document.getElementById('res').textContent='Processando...';
  const r=await fetch(url,{method:'POST',body:JSON.stringify({secret:S}),headers:{'Content-Type':'application/json'}});
  document.getElementById('res').textContent=JSON.stringify(await r.json(),null,2);
  atualizar();
}
atualizar();setInterval(atualizar,30000);
</script></body></html>`;
}

function iniciarHTTP() {
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost`);
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'GET' && url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html;charset=utf-8');
      return res.end(statusHTML());
    }

    if (req.method === 'GET' && url.pathname === '/status') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({
        status: 'online', ...stats,
        usuarios: usersCache.size, grupos: gruposOuvidos.size,
      }));
    }

    // POST endpoints — precisam do secret
    let body = '';
    req.on('data', c => body += c);
    await new Promise(r => req.on('end', r));

    let payload = {};
    try { payload = JSON.parse(body || '{}'); } catch {}

    if (payload.secret !== CFG.ADMIN_SECRET) {
      res.writeHead(401);
      return res.end(JSON.stringify({ error: 'Unauthorized' }));
    }

    res.setHeader('Content-Type', 'application/json');

    if (url.pathname === '/resumo') {
      resumoHoje = null;
      await resumoDiario();
      return res.end(JSON.stringify({ success: true, msg: 'Resumo enviado!' }));
    }

    if (url.pathname === '/notify') {
      const { titulo, corpo, groupId } = payload;
      if (!titulo || !corpo) { res.writeHead(400); return res.end(JSON.stringify({error:'titulo e corpo obrigatorios'})); }
      let total = 0;
      for (const [uid, user] of usersCache) {
        if (groupId && user.groupId !== groupId) continue;
        total += await notificar(uid, user, titulo, corpo);
      }
      return res.end(JSON.stringify({ success: true, enviadas: total }));
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  srv.listen(CFG.STATUS_PORT, () => lg(`Painel: http://localhost:${CFG.STATUS_PORT}`, 'ok'));
}

// ── MAIN ──────────────────────────────────────────────────
async function main() {
  console.log('\n================================================');
  console.log('  SERVIDOR DE NOTIFICACOES — FINANCAS v2.0');
  console.log('================================================\n');

  ouvirUsuarios();
  await new Promise(r => setTimeout(r, 2500));

  // Iniciar listeners de grupos
  for (const [, user] of usersCache) {
    if (user.groupId) ouvirGrupo(user.groupId);
  }
  setInterval(() => {
    for (const [, user] of usersCache) {
      if (user.groupId) ouvirGrupo(user.groupId);
    }
  }, 30000);

  agendarResumo();
  iniciarHTTP();

  lg('Servidor rodando! Monitorando Firestore em tempo real.', 'ok');
  process.on('SIGTERM', () => { lg('Encerrando...', 'warn'); process.exit(0); });
}

main().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
