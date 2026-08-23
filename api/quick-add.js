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
  if (!str) return undefined;
  if (/^\[(SEU_UID|SEU_GROUP_ID|Escolha da Lista|Entrada Fornecida)[^\]]*\]$/i.test(str)) {
    return undefined;
  }
  return str;
}

function normalizarTexto(txt) {
  return String(txt || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/gi, " ")
    .trim();
}

function ehDocumentoDeCartao(data) {
  if (!data) return false;
  const cat = String(data.categoria || "").trim();
  const sub = String(data.subcategoria || "").trim();
  const desc = normalizarTexto(data.descricao);
  const cartaoNome = normalizarTexto(data.cartaoNome);

  if (cat === "Cartões" || cat === "Cartoes" || cat === "Assinaturas" || Boolean(data.isAssinatura)) return true;
  if (sub === "Assinatura" || sub === "Cartão" || sub === "Cartao") return true;
  if (cartaoNome || desc.includes("cartao") || desc.includes("nubank") || desc.includes("itau") || desc.includes("santander") || desc.includes("bradesco") || desc.includes("inter") || desc.includes("caixa") || desc.includes("carrefour") || desc.includes("riachuelo") || desc.includes("renner") || desc.includes("mercado") || desc.includes("c&a") || desc.includes("bb")) return true;

  return false;
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

  const params = { ...(req.query || {}), ...(req.body || {}) };
  const { uid, groupId, categoria, cartao, valor, descricao, data, dispositivo, observacao } = params;

  if (!uid || !groupId) {
    return res.status(401).json({ ok: false, erro: "UID e groupId sao obrigatorios." });
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

  // Modo "listas": devolve os cartões do cliente em texto puro (uma por linha)
  const acao = String(params.acao || "");
  if (acao === "cartoes") {
    try {
      const snapshot = await db.collection('grupos')
        .doc(groupId)
        .collection('despesas')
        .get();

      const nomes = [...new Set(
        snapshot.docs
          .filter(d => ehDocumentoDeCartao(d.data()))
          .map(d => String(d.data().descricao || "").trim())
          .filter(Boolean)
      )].sort((a, b) => a.localeCompare(b, 'pt-BR'));

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(200).send(nomes.length ? nomes.join('\n') : 'Nenhum cartão encontrado');
    } catch (e) {
      return res.status(500).json({ ok: false, erro: "Erro ao listar cartões: " + e.message });
    }
  }

  if (!valor || isNaN(parseFloat(String(valor).replace(',', '.')))) {
    const temPlaceholder = /\[[^\]]*\]/.test(String(valor));
    return res.status(400).json({ ok: false, erro: temPlaceholder ? "Preencha o campo [valor] no atalho antes de usar." : "Valor invalido." });
  }

  const valorNumerico = parseFloat(String(valor).replace(',', '.'));

  if (valorNumerico <= 0) {
    return res.status(400).json({ ok: false, erro: "Valor deve ser maior que zero." });
  }

function adicionarMesAoYyyyMm(yyyyMm, quantidade) {
  if (!yyyyMm) return "";
  const [ano, mes] = yyyyMm.split("-").map(Number);
  const data = new Date(ano, (mes - 1) + Number(quantidade || 0), 1);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}`;
}

function calcularValorParcelaCompra(valorTotal, parcelaAtual, parcelaTotal) {
  const totalCentavos = Math.round(Number(valorTotal || 0) * 100);
  const totalParcelas = Math.max(1, Number(parcelaTotal || 1));
  const indiceParcela = Math.max(1, Number(parcelaAtual || 1));
  const base = Math.floor(totalCentavos / totalParcelas);
  const resto = totalCentavos % totalParcelas;
  const valorCentavos = base + (indiceParcela <= resto ? 1 : 0);
  return Number((valorCentavos / 100).toFixed(2));
}

  const dataFinal = data || getTodayISO();
  const mesFinal = dataFinal.substring(0, 7);
  const categoriaFinal = categoria || "Outros";

  const cartaoFinal = limparPlaceholder(cartao);
  const descricaoFinal = limparPlaceholder(descricao) || limparPlaceholder(params.nome);
  const observacaoFinal = limparPlaceholder(observacao) || "";
  const dispositivoFinal = limparPlaceholder(dispositivo) || "iPhone Atalho";

  const numParcelas = Math.max(1, parseInt(String(params.parcelas || params.parcela || 1)) || 1);
  const grupoParcelaId = "compra_" + Date.now() + "_" + Math.random().toString(36).substr(2, 4);
  const nomeFinalCompra = descricaoFinal || categoriaFinal || "Compra";

  // Gera a lista de compras (à vista ou parceladas)
  const listaNovasCompras = [];
  if (categoriaFinal === "Assinatura") {
    for (let i = 0; i < 12; i++) {
      const mesDest = adicionarMesAoYyyyMm(mesFinal, i);
      listaNovasCompras.push({
        id: grupoParcelaId,
        parcelamentoId: "",
        nome: nomeFinalCompra,
        categoria: "Assinatura",
        valor: valorNumerico,
        valorTotal: valorNumerico,
        parcelaAtual: 1,
        parcelaTotal: 1,
        mesOrigem: mesFinal,
        mesDestino: mesDest,
        repetirMensal: true
      });
    }
  } else {
    for (let i = 0; i < numParcelas; i++) {
      const mesDest = adicionarMesAoYyyyMm(mesFinal, i);
      const vParc = calcularValorParcelaCompra(valorNumerico, i + 1, numParcelas);
      listaNovasCompras.push({
        id: grupoParcelaId + "_" + (i + 1),
        parcelamentoId: numParcelas > 1 ? grupoParcelaId : "",
        nome: nomeFinalCompra,
        categoria: categoriaFinal,
        valor: vParc,
        valorTotal: valorNumerico,
        parcelaAtual: i + 1,
        parcelaTotal: numParcelas,
        mesOrigem: mesFinal,
        mesDestino: mesDest
      });
    }
  }

  const primeiraCompra = listaNovasCompras[0];

  try {
    // 1. Procura se o cartão já existe no grupo (busca inteligente)
    const despesasSnap = await db.collection('grupos')
      .doc(groupId)
      .collection('despesas')
      .get();

    let cartaoDoc = null;
    const buscaNome = (cartaoFinal || "").trim();

    if (buscaNome) {
      const buscaNorm = normalizarTexto(buscaNome);
      const palavrasBusca = buscaNorm.replace(/\b(cartao|de|credito|da|do)\b/g, "").split(/\s+/).filter(p => p.length >= 2);

      cartaoDoc = despesasSnap.docs.find(d => {
        const data = d.data();
        if (!ehDocumentoDeCartao(data)) return false;

        const descNorm = normalizarTexto(data.descricao);
        const cNomeNorm = normalizarTexto(data.cartaoNome);

        if (descNorm.includes(buscaNorm) || cNomeNorm.includes(buscaNorm) || buscaNorm.includes(descNorm)) {
          return true;
        }

        if (palavrasBusca.length > 0 && palavrasBusca.every(p => descNorm.includes(p) || cNomeNorm.includes(p))) {
          return true;
        }

        return false;
      });
    }

    if (cartaoDoc) {
      // 2. Se o cartão JÁ EXISTE, adiciona a compra/parcelas no cartão!
      const cardData = cartaoDoc.data();
      const ajustesMensais = cardData.ajustesMensais || {};

      listaNovasCompras.forEach(compraObj => {
        const mDest = compraObj.mesDestino || mesFinal;
        const ajusteMes = ajustesMensais[mDest] || {};
        const comprasMes = Array.isArray(ajusteMes.compras) ? [...ajusteMes.compras] : [];
        comprasMes.push(compraObj);
        ajustesMensais[mDest] = {
          ...ajusteMes,
          compras: comprasMes
        };
      });

      const comprasGlobais = Array.isArray(cardData.compras)
        ? [...cardData.compras, primeiraCompra]
        : [primeiraCompra];

      await cartaoDoc.ref.update({
        vencimento: "",
        compras: comprasGlobais,
        ajustesMensais: ajustesMensais,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      const textoParcelas = numParcelas > 1 ? ` (${numParcelas}x de R$ ${primeiraCompra.valor.toFixed(2).replace('.', ',')})` : " (À vista)";

      return res.status(200).json({
        ok: true,
        id: cartaoDoc.id,
        mensagem: `✅ "${nomeFinalCompra}" adicionado ao ${cardData.descricao || cartaoFinal}! ${categoriaFinal}${textoParcelas} - R$ ${valorNumerico.toFixed(2).replace('.', ',')}`,
        despesa: {
          id: cartaoDoc.id,
          nome: nomeFinalCompra,
          cartao: cardData.descricao,
          categoria: categoriaFinal,
          valor: valorNumerico,
          parcelas: numParcelas,
          data: dataFinal
        }
      });

    } else {
      // 3. Se o cartão NÃO existe ainda, cria um novo cartão com as parcelas inseridas
      const ajustesMensais = {};
      listaNovasCompras.forEach(compraObj => {
        const mDest = compraObj.mesDestino || mesFinal;
        ajustesMensais[mDest] = {
          compras: [compraObj]
        };
      });

      const novaDespesaCartao = {
        descricao: cartaoFinal ? (cartaoFinal.toLowerCase().startsWith("cartão") ? cartaoFinal : `Cartão ${cartaoFinal}`) : 'Cartão de Crédito',
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
        compras: [primeiraCompra],
        ajustesMensais: ajustesMensais,
        cartaoNome: cartaoFinal || '',
        criadoVia: dispositivoFinal === "iPhone Atalho" ? 'atalho-ios' : `atalho-ios (${dispositivoFinal})`,
        criadoPor: uid,
        criadoEm: admin.firestore.FieldValue.serverTimestamp()
      };

      const ref = await db.collection('grupos')
        .doc(groupId)
        .collection('despesas')
        .add(novaDespesaCartao);

      const textoParcelas = numParcelas > 1 ? ` (${numParcelas}x de R$ ${primeiraCompra.valor.toFixed(2).replace('.', ',')})` : " (À vista)";

      return res.status(200).json({
        ok: true,
        id: ref.id,
        mensagem: `✅ Novo cartão criado e "${nomeFinalCompra}" salvo! ${categoriaFinal}${textoParcelas} - R$ ${valorNumerico.toFixed(2).replace('.', ',')}`,
        despesa: {
          id: ref.id,
          nome: nomeFinalCompra,
          descricao: novaDespesaCartao.descricao,
          categoria: categoriaFinal,
          valor: valorNumerico,
          parcelas: numParcelas,
          data: dataFinal
        }
      });
    }

  } catch (e) {
    console.error("Erro ao salvar despesa no cartão:", e);
    return res.status(500).json({ ok: false, erro: "Erro ao salvar: " + e.message });
  }
};
