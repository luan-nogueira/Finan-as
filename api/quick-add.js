const admin = require('firebase-admin');

// Inicializa o Firebase Admin usando a chave secreta
if (!admin.apps.length) {
  try {
    const rawKey = process.env.FIREBASE_SERVICE_ACCOUNT || process.env['CONTA_DE_SERVIÇO_FIREBASE'];
    if (rawKey) {
      const serviceAccount = JSON.parse(rawKey);
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
  } catch (error) {
    console.error("Erro ao inicializar Firebase Admin:", error);
  }
}

let db = null;
if (admin.apps.length > 0) {
  db = admin.firestore();
}

function getTodayISO() {
  const d = new Date();
  d.setHours(d.getHours() - 3);
  return d.toISOString().split('T')[0];
}

function getMesAtual() {
  return getTodayISO().substring(0, 7);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!db && admin.apps.length > 0) {
    db = admin.firestore();
  }

  if (!db) {
    return res.status(500).json({ ok: false, erro: "Firebase nao configurado." });
  }

  const params = req.method === 'GET' ? req.query : (req.body || {});
  const { uid, groupId, categoria, cartao, valor, descricao } = params;

  if (!uid || !groupId) {
    return res.status(401).json({ ok: false, erro: "UID e groupId sao obrigatorios." });
  }

  if (!valor || isNaN(parseFloat(String(valor).replace(',', '.')))) {
    return res.status(400).json({ ok: false, erro: "Valor invalido." });
  }

  const valorNumerico = parseFloat(String(valor).replace(',', '.'));

  if (valorNumerico <= 0) {
    return res.status(400).json({ ok: false, erro: "Valor deve ser maior que zero." });
  }

  try {
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) {
      return res.status(403).json({ ok: false, erro: "Usuario nao encontrado." });
    }
    const userData = userDoc.data();
    if (userData.groupId !== groupId) {
      return res.status(403).json({ ok: false, erro: "Acesso negado ao grupo." });
    }
  } catch (e) {
    return res.status(500).json({ ok: false, erro: "Erro ao verificar usuario: " + e.message });
  }

  const hoje = getTodayISO();
  const mes = getMesAtual();

  const novaDespesa = {
    descricao: descricao || (cartao ? `Cartão ${cartao}` : 'Despesa via Atalho'),
    categoria: 'Cartões',
    subcategoria: categoria || 'Outros',
    valor: valorNumerico,
    vencimento: hoje,
    pago: false,
    isAssinatura: false,
    mesReferencia: mes,
    historico: true,
    compras: [
      {
        nome: descricao || categoria || 'Compra',
        valor: valorNumerico,
        parcelas: 1,
        categoria: categoria || 'Outros',
        cartaoNome: cartao || '',
        mes: mes,
        criadoEm: new Date().toISOString()
      }
    ],
    cartaoNome: cartao || '',
    criadoVia: 'atalho-ios',
    criadoPor: uid,
    criadoEm: admin.firestore.FieldValue.serverTimestamp()
  };

  try {
    const ref = await db.collection('grupos')
      .doc(groupId)
      .collection('despesas')
      .add(novaDespesa);

    return res.status(200).json({
      ok: true,
      id: ref.id,
      mensagem: "Despesa salva com sucesso! " + (categoria || '') + " - R$ " + valorNumerico.toFixed(2).replace('.', ','),
      despesa: {
        id: ref.id,
        descricao: novaDespesa.descricao,
        categoria: novaDespesa.subcategoria,
        cartao: cartao || '',
        valor: valorNumerico,
        data: hoje
      }
    });

  } catch (e) {
    console.error("Erro ao salvar despesa:", e);
    return res.status(500).json({ ok: false, erro: "Erro ao salvar: " + e.message });
  }
};
