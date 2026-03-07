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
  document.getElementById("edit-id").value = item.id;
  document.getElementById("edit-descricao").value = item.descricao || "";
  document.getElementById("edit-categoria").value = item.categoria || "Gastos comuns";
  document.getElementById("edit-valor").value = Number(item.valor || 0);
  document.getElementById("edit-vencimento").value = item.vencimento || "";
  document.getElementById("edit-observacao").value = item.observacao || "";

  editModal.classList.remove("hidden");
}

function fecharModalEdicao() {
  editModal.classList.add("hidden");
  editForm.reset();
}

function renderTabela() {
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

  totalComumEl.textContent = formatarMoeda(totalComum);
  totalLuanEl.textContent = formatarMoeda(totalLuan);
  totalKellyEl.textContent = formatarMoeda(totalKelly);
  totalGeralEl.textContent = formatarMoeda(totalGeral);
  totalPendentesEl.textContent = String(pendentes);

  resumoComumEl.textContent = formatarMoeda(totalComum);
  resumoLuanEl.textContent = formatarMoeda(totalLuan);
  resumoKellyEl.textContent = formatarMoeda(totalKelly);
}

async function salvarDespesa(e) {
  e.preventDefault();

  const descricao = document.getElementById("descricao").value.trim();
  const categoria = document.getElementById("categoria").value;
  const valor = Number(document.getElementById("valor").value);
  const vencimento = document.getElementById("vencimento").value.trim();
  const observacao = document.getElementById("observacao").value.trim();

  if (!auth.currentUser) return;

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

form.addEventListener("submit", salvarDespesa);
editForm.addEventListener("submit", salvarEdicao);

closeModalBtn.addEventListener("click", fecharModalEdicao);
cancelEditBtn.addEventListener("click", fecharModalEdicao);

editModal.addEventListener("click", (e) => {
  if (e.target === editModal) {
    fecharModalEdicao();
  }
});

logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "./login.html";
});

document.querySelectorAll(".filter-btn").forEach((botao) => {
  botao.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
    botao.classList.add("active");
    filtroAtual = botao.dataset.filter;
    renderTabela();
  });
});

onAuthStateChanged(auth, (user) => {
  if (!user) {
    if (unsubscribe) unsubscribe();
    window.location.href = "./login.html";
    return;
  }

  userEmail.textContent = user.email || "Usuário logado";

  if (unsubscribe) unsubscribe();

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
      alert("Erro ao carregar dados em tempo real.");
    }
  );
});
