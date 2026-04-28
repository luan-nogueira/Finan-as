const admin = require('firebase-admin');

// Inicializa o Firebase Admin usando a chave secreta colocada na Vercel
if (!admin.apps.length) {
  try {
    const rawKey = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.CONTA_DE_SERVIÇO_FIREBASE;
    const serviceAccount = JSON.parse(rawKey);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
    console.error("Erro ao inicializar Firebase Admin:", error);
  }
}

const db = admin.firestore();

function getTodayISO() {
  const d = new Date();
  d.setHours(d.getHours() - 3); // Fuso de Brasília
  return d.toISOString().split('T')[0];
}

function calcularDiffDias(dataRef, dataAlvo) {
  const d1 = new Date(dataRef + "T00:00:00");
  const d2 = new Date(dataAlvo + "T00:00:00");
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

module.exports = async (req, res) => {
  // Autenticação oficial do Vercel Cron Job ou Teste Manual via URL
  const authHeader = req.headers.authorization;
  const querySecret = req.query.secret;
  
  // Liberando uma senha de teste fixa porque a Vercel costuma sobrescrever o CRON_SECRET automaticamente
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && querySecret !== process.env.CRON_SECRET && querySecret !== 'luan2025') {
    console.warn("Acesso não autorizado ao Cron Job.");
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const usersSnapshot = await db.collection("users").get();
    let sentCount = 0;
    let debugLog = [];

    for (const doc of usersSnapshot.docs) {
      const userData = doc.data();
      const fcmToken = userData.fcmToken;
      const groupId = userData.groupId;
      
      debugLog.push(`User ${doc.id} - Token: ${!!fcmToken}, Enabled: ${userData.notificationsEnabled}, Group: ${groupId || 'Global'}`);

      // Pula se usuário desativou notificações ou não tem token
      if (!fcmToken || userData.notificationsEnabled === false) continue;

      let despesasSnapshot;
      if (groupId) {
        despesasSnapshot = await db.collection("grupos").doc(groupId).collection("despesas").get();
      } else {
        despesasSnapshot = await db.collection("despesas").get();
      }
      
      const despesas = [];
      despesasSnapshot.forEach(d => {
        const data = d.data();
        let isPago = data.pago;
        
        // Verifica se existe um ajuste mensal para o mês desta conta
        if (data.vencimento && data.ajustesMensais) {
          const mesKey = data.vencimento.substring(0, 7); // Ex: "2026-04"
          if (data.ajustesMensais[mesKey] && typeof data.ajustesMensais[mesKey].pago === "boolean") {
            isPago = data.ajustesMensais[mesKey].pago;
          }
        }

        despesas.push({
          descricao: data.descricao,
          valor: data.valor,
          pago: isPago,
          vencimento: data.vencimento
        });
      });
      
      debugLog.push(`User ${doc.id} - Total Despesas: ${despesas.length}`);

      const hoje = getTodayISO();
      const dataLimite = new Date(hoje + "T00:00:00");
      dataLimite.setDate(dataLimite.getDate() + 3);
      const limiteVencer = dataLimite.toISOString().split('T')[0];

      let vencidas = [];
      let vencendoHoje = [];
      let aVencer = [];

      despesas.forEach(d => {
        if (d.pago || !d.vencimento) return;
        if (d.vencimento < hoje) {
          const diasVencida = Math.abs(calcularDiffDias(hoje, d.vencimento));
          if (diasVencida <= 7) {
            vencidas.push(d);
          }
        } else if (d.vencimento === hoje) {
          vencendoHoje.push(d);
        } else if (d.vencimento <= limiteVencer) {
          aVencer.push(d);
        }
      });
      
      debugLog.push(`User ${doc.id} - Vencidas: ${vencidas.length}, Hoje: ${vencendoHoje.length}, AVencer: ${aVencer.length}`);

      let notificationLines = [];

      if (vencidas.length > 0) {
        const lines = vencidas.map(d => {
          const dias = Math.abs(calcularDiffDias(hoje, d.vencimento));
          return `🚨 ${d.descricao} (Venceu há ${dias}d)`;
        });
        notificationLines.push(...lines);
      }

      if (vencendoHoje.length > 0) {
        const lines = vencendoHoje.map(d => `⚠️ ${d.descricao} (Vence HOJE)`);
        notificationLines.push(...lines);
      }

      if (aVencer.length > 0) {
        const lines = aVencer.map(d => {
          const dias = calcularDiffDias(hoje, d.vencimento);
          return `📅 ${d.descricao} (Vence em ${dias}d)`;
        });
        notificationLines.push(...lines);
      }

      if (notificationLines.length > 0) {
        const title = "Resumo de Contas 💰";
        const body = notificationLines.join('\n');
        
        try {
          await admin.messaging().send({
            token: fcmToken,
            notification: {
              title: title,
              body: body
            },
            data: {
              url: "https://financas-main-tau.vercel.app/"
            }
          });
          sentCount++;
        } catch (e) {
          console.error(`Erro ao enviar push para ${doc.id}:`, e);
          if (e.code === 'messaging/invalid-registration-token' || e.code === 'messaging/registration-token-not-registered') {
             await db.collection("users").doc(doc.id).update({ fcmToken: null });
          }
        }
      }
    }

    return res.status(200).json({ success: true, messagesSent: sentCount });

  } catch (error) {
    console.error("Erro no Cron Job:", error);
    return res.status(500).json({ error: error.message });
  }
};
