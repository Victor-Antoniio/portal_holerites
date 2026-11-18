// Portal de Holerites — código compartilhado entre a página do colaborador e o painel do DP
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { firebaseConfig } from "./firebase-config.js";

export const configurado = !!(firebaseConfig && firebaseConfig.apiKey && !String(firebaseConfig.apiKey).includes("COLE"));

export let app = null, auth = null, db = null, storage = null, fns = null;
if (configurado) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
  fns = getFunctions(app, "southamerica-east1");
}

export const $ = id => document.getElementById(id);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const soDigitos = s => String(s ?? "").replace(/\D/g, "");
// O CPF vira um e-mail interno só para o Firebase Authentication (a pessoa nunca vê isso).
export const emailDoCpf = cpf => `${soDigitos(cpf)}@holerites.portal`;
export function cpfFmt(c) {
  c = soDigitos(c);
  if (!c) return "—";
  c = c.padStart(11, "0");
  return c.slice(0, 3) + "." + c.slice(3, 6) + "." + c.slice(6, 9) + "-" + c.slice(9);
}

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
// "2026-07" -> "Julho de 2026"
export function competenciaExtenso(comp) {
  const [ano, mes] = String(comp).split("-");
  return `${MESES[Number(mes) - 1] ?? mes} de ${ano}`;
}
// "2026-07" -> "07/2026"
export function competenciaCurta(comp) {
  const [ano, mes] = String(comp).split("-");
  return `${mes}/${ano}`;
}

/** Remove acentos, deixa em maiúsculas e reduz espaços — usado para casar o nome do arquivo com o cadastro. */
export function normalizarNome(nome) {
  return String(nome ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Lê o nome de um arquivo no padrão do Power Automate:
 *   "NOME DO COLABORADOR - QUALQUER COISA MMAAAA.pdf"
 * Tudo antes do primeiro " - " é o nome; depois dele, procura 6 dígitos seguidos (MMAAAA).
 * Devolve null se o arquivo não seguir o padrão.
 */
export function interpretarNomeArquivo(nomeArquivo) {
  const semExtensao = String(nomeArquivo).replace(/\.pdf$/i, "").trim();
  const partes = semExtensao.split(" - ");
  if (partes.length < 2) return null;

  const resto = partes.slice(1).join(" - ");
  const m = resto.match(/(\d{2})(\d{4})(?!\d)/);
  if (!m) return null;

  const mes = Number(m[1]);
  const ano = Number(m[2]);
  if (mes < 1 || mes > 12 || ano < 2000 || ano > 2100) return null;

  return {
    nomeNormalizado: normalizarNome(partes[0]),
    competencia: `${ano}-${String(mes).padStart(2, "0")}`
  };
}

let tt;
export function toast(msg) {
  const t = $("toast");
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(tt);
  tt = setTimeout(() => (t.hidden = true), 3500);
}

/** Mostra só uma das telas (seções com a classe "view"). */
export function mostrarView(id) {
  document.querySelectorAll("[data-view]").forEach(el => (el.hidden = el.id !== id));
}
