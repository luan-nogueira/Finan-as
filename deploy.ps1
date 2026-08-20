# =====================================================
# DEPLOY - Financas Compartilhadas (Vercel)
# Uso: .\deploy.ps1  ou  .\deploy.ps1 "mensagem do commit"
# O projeto Vercel "financeiro" esta conectado ao GitHub,
# entao o git push ja dispara o deploy automatico.
# =====================================================

param([string]$Mensagem = "")

$ErrorActionPreference = "Stop"

Write-Host "=== DEPLOY FINANCAS COMPARTILHADAS ===" -ForegroundColor Cyan

# 1. Garante que o Vercel CLI esta instalado e autenticado
if (-not (Get-Command vercel -ErrorAction SilentlyContinue)) {
  Write-Host "Instalando Vercel CLI..." -ForegroundColor Yellow
  npm i -g vercel
}
vercel whoami
if ($LASTEXITCODE -ne 0) {
  Write-Host "Execute 'vercel login' antes de rodar este script." -ForegroundColor Red
  exit 1
}

# 2. Commit e push (dispara o deploy automatico no Vercel)
$mudancas = git status --porcelain
if ($mudancas) {
  git add -A
  if ($Mensagem -eq "") { $Mensagem = "deploy: $((Get-Date).ToString('yyyy-MM-dd HH:mm'))" }
  git commit -m $Mensagem
  git push origin main
  Write-Host "Push feito! O Vercel ja esta gerando o deploy automatico." -ForegroundColor Green
} else {
  Write-Host "Sem mudancas para commitar. Pulando commit." -ForegroundColor Yellow
  git push origin main
}

# 3. Deploy de producao direto pela CLI (reforco)
vercel --prod --yes

Write-Host ""
Write-Host "=== DEPLOY CONCLUIDO! ===" -ForegroundColor Green
Write-Host "Acompanhe em: https://vercel.com/luan-nogueiras-projects/financeiro/deployments" -ForegroundColor Cyan