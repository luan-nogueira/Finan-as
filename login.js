import { auth } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

const form = document.getElementById("auth-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const submitBtn = document.getElementById("submit-btn");
const authMessage = document.getElementById("auth-message");

const tabLogin = document.getElementById("tab-login");
const tabRegister = document.getElementById("tab-register");

let modo = "login";

function atualizarModo() {
  if (modo === "login") {
    tabLogin.classList.add("active");
    tabRegister.classList.remove("active");
    submitBtn.textContent = "Entrar";
  } else {
    tabRegister.classList.add("active");
    tabLogin.classList.remove("active");
    submitBtn.textContent = "Criar conta";
  }
  authMessage.textContent = "";
}

tabLogin.addEventListener("click", () => {
  modo = "login";
  atualizarModo();
});

tabRegister.addEventListener("click", () => {
  modo = "register";
  atualizarModo();
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    window.location.href = "./index.html";
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();

  authMessage.textContent = "Processando...";

  try {
    if (modo === "login") {
      await signInWithEmailAndPassword(auth, email, password);
    } else {
      await createUserWithEmailAndPassword(auth, email, password);
    }

    window.location.href = "./index.html";
  } catch (error) {
    authMessage.textContent = traduzirErroAuth(error.code);
  }
});

function traduzirErroAuth(code) {
  const erros = {
    "auth/invalid-email": "E-mail inválido.",
    "auth/missing-password": "Digite a senha.",
    "auth/weak-password": "A senha deve ter pelo menos 6 caracteres.",
    "auth/email-already-in-use": "Este e-mail já está em uso.",
    "auth/user-not-found": "Usuário não encontrado.",
    "auth/wrong-password": "Senha incorreta.",
    "auth/invalid-credential": "E-mail ou senha inválidos.",
    "auth/too-many-requests": "Muitas tentativas. Tente novamente mais tarde."
  };

  return erros[code] || `Erro: ${code}`;
}

atualizarModo();
