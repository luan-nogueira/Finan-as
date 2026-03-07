<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Login - Financeiro do Casal</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <main class="auth-page">
    <section class="auth-card">
      <div class="panel-header">
        <span class="badge badge-login">🔐 Área de login</span>
        <h2>Entrar no sistema</h2>
        <p>Acesse o painel financeiro com seu e-mail e senha.</p>
      </div>

      <form id="auth-form" class="form-grid auth-form">
        <div class="field full">
          <label for="email">E-mail</label>
          <input type="email" id="email" required placeholder="seuemail@exemplo.com" />
        </div>

        <div class="field full">
          <label for="password">Senha</label>
          <input type="password" id="password" required minlength="6" placeholder="Digite sua senha" />
        </div>

        <div class="full">
          <button id="submit-btn" type="submit" class="btn-primary">Entrar</button>
        </div>
      </form>

      <div class="auth-switch">
        <button id="tab-login" type="button" class="btn-light auth-switch-btn">Modo login</button>
        <button id="tab-register" type="button" class="btn-secondary auth-switch-btn">Criar conta</button>
      </div>

      <p id="auth-message" class="auth-message"></p>
    </section>
  </main>

  <script type="module" src="login.js"></script>
</body>
</html>
