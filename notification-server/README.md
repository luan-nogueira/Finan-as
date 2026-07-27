# Servidor de Notificacoes — Financas Compartilhadas

Servidor Node.js autonomo que monitora o Firestore em tempo real e envia notificacoes push (FCM) + Telegram para os celulares.

## Como funciona

- **Ouve o Firestore em tempo real** via onSnapshot
- **Todo dia as 08:00** envia um resumo de contas (vencidas, hoje, proximos 3 dias)
- **Imediatamente** dispara alerta quando detecta conta vencendo hoje ou em atraso
- **Suporta FCM** (push nativo Android/iOS) e **Telegram**
- **Painel web** em http://localhost:3000

## Instalacao

```bash
# 1. Entre na pasta
cd notification-server

# 2. Instale as dependencias
npm install

# 3. Configure as credenciais (ja feito automaticamente se voce clonou do repositorio)
# O arquivo serviceAccount.json ja esta na pasta com suas credenciais

# 4. Rode o servidor
npm start
```

## Rodar em Producao (24/7) com PM2

```bash
# Instalar PM2
npm install -g pm2

# Iniciar o servidor
pm2 start server.js --name financas-notif

# Salvar para reiniciar automaticamente
pm2 save
pm2 startup

# Ver logs
pm2 logs financas-notif

# Monitorar
pm2 monit
```

## API do Painel (porta 3000)

| Metodo | URL | Descricao |
|--------|-----|-----------|
| GET | `/` | Painel visual |
| GET | `/status` | JSON com status |
| POST | `/resumo` | Forcra envio do resumo agora |
| POST | `/notify` | Envia notificacao manual |

### Exemplo: Notificacao manual
```bash
curl -X POST http://localhost:3000/notify \
  -H "Content-Type: application/json" \
  -d '{"secret":"luan2025","titulo":"Teste","corpo":"Mensagem de teste!"}'
```

## Variaveis de Ambiente (.env)

| Variavel | Descricao | Padrao |
|----------|-----------|--------|
| `FIREBASE_SERVICE_ACCOUNT` | JSON da service account | - |
| `TELEGRAM_BOT_TOKEN` | Token do bot | configurado |
| `APP_URL` | URL do app | vercel URL |
| `HORA_RESUMO` | Hora do resumo diario (Brasilia) | 8 |
| `STATUS_PORT` | Porta do painel HTTP | 3000 |
| `ADMIN_SECRET` | Senha para acoes admin | luan2025 |
