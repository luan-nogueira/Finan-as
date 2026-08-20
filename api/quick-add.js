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

function limparPlaceholder(valor) {
  const str = String(valor || "").trim();
  if (!str || str.includes("[") || str.includes("]")) return undefined;
  return str;
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
  const { uid, groupId, categoria, cartao, valor, descricao, data, dispositivo, observacao } = params;

  if (!uid || !groupId) {
    return res.status(401).json({ ok: false, erro: "UID e groupId sao obrigatorios." });
  }

if (!valor || isNaN(parseFloat(String(valor).replace(',', '.')))) {
    const temPlaceholder = /\[[^\]]*\]/.test(String(valor));
    return res.status(400).json({ ok: false, erro: temPlaceholder ? "Preencha o campo [valor] no atalho antes de usar." : "Valor invalido." });
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

// Usa data enviada pelo Atalho (ex: AAAA-MM-DD) ou a data atual (Fuso Brasília)
  const dataFinal = (data && /^\d{4}-\d{2}-\d{2}$/.test(data)) ? data : getTodayISO();
  const mesFinal = dataFinal.substring(0, 7);

  // Placeholders como [Escolha]/[Entrada] viram valores vazios (cliente colou a URL sem preencher)
  const categoriaFinal = limparPlaceholder(categoria) || "Outros";
  const cartaoFinal = limparPlaceholder(cartao);
  const descricaoFinal = limparPlaceholder(descricao);
  const observacaoFinal = limparPlaceholder(observacao) || "";
  const dispositivoFinal = limparPlaceholder(dispositivo) || "iPhone Atalho";

  const novaDespesa = {
    descricao: descricaoFinal || (cartaoFinal ? `Cartão ${cartaoFinal}` : 'Despesa via Atalho'),
    categoria: 'Cartões',
    subcategoria: categoriaFinal,
    valor: valorNumerico,
    vencimento: dataFinal,
    observacao: observacaoFinal,
    dispositivo: dispositivoFinal,
    pago: false,
    isAssinatura: false,
    mesReferencia: mesFinal,
    historico: true,
    compras: [
      {
        nome: descricaoFinal || categoriaFinal || 'Compra',
        valor: valorNumerico,
        parcelas: 1,
        categoria: categoriaFinal,
        cartaoNome: cartaoFinal || '',
        mes: mesFinal,
        criadoEm: new Date().toISOString()
      }
    ],
    cartaoNome: cartaoFinal || '',
    criadoVia: dispositivoFinal === "iPhone Atalho" ? 'atalho-ios' : `atalho-ios (${dispositivoFinal})`,
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
      mensagem: "Despesa salva com sucesso! " + (categoriaFinal || '') + " - R$ " + valorNumerico.toFixed(2).replace('.', ','),
      despesa: {
        id: ref.id,
        descricao: novaDespesa.descricao,
        categoria: novaDespesa.subcategoria,
        cartao: cartaoFinal || '',
        valor: valorNumerico,
        data: dataFinal
      }
    });

  } catch (e) {
    console.error("Erro ao salvar despesa:", e);
    return res.status(500).json({ ok: false, erro: "Erro ao salvar: " + e.message });
  }
};
