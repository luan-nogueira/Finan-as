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
  // Autenticação oficial do Vercel Cron Job
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.warn("Acesso não autorizado ao Cron Job.");
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const usersSnapshot = await db.collection("users").get();
    let sentCount = 0;

    for (const doc of usersSnapshot.docs) {
      const userData = doc.data();
      const fcmToken = userData.fcmToken;
      
      // Pula se usuário desativou notificações ou não tem token
      if (!fcmToken || userData.notificationsEnabled === false) continue;

      const despesasSnapshot = await db.collection("users").doc(doc.id).collection("despesas").get();
      const despesas = [];
      despesasSnapshot.forEach(d => {
        despesas.push({
          descricao: d.data().descricao,
          valor: d.data().valor,
          pago: d.data().pago,
          vencimento: d.data().vencimento
        });
      });

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

      const sendPush = async (title, body) => {
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
      };

      if (vencidas.length > 0) {
        const bodyLines = vencidas.map(d => {
          const dias = Math.abs(calcularDiffDias(hoje, d.vencimento));
          return `${d.descricao} venceu há ${dias} dia(s)`;
        }).join('\n');
        await sendPush("🚨 Contas Vencidas!", bodyLines);
      }

      if (vencendoHoje.length > 0) {
        const bodyLines = vencendoHoje.map(d => `${d.descricao} vence HOJE`).join('\n');
        await sendPush("⚠️ Vencendo Hoje!", bodyLines);
      }

      if (aVencer.length > 0) {
        const bodyLines = aVencer.map(d => {
          const dias = calcularDiffDias(hoje, d.vencimento);
          return `${d.descricao} irá vencer daqui a ${dias} dia(s)`;
        }).join('\n');
        await sendPush("📅 Próximos Vencimentos", bodyLines);
      }
    }

    return res.status(200).json({ success: true, messagesSent: sentCount });

  } catch (error) {
    console.error("Erro no Cron Job:", error);
    return res.status(500).json({ error: error.message });
  }
};
