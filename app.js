import { auth, db } from "./firebase.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";

import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  updateDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const form = document.getElementById("expense-form");
const logoutBtn = document.getElementById("logout-btn");
const userEmail = document.getElementById("user-email");
const tbody = document.getElementById("tabela-despesas");

const totalGeralEl = document.getElementById("total-geral");
const totalComumEl = document.getElementById("total-comum");
const totalLuanEl = document.getElementById("total-luan");
const totalKellyEl = document.getElementById("total-kelly");
const totalPendentesEl = document.getElementById("total-pendentes");

const resumoComumEl = document.getElementById("resumo-comum");
const resumoLuanEl = document.getElementById("resumo-luan");
const resumoKellyEl = document.getElementById("resumo-kelly");

const editModal = document.getElementById("edit-modal");
const editForm = document.getElementById("edit-form");
const closeModalBtn = document.getElementById("close-modal");
const cancelEditBtn = document.getElementById("cancel-edit");

let filtroAtual = "Todos";
let despesasCache = [];
let unsubscribe = null;
let authVerificada = false;

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function classeCategoria(categoria) {
  if (categoria === "Gastos comuns") return "common";
  if (categoria === "Luan") return "luan";
  return "kelly";
}

function aplicarFiltro(lista) {
  if (filtroAtual === "Todos") return lista;
  return lista.filter((item) => item.categoria === filtroAtual);
}

