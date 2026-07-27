const admin = require('firebase-admin');
const https = require('https');

// Inicializa o Firebase Admin usando a chave secreta colocada na Vercel
if (!admin.apps.length) {
  try {
    const rawKey = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.CONTA_DE_SERVIÇO_FIREBASE;
    if (rawKey) {
      const serviceAccount = JSON.parse(rawKey);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    } else {
      console.warn("Chave FIREBASE_SERVICE_ACCOUNT não encontrada nas variáveis de ambiente.");
    }
  } catch (error) {
    console.error("Erro ao inicializar Firebase Admin:", error);
  }
}

let db = null;
if (admin.apps.length > 0) {
  db = admin.firestore();
}

// Funções Utilitárias de Formatação
function formatarMoeda(valor) {
  return Number(valor).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarDataBR(dateStr) {
  if (!dateStr) return "-";
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

function getMesReferenciaAtual() {
  const d = new Date();
  d.setHours(d.getHours() - 3); // Fuso de Brasília
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function getTodayISO() {
  const d = new Date();
  d.setHours(d.getHours() - 3);
  return d.toISOString().split('T')[0];
}

function formatarMesTitulo(mesStr) {
  const meses = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const [ano, mes] = mesStr.split('-');
  return `${meses[parseInt(mes) - 1]} de ${ano}`;
}

// Helper para Envio de Mensagem no Telegram
function sendMessage(chatId, text) {
  const token = '8794766706:AAEtC7rTdDu_T-8rHDdFyvV0g3LemReSLC0';
  const data = JSON.stringify({
    chat_id: chatId,
    text: text,
    parse_mode: 'Markdown'
  });

  const options = {
    hostname: 'api.telegram.org',
    port: 443,
    path: `/bot${token}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        console.log("Telegram API Response:", body);
        resolve(body);
      });
    });
    req.on('error', (e) => reject(e));
    req.write(data);
    req.end();
  });
}

module.exports = async (req, res) => {
  if (!db && admin.apps.length > 0) {
    db = admin.firestore();
  }

  if (!db) {
    console.error("Firebase Admin não inicializado. Verifique a variável FIREBASE_SERVICE_ACCOUNT.");
    if (req.method === 'GET') {
      return res.status(500).json({ error: "Firebase Admin não inicializado. Configure a variável FIREBASE_SERVICE_ACCOUNT nas configurações da Vercel." });
    }
    return res.status(200).send('Firebase not initialized');
  }

  // Configuração Automática de Webhook via GET
  if (req.method === 'GET') {
    const token = '8794766706:AAEtC7rTdDu_T-8rHDdFyvV0g3LemReSLC0';
    const host = req.headers.host;
    const webhookUrl = `https://${host}/api/telegram-bot`;
    const url = `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
    
    return new Promise((resolve) => {
      https.get(url, (response) => {
        let body = '';
        response.on('data', (chunk) => body += chunk);
        response.on('end', () => {
          res.status(200).json({
            message: "Webhook setup attempt complete",
            url: webhookUrl,
            telegramResponse: JSON.parse(body)
          });
          resolve();
        });
      }).on('error', (e) => {
        res.status(500).json({ error: e.message });
        resolve();
      });
    });
  }

  // Tratamento dos updates enviados pelo Telegram (POST)
  if (req.method === 'POST') {
    try {
      const update = req.body;
      if (!update || !update.message) {
        return res.status(200).send('No message received');
      }

      const chat = update.message.chat;
      const text = (update.message.text || '').trim();

      // 1. Tratamento do comando de Vínculo (/start <UID>)
      if (text.startsWith('/start')) {
        const parts = text.split(' ');
        const uid = parts[1];

        if (!uid) {
          // Welcome default message
          const welcome = `👋 *Olá! Eu sou o Bot do Finanças Compartilhadas!*\n\n` +
                          `Para usar meus comandos, você precisa primeiro vincular seu Telegram ao aplicativo.\n\n` +
                          `Acesse o site, abra as *Configurações*, clique no botão *Vincular Telegram* e eu cuidarei do resto.`;
          await sendMessage(chat.id, welcome);
          return res.status(200).send('OK');
        }

        try {
          const userRef = db.collection("users").doc(uid);
          const userDoc = await userRef.get();

          if (!userDoc.exists) {
            await sendMessage(chat.id, `⚠️ Desculpe, não encontrei um usuário correspondente no banco de dados. Por favor, clique novamente no botão no site.`);
            return res.status(200).send('OK');
          }

          // Salva o chat ID do Telegram
          await userRef.update({
            telegramChatId: chat.id
          });

          const successMsg = `🎉 *Vínculo realizado com sucesso!*\n\n` +
                             `Seu Telegram está conectado à sua conta do Finanças Compartilhadas.\n\n` +
                             `*Comandos disponíveis:*\n` +
                             `📊 /resumo - Resumo geral do mês\n` +
                             `🛑 /pendentes - Listar contas pendentes\n` +
                             `✅ /pagos - Listar contas pagas\n` +
                             `⚠️ /vencendo - Contas vencendo em breve\n` +
                             `🚨 /vencidas - Contas vencendo/vencidas`;

          await sendMessage(chat.id, successMsg);
          return res.status(200).send('OK');
        } catch (e) {
          console.error("Erro ao vincular usuário:", e);
          await sendMessage(chat.id, `Erro ao processar vínculo: ${e.message}`);
          return res.status(200).send('OK');
        }
      }

      // 2. Comandos de Consulta (Resumo, Pendentes, Pagos, etc.)
      const usersSnapshot = await db.collection("users").where("telegramChatId", "==", chat.id).limit(1).get();
      if (usersSnapshot.empty) {
        await sendMessage(chat.id, `⚠️ *Atenção:* Seu Telegram ainda não está vinculado a uma conta do app.\n\n` +
                                   `Acesse as *Configurações* no site e clique em *Vincular Telegram* para configurar!`);
        return res.status(200).send('OK');
      }

      const userData = usersSnapshot.docs[0].data();
      const groupId = userData.groupId;
      const mesAtual = getMesReferenciaAtual();

      // Busca despesas
      let despesasSnapshot;
      if (groupId) {
        despesasSnapshot = await db.collection("grupos").doc(groupId).collection("despesas").get();
      } else {
        despesasSnapshot = await db.collection("despesas").get();
      }

      const despesas = [];
      despesasSnapshot.forEach(d => {
        const data = d.data();
        const vencimento = data.vencimento;
        if (!vencimento) return;

        // Logic to determine if bill belongs to mesAtual
        let shouldInclude = false;
        const startMonth = vencimento.substring(0, 7);

        if (data.mesReferencia === mesAtual) {
          shouldInclude = true;
        } else if (!data.mesReferencia) {
          if (data.historico) {
            if (startMonth === mesAtual) shouldInclude = true;
          } else if (startMonth <= mesAtual) {
            if (!data.mesesIgnorados || !data.mesesIgnorados.includes(mesAtual)) {
              // Check parcelas
              let isValidParcela = true;
              if (data.parcelaAtual && data.parcelaTotal) {
                 const [sy, sm] = startMonth.split('-').map(Number);
                 const [cy, cm] = mesAtual.split('-').map(Number);
                 const diffMonths = (cy - sy) * 12 + (cm - sm);
                 if (data.parcelaAtual + diffMonths > data.parcelaTotal) {
                    isValidParcela = false;
                 }
              }
              if (isValidParcela) shouldInclude = true;
            }
          }
        }

        if (shouldInclude) {
          let isPago = data.pago;
          let valor = Number(data.valor) || 0;
          let descricao = data.descricao;

          // Aplica ajustes mensais se houver
          if (data.ajustesMensais && data.ajustesMensais[mesAtual]) {
            const adj = data.ajustesMensais[mesAtual];
            if (adj.pago !== undefined) isPago = adj.pago;
            if (adj.valor !== undefined) valor = adj.valor;
            if (adj.descricao !== undefined) descricao = adj.descricao;
          }

          despesas.push({ descricao, valor, pago: isPago, vencimento });
        }
      });

      // Lida com comandos
      if (text === '/resumo') {
        let salario = 0;
        if (groupId) {
          const salDoc = await db.collection("grupos").doc(groupId)
            .collection("configuracoes").doc("salarios")
            .collection("meses").doc(mesAtual).get();
          if (salDoc.exists) {
            salario = Number(salDoc.data().salary) || 0;
          }
        }

        let totalLucros = 0;
        if (groupId) {
          const lucrosSnapshot = await db.collection("grupos").doc(groupId)
            .collection("lucros_empresa").where("mesReferencia", "==", mesAtual).get();
          lucrosSnapshot.forEach(doc => {
            totalLucros += Number(doc.data().valor) || 0;
          });
        }

        let totalPago = 0;
        let totalPendente = 0;
        despesas.forEach(d => {
          if (d.pago) totalPago += d.valor;
          else totalPendente += d.valor;
        });

        const totalGastos = totalPago + totalPendente;
        const saldo = (salario + totalLucros) - totalGastos;

        const reply = `📊 *Resumo de ${formatarMesTitulo(mesAtual)}*\n\n` +
                      `💼 *Salário:* ${formatarMoeda(salario)}\n` +
                      `📈 *Lucros Empresa:* ${formatarMoeda(totalLucros)}\n` +
                      `🛑 *Pendente:* ${formatarMoeda(totalPendente)}\n` +
                      `✅ *Pago:* ${formatarMoeda(totalPago)}\n` +
                      `💵 *Total Gastos:* ${formatarMoeda(totalGastos)}\n\n` +
                      `🏁 *Saldo Geral:* ${formatarMoeda(saldo)}`;

        await sendMessage(chat.id, reply);
      } 
      else if (text === '/pendentes') {
        const pendentes = despesas.filter(d => !d.pago);
        if (pendentes.length === 0) {
          await sendMessage(chat.id, `✅ Nenhuma conta pendente para ${formatarMesTitulo(mesAtual)}!`);
        } else {
          let reply = `🛑 *Contas Pendentes (${formatarMesTitulo(mesAtual)}):*\n\n`;
          pendentes.forEach(d => {
            reply += `• *${d.descricao}*: ${formatarMoeda(d.valor)} (Vence em ${formatarDataBR(d.vencimento)})\n`;
          });
          await sendMessage(chat.id, reply);
        }
      } 
      else if (text === '/pagos') {
        const pagos = despesas.filter(d => d.pago);
        if (pagos.length === 0) {
          await sendMessage(chat.id, `Nenhuma conta paga ainda em ${formatarMesTitulo(mesAtual)}.`);
        } else {
          let reply = `✅ *Contas Pagas (${formatarMesTitulo(mesAtual)}):*\n\n`;
          pagos.forEach(d => {
            reply += `• *${d.descricao}*: ${formatarMoeda(d.valor)}\n`;
          });
          await sendMessage(chat.id, reply);
        }
      } 
      else if (text === '/vencendo') {
        const hoje = getTodayISO();
        const dataLimite = new Date(hoje + "T00:00:00");
        dataLimite.setDate(dataLimite.getDate() + 3);
        const limiteVencer = dataLimite.toISOString().split('T')[0];

        const vencendo = despesas.filter(d => !d.pago && d.vencimento >= hoje && d.vencimento <= limiteVencer);
        if (vencendo.length === 0) {
          await sendMessage(chat.id, "📅 Nenhuma conta vencendo hoje ou nos próximos 3 dias.");
        } else {
          let reply = `⚠️ *Contas Vencendo Brevemente:*\n\n`;
          vencendo.forEach(d => {
            reply += `• *${d.descricao}*: ${formatarMoeda(d.valor)} (Vence em ${formatarDataBR(d.vencimento)})\n`;
          });
          await sendMessage(chat.id, reply);
        }
      } 
      else if (text === '/vencidas') {
        const hoje = getTodayISO();
        const vencidas = despesas.filter(d => !d.pago && d.vencimento < hoje);
        if (vencidas.length === 0) {
          await sendMessage(chat.id, "🎉 Nenhuma conta vencida!");
        } else {
          let reply = `🚨 *Contas Vencidas:*\n\n`;
          vencidas.forEach(d => {
            reply += `• *${d.descricao}*: ${formatarMoeda(d.valor)} (Venceu em ${formatarDataBR(d.vencimento)})\n`;
          });
          await sendMessage(chat.id, reply);
        }
      } 
      else {
        // Comando não reconhecido ou /ajuda
        const helpMsg = `🤖 *Comandos do Finanças Compartilhadas:*\n\n` +
                        `📊 /resumo - Resumo geral do mês\n` +
                        `🛑 /pendentes - Listar contas pendentes\n` +
                        `✅ /pagos - Listar contas pagas\n` +
                        `⚠️ /vencendo - Contas vencendo em breve\n` +
                        `🚨 /vencidas - Contas vencidas`;
        await sendMessage(chat.id, helpMsg);
      }

      return res.status(200).send('OK');
    } catch (error) {
      console.error("Erro ao tratar webhook do Telegram:", error);
      return res.status(200).send('Error internally handled');
    }
  }

  return res.status(405).send('Method Not Allowed');
};