function escapeHtml(texto) {
  return String(texto ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function abrirModalEdicao(item) {
  if (!editModal) return;

  document.getElementById("edit-id").value = item.id;
  document.getElementById("edit-descricao").value = item.descricao || "";
  document.getElementById("edit-categoria").value = item.categoria || "Gastos comuns";
  document.getElementById("edit-valor").value = Number(item.valor || 0);
  document.getElementById("edit-vencimento").value = item.vencimento || "";
  document.getElementById("edit-observacao").value = item.observacao || "";

  editModal.classList.remove("hidden");
}

function fecharModalEdicao() {
  if (!editModal || !editForm) return;
  editModal.classList.add("hidden");
  editForm.reset();
}

function renderTabela() {
  if (!tbody) return;

  tbody.innerHTML = "";
  const lista = aplicarFiltro(despesasCache);

  if (lista.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7">Nenhuma despesa encontrada.</td>
      </tr>
    `;
    return;
  }

  lista.forEach((item) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td><span class="tag ${classeCategoria(item.categoria)}">${escapeHtml(item.categoria)}</span></td>
      <td>${escapeHtml(item.descricao)}</td>
      <td>${formatarMoeda(item.valor)}</td>
      <td>${escapeHtml(item.vencimento || "-")}</td>
      <td>${escapeHtml(item.observacao || "-")}</td>
      <td>
        <span class="status-row ${item.pago ? "status-pago" : "status-pendente"}">
          ${item.pago ? "Pago" : "Pendente"}
        </span>
      </td>
      <td>
        <div class="actions-cell">
          <button class="action-btn btn-toggle" data-id="${item.id}" data-action="toggle">
            ${item.pago ? "Desmarcar" : "Marcar pago"}
          </button>
          <button class="action-btn btn-edit" data-id="${item.id}" data-action="edit">
            Editar
          </button>
          <button class="action-btn btn-delete" data-id="${item.id}" data-action="delete">
            Excluir
          </button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

function atualizarResumo() {
  const totalComum = despesasCache
    .filter((item) => item.categoria === "Gastos comuns")
    .reduce((acc, item) => acc + Number(item.valor || 0), 0);

  const totalLuan = despesasCache
    .filter((item) => item.categoria === "Luan")
    .reduce((acc, item) => acc + Number(item.valor || 0), 0);

  const totalKelly = despesasCache
    .filter((item) => item.categoria === "Kelly")
    .reduce((acc, item) => acc + Number(item.valor || 0), 0);

  const totalGeral = totalComum + totalLuan + totalKelly;
  const pendentes = despesasCache.filter((item) => !item.pago).length;

  if (totalComumEl) totalComumEl.textContent = formatarMoeda(totalComum);
  if (totalLuanEl) totalLuanEl.textContent = formatarMoeda(totalLuan);
  if (totalKellyEl) totalKellyEl.textContent = formatarMoeda(totalKelly);
  if (totalGeralEl) totalGeralEl.textContent = formatarMoeda(totalGeral);
  if (totalPendentesEl) totalPendentesEl.textContent = String(pendentes);

  if (resumoComumEl) resumoComumEl.textContent = formatarMoeda(totalComum);
  if (resumoLuanEl) resumoLuanEl.textContent = formatarMoeda(totalLuan);
  if (resumoKellyEl) resumoKellyEl.textContent = formatarMoeda(totalKelly);
}

async function salvarDespesa(e) {
  e.preventDefault();

  const descricao = document.getElementById("descricao").value.trim();
  const categoria = document.getElementById("categoria").value;
  const valor = Number(document.getElementById("valor").value);
  const vencimento = document.getElementById("vencimento").value.trim();
  const observacao = document.getElementById("observacao").value.trim();

  if (!auth.currentUser) {
    window.location.href = "./login.html";
    return;
  }

  try {
    await addDoc(collection(db, "despesas"), {
      descricao,
      categoria,
      valor,
      vencimento,
      observacao,
      pago: false,
      uid: auth.currentUser.uid,
      createdAt: serverTimestamp()
    });

    form.reset();
  } catch (error) {
    console.error(error);
    alert("Erro ao salvar despesa: " + error.message);
  }
}

async function salvarEdicao(e) {
  e.preventDefault();

  const id = document.getElementById("edit-id").value;
  const descricao = document.getElementById("edit-descricao").value.trim();
  const categoria = document.getElementById("edit-categoria").value;
  const valor = Number(document.getElementById("edit-valor").value);
  const vencimento = document.getElementById("edit-vencimento").value.trim();
  const observacao = document.getElementById("edit-observacao").value.trim();

  try {
    await updateDoc(doc(db, "despesas", id), {
      descricao,
      categoria,
      valor,
      vencimento,
      observacao
    });

    fecharModalEdicao();
  } catch (error) {
    console.error(error);
    alert("Erro ao editar despesa: " + error.message);
  }
}

async function alternarPagamento(id) {
  try {
    const item = despesasCache.find((d) => d.id === id);
    if (!item) return;

    await updateDoc(doc(db, "despesas", id), {
      pago: !item.pago
    });
  } catch (error) {
    console.error(error);
    alert("Erro ao atualizar status: " + error.message);
  }
}

async function excluirDespesa(id) {
  const confirmar = confirm("Deseja excluir esta despesa?");
  if (!confirmar) return;

  try {
    await deleteDoc(doc(db, "despesas", id));
  } catch (error) {
    console.error(error);
    alert("Erro ao excluir despesa: " + error.message);
  }
}

if (tbody) {
  tbody.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    const id = btn.dataset.id;
    const action = btn.dataset.action;

    if (action === "toggle") {
      await alternarPagamento(id);
      return;
    }

    if (action === "edit") {
      const item = despesasCache.find((d) => d.id === id);
      if (item) abrirModalEdicao(item);
      return;
    }

    if (action === "delete") {
      await excluirDespesa(id);
    }
  });
}

if (form) {
  form.addEventListener("submit", salvarDespesa);
}

if (editForm) {
  editForm.addEventListener("submit", salvarEdicao);
}

if (closeModalBtn) {
  closeModalBtn.addEventListener("click", fecharModalEdicao);
}

if (cancelEditBtn) {
  cancelEditBtn.addEventListener("click", fecharModalEdicao);
}

if (editModal) {
  editModal.addEventListener("click", (e) => {
    if (e.target === editModal) {
      fecharModalEdicao();
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }

      await signOut(auth);
      window.location.replace("./login.html");
    } catch (error) {
      console.error(error);
      alert("Erro ao sair da conta.");
    }
  });
}

document.querySelectorAll(".filter-btn").forEach((botao) => {
  botao.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    botao.classList.add("active");
    filtroAtual = botao.dataset.filter;
    renderTabela();
  });
});

onAuthStateChanged(auth, (user) => {
  authVerificada = true;

  if (!user) {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    if (!window.location.pathname.endsWith("/login.html")) {
      window.location.replace("./login.html");
    }
    return;
  }

  if (userEmail) {
    userEmail.textContent = user.email || "Usuário logado";
  }

  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  const q = query(
    collection(db, "despesas"),
    where("uid", "==", user.uid),
    orderBy("createdAt", "desc")
  );

  unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      despesasCache = snapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data()
      }));

      renderTabela();
      atualizarResumo();
    },
    (error) => {
      console.error(error);

      if (
        error.code === "failed-precondition" ||
        String(error.message).toLowerCase().includes("index")
      ) {
        alert("O Firestore precisa de um índice para esta consulta. Abra o link que aparece no console do navegador e crie o índice.");
        return;
      }

      alert("Erro ao carregar dados em tempo real.");
    }
  );
});
