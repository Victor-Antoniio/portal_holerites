// Portal de Holerites — painel do DP
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, setDoc, deleteDoc, collection, query, where, orderBy, limit, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, uploadBytes, deleteObject } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import {
  configurado, auth, db, storage, fns, $, esc, soDigitos, cpfFmt, normalizarNome,
  interpretarNomeArquivo, competenciaCurta, mostrarView, toast
} from "./shared.js";

const S = {
  email: "",
  cols: [],            // colaboradores cadastrados [{uid, nome, cpf, ...}]
  porUid: new Map(),
  porNome: new Map(),  // nomeNormalizado -> colaboradores ATIVOS com esse nome
  linhas: [],          // arquivos escolhidos para upload
  senhas: [],          // senhas provisórias da última importação/cadastro (só na memória da página)
  holCarregado: false
};

const fnCriar = () => httpsCallable(fns, "criarColaboradores");
const fnAtivo = () => httpsCallable(fns, "alternarAtivo");
const fnSenha = () => httpsCallable(fns, "redefinirSenha");

function msgErro(e) {
  const c = e && e.code ? String(e.code) : "";
  if (c.includes("permission-denied")) return "Sem permissão para essa ação.";
  if (c.includes("unauthenticated")) return "Sua sessão expirou. Entre de novo.";
  if (c.includes("unavailable") || c.includes("network")) return "Sem conexão com o servidor. Tente de novo.";
  if (c.includes("resource-exhausted") || c.includes("quota")) return "Limite de uso atingido. Tente de novo mais tarde.";
  return (e && e.message) ? e.message : "Algo deu errado. Tente de novo.";
}

/* ---------- modal ---------- */
function modal(html) {
  const o = $("overlay");
  o.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  o.hidden = false;
}
function fecharModal() { const o = $("overlay"); o.hidden = true; o.innerHTML = ""; }
document.addEventListener("keydown", e => { if (e.key === "Escape") fecharModal(); });
document.addEventListener("click", e => { if (e.target.closest("[data-close]") || e.target.id === "overlay") fecharModal(); });

/* ---------- login ---------- */
function erroLogin(msg) { const el = $("lErr"); el.textContent = msg; el.hidden = !msg; }
let avisoLogin = "";

if (!configurado) {
  mostrarView("setupView");
} else {
  onAuthStateChanged(auth, async user => {
    if (!user) { mostrarView("loginView"); erroLogin(avisoLogin); avisoLogin = ""; return; }
    let ok = false;
    let motivo = "";
    const emailAdmin = String(user.email || "").toLowerCase();
    try {
      ok = (await getDoc(doc(db, "admins", emailAdmin))).exists();
      if (!ok) motivo = `O e-mail ${emailAdmin} não foi encontrado na coleção "admins". Confira se o ID do documento é exatamente esse e-mail, em minúsculas e sem espaços.`;
    } catch (e) {
      motivo = `Não foi possível verificar o acesso (${(e && e.code) || (e && e.message) || "erro desconhecido"}). Se aparecer "permission-denied", as regras do Firestore provavelmente ainda não foram publicadas.`;
    }
    if (!ok) {
      avisoLogin = motivo;
      await signOut(auth);
      return;
    }
    S.email = user.email;
    $("userEmail").textContent = user.email;
    mostrarView("appView");
    carregarColaboradores();
  });

  $("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    erroLogin("");
    const email = $("lEmail").value.trim();
    const senha = $("lSenha").value;
    if (!email || !senha) { erroLogin("Informe e-mail e senha."); return; }
    $("lBtn").disabled = true;
    try { await signInWithEmailAndPassword(auth, email, senha); }
    catch (err) {
      const c = err && err.code;
      erroLogin(c === "auth/too-many-requests" ? "Muitas tentativas. Aguarde alguns minutos." : "E-mail ou senha incorretos.");
    } finally { $("lBtn").disabled = false; }
  });

  $("lReset").onclick = async () => {
    const email = $("lEmail").value.trim();
    if (!email) { erroLogin("Digite seu e-mail acima e clique de novo em \"Esqueci minha senha\"."); return; }
    try { await sendPasswordResetEmail(auth, email); erroLogin("Se o e-mail estiver cadastrado, você receberá o link para criar uma nova senha."); }
    catch { erroLogin("Não foi possível enviar o e-mail agora."); }
  };
  $("btnSair").onclick = () => signOut(auth);
}

/* ---------- abas ---------- */
document.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => {
  document.querySelectorAll("[data-tab]").forEach(x => x.setAttribute("aria-selected", String(x === b)));
  $("tab-colaboradores").hidden = b.dataset.tab !== "colaboradores";
  $("tab-holerites").hidden = b.dataset.tab !== "holerites";
  if (b.dataset.tab === "holerites" && !S.holCarregado) { S.holCarregado = true; carregarEnviados(); }
}));

/* ---------- colaboradores ---------- */
async function carregarColaboradores() {
  $("countColab").textContent = "Carregando…";
  try {
    const snap = await getDocs(collection(db, "colaboradores"));
    S.cols = snap.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => (normalizarNome(a.nome) < normalizarNome(b.nome) ? -1 : 1));
  } catch (e) {
    $("countColab").textContent = "";
    toast(msgErro(e));
    return;
  }
  S.porUid = new Map(S.cols.map(c => [c.uid, c]));
  S.porNome = new Map();
  for (const c of S.cols) {
    if (c.ativo === false) continue;
    const k = c.nomeNormalizado || normalizarNome(c.nome);
    S.porNome.set(k, [...(S.porNome.get(k) || []), c]);
  }
  renderColaboradores();
}

function renderColaboradores() {
  const q = normalizarNome($("buscaColab").value);
  const qd = soDigitos($("buscaColab").value);
  const lista = S.cols.filter(c => {
    if (!q) return true;
    return (c.nomeNormalizado || normalizarNome(c.nome)).includes(q)
      || (qd.length >= 3 && String(c.cpf || "").includes(qd))
      || String(c.matricula || "").toUpperCase().includes(q);
  });
  $("countColab").textContent = `${lista.length} de ${S.cols.length} colaboradores`;
  const em = $("emptyColab");
  if (!lista.length) {
    em.hidden = false;
    em.textContent = S.cols.length ? "Nenhum colaborador corresponde à busca." : "Nenhum colaborador cadastrado ainda. Importe uma planilha ou cadastre o primeiro.";
    $("tbodyColab").innerHTML = "";
    return;
  }
  em.hidden = true;
  $("tbodyColab").innerHTML = lista.map(c => {
    const ativo = c.ativo !== false;
    return `<tr>
      <td class="name">${esc(c.nome)}</td>
      <td class="num">${esc(cpfFmt(c.cpf))}</td>
      <td class="num">${esc(c.matricula || "—")}</td>
      <td><span class="pill ${ativo ? "s-noprazo" : "s-desligado"}">${ativo ? "Ativo" : "Inativo"}</span></td>
      <td class="sit">${c.senhaProvisoria ? "Provisória" : "Definida"}</td>
      <td class="rowactions">
        <button type="button" class="ghost" data-act="senha" data-uid="${esc(c.uid)}">Redefinir senha</button>
        <button type="button" class="${ativo ? "danger" : ""}" data-act="ativo" data-uid="${esc(c.uid)}">${ativo ? "Inativar" : "Reativar"}</button>
      </td></tr>`;
  }).join("");
}
$("buscaColab").addEventListener("input", renderColaboradores);

$("tbodyColab").addEventListener("click", async e => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const c = S.porUid.get(b.dataset.uid);
  if (!c) return;
  b.disabled = true;
  try {
    if (b.dataset.act === "ativo") {
      const ativar = c.ativo === false;
      const ok = confirm(ativar
        ? `Reativar ${c.nome}? A pessoa volta a ter acesso aos holerites.`
        : `Inativar ${c.nome}? A pessoa perde o acesso aos holerites imediatamente. O histórico continua guardado e dá para reativar depois.`);
      if (!ok) return;
      await fnAtivo()({ uid: c.uid, ativo: ativar });
      toast(ativar ? `${c.nome} reativado(a).` : `${c.nome} inativado(a).`);
      await carregarColaboradores();
    } else if (b.dataset.act === "senha") {
      if (!confirm(`Gerar uma nova senha provisória para ${c.nome}? A senha atual deixa de funcionar e a pessoa precisará trocá-la no próximo acesso.`)) return;
      const r = await fnSenha()({ uid: c.uid });
      mostrarSenha(c.nome, cpfFmt(c.cpf), r.data.senha);
      await carregarColaboradores();
    }
  } catch (err) {
    toast(msgErro(err));
  } finally { b.disabled = false; }
});

function mostrarSenha(nome, cpf, senha) {
  modal(`<h2>Senha provisória</h2>
    <p><b>${esc(nome)}</b><br><span class="mono">${esc(cpf)}</span></p>
    <p class="senha mono" id="senhaTxt">${esc(senha)}</p>
    <p class="hint">Entregue essa senha à pessoa. Ela <b>não será exibida de novo</b>; se perder, gere outra. No primeiro acesso, o sistema obriga a troca.</p>
    <div class="actions"><button type="button" id="btnCopiar">Copiar senha</button><button type="button" class="primary" data-close>Fechar</button></div>`);
  $("btnCopiar").onclick = async () => { try { await navigator.clipboard.writeText(senha); toast("Senha copiada."); } catch { toast("Não foi possível copiar. Selecione e copie manualmente."); } };
}

/* novo colaborador */
$("btnNovo").onclick = () => {
  modal(`<h2>Novo colaborador</h2>
    <form id="formNovo" class="grid" novalidate>
      <label>Nome completo<input name="nome" required></label>
      <label>CPF<input name="cpf" inputmode="numeric" placeholder="Apenas números" required></label>
      <label>Matrícula <small>(opcional)</small><input name="matricula"></label>
      <label>E-mail para contato <small>(opcional)</small><input name="email" type="email"></label>
      <div class="err" id="novoErr" hidden></div>
      <div class="actions"><button type="submit" class="primary" id="novoBtn">Cadastrar</button><button type="button" data-close>Cancelar</button></div>
    </form>`);
  $("formNovo").addEventListener("submit", async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    const item = { nome: String(f.get("nome") || "").trim(), cpf: soDigitos(f.get("cpf")), matricula: String(f.get("matricula") || "").trim(), email: String(f.get("email") || "").trim() };
    const er = $("novoErr");
    if (!item.nome || item.cpf.length !== 11) { er.textContent = "Informe o nome e um CPF com 11 números."; er.hidden = false; return; }
    $("novoBtn").disabled = true;
    try {
      const r = await fnCriar()({ lista: [item] });
      const x = r.data.resultados[0];
      if (!x.ok) { er.textContent = x.erro; er.hidden = false; $("novoBtn").disabled = false; return; }
      mostrarSenha(item.nome, cpfFmt(item.cpf), x.senha);
      await carregarColaboradores();
    } catch (err) { er.textContent = msgErro(err); er.hidden = false; $("novoBtn").disabled = false; }
  });
};

/* importação em lote */
$("planilha").addEventListener("change", e => {
  const f = e.target.files[0];
  $("planilhaNome").textContent = f ? f.name : "Escolher planilha…";
  $("btnImportar").disabled = !f;
});

const COLUNAS = { nome: ["nome", "colaborador", "nome completo"], cpf: ["cpf"], matricula: ["matricula", "matrícula"], email: ["email", "e-mail"] };
function pick(linha, nomes) {
  for (const k of Object.keys(linha)) {
    if (nomes.includes(String(k).trim().toLowerCase())) return String(linha[k] ?? "").trim();
  }
  return "";
}
const csvCel = v => `"${String(v ?? "").replace(/"/g, '""')}"`;

$("btnImportar").onclick = async () => {
  const arquivo = $("planilha").files[0];
  if (!arquivo) return;
  const btn = $("btnImportar");
  const resumo = $("importResumo");
  btn.disabled = true;
  resumo.hidden = false;
  resumo.textContent = "Lendo a planilha…";
  S.senhas = [];

  try {
    const wb = XLSX.read(await arquivo.arrayBuffer(), { type: "array" });
    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false });

    const erros = [];
    const validos = [];
    let totalLinhas = 0;
    const vistos = new Set(S.cols.map(c => c.cpf));
    linhas.forEach((l, i) => {
      const n = i + 2;
      const nome = pick(l, COLUNAS.nome);
      let cpf = soDigitos(pick(l, COLUNAS.cpf));
      if (!nome && !cpf) return;
      totalLinhas++;
      if (cpf && cpf.length < 11) cpf = cpf.padStart(11, "0"); // Excel costuma comer o zero à esquerda
      if (!nome || cpf.length !== 11) { erros.push(`Linha ${n} (${nome || "sem nome"}): nome ou CPF inválido.`); return; }
      if (vistos.has(cpf)) { erros.push(`Linha ${n} (${nome}): CPF já cadastrado ou repetido na planilha.`); return; }
      vistos.add(cpf);
      validos.push({ nome, cpf, matricula: pick(l, COLUNAS.matricula), email: pick(l, COLUNAS.email), linha: n });
    });

    let criados = 0;
    const TAM = 100;
    for (let i = 0; i < validos.length; i += TAM) {
      resumo.textContent = `Importando… ${Math.min(i, validos.length)} de ${validos.length}`;
      const lote = validos.slice(i, i + TAM);
      try {
        const r = await fnCriar()({ lista: lote.map(({ linha, ...x }) => x) });
        r.data.resultados.forEach((x, j) => {
          const orig = lote[j];
          if (x.ok) { criados++; S.senhas.push({ nome: orig.nome, cpf: orig.cpf, matricula: orig.matricula, senha: x.senha }); }
          else erros.push(`Linha ${orig.linha} (${orig.nome}): ${x.erro}`);
        });
      } catch (err) {
        lote.forEach(o => erros.push(`Linha ${o.linha} (${o.nome}): ${msgErro(err)}`));
      }
    }

    resumo.innerHTML = `<p><b>${criados} de ${totalLinhas}</b> colaboradores cadastrados${erros.length ? ` — <b>${erros.length}</b> com problema` : ""}.</p>
      ${S.senhas.length ? `<div class="actions"><button type="button" class="primary" id="btnCsvSenhas">Baixar lista de senhas provisórias (CSV)</button></div>
      <p class="hint"><b>Baixe agora e guarde com cuidado.</b> As senhas não ficam salvas em nenhum lugar e não podem ser consultadas depois; se perder, use "Redefinir senha" em cada pessoa.</p>` : ""}
      ${erros.length ? `<ul class="errlist">${erros.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}`;
    const bc = $("btnCsvSenhas");
    if (bc) bc.onclick = baixarCsvSenhas;
    await carregarColaboradores();
  } catch (e) {
    resumo.textContent = "Não foi possível ler a planilha: " + msgErro(e);
  } finally {
    btn.disabled = false;
  }
};

function baixarCsvSenhas() {
  const linhas = [["nome", "cpf", "matricula", "senha_provisoria"], ...S.senhas.map(s => [s.nome, cpfFmt(s.cpf), s.matricula, s.senha])];
  // ";" e BOM para o Excel em português abrir com acentos corretos
  const csv = "﻿" + linhas.map(l => l.map(csvCel).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = "senhas-provisorias.csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- holerites: upload ---------- */
$("pdfs").addEventListener("change", e => {
  const arquivos = Array.from(e.target.files);
  $("pdfsNome").textContent = arquivos.length ? `${arquivos.length} arquivo(s) selecionado(s)` : "Selecionar PDFs…";
  $("uploadResultado").hidden = true;
  S.linhas = arquivos.map((file, i) => {
    const r = interpretarNomeArquivo(file.name);
    const candidatos = r ? (S.porNome.get(r.nomeNormalizado) || []) : [];
    return { i, file, comp: r ? r.competencia : null, candidatos, uid: candidatos.length === 1 ? candidatos[0].uid : "" };
  });
  renderUpload();
});

const prontas = () => S.linhas.filter(l => l.comp && l.uid);

function renderUpload() {
  $("uploadArea").hidden = !S.linhas.length;
  if (!S.linhas.length) return;
  const ativos = S.cols.filter(c => c.ativo !== false);
  const pend = S.linhas.length - prontas().length;
  $("uploadResumo").textContent = `${prontas().length} arquivo(s) identificado(s)` + (pend ? ` — ${pend} precisam de conferência (em amarelo).` : ".");
  $("btnEnviar").textContent = `Enviar ${prontas().length} holerite(s)`;
  $("btnEnviar").disabled = !prontas().length;
  $("tbodyUpload").innerHTML = S.linhas.map(l => {
    const pendente = !l.comp || !l.uid;
    let celula;
    if (l.candidatos.length === 1) celula = `${esc(l.candidatos[0].nome)} ✓`;
    else {
      const opcoes = (l.candidatos.length > 1 ? l.candidatos : ativos).map(c => `<option value="${esc(c.uid)}"${c.uid === l.uid ? " selected" : ""}>${esc(c.nome)}${l.candidatos.length > 1 ? " — CPF " + esc(cpfFmt(c.cpf)) : ""}</option>`).join("");
      celula = `<select data-i="${l.i}"><option value="">${l.candidatos.length > 1 ? "Nomes duplicados — escolha um" : "Não identificado — escolha manualmente"}</option>${opcoes}</select>`;
    }
    return `<tr class="${pendente ? "pend" : ""}">
      <td class="trunc" title="${esc(l.file.name)}">${esc(l.file.name)}</td>
      <td class="num">${l.comp ? esc(competenciaCurta(l.comp)) : '<span class="bad">não reconhecida</span>'}</td>
      <td>${celula}</td></tr>`;
  }).join("");
}

$("tbodyUpload").addEventListener("change", e => {
  const s = e.target.closest("select[data-i]");
  if (!s) return;
  S.linhas[Number(s.dataset.i)].uid = s.value;
  renderUpload();
});

$("btnEnviar").onclick = async () => {
  const fila = prontas();
  if (!fila.length) return;
  $("btnEnviar").disabled = true;
  const erros = [];
  let ok = 0, feitos = 0;

  async function enviarUm(l) {
    const path = `holerites/${l.uid}/${l.comp}.pdf`;
    await uploadBytes(ref(storage, path), l.file, {
      contentType: "application/pdf",
      contentDisposition: `attachment; filename="holerite-${l.comp}.pdf"`
    });
    await setDoc(doc(db, "holerites", `${l.uid}_${l.comp}`), {
      colaboradorId: l.uid, competencia: l.comp, storagePath: path,
      nomeArquivoOriginal: l.file.name, enviadoEm: serverTimestamp(), enviadoPor: S.email
    });
  }

  // 4 envios em paralelo
  let prox = 0;
  async function trabalhador() {
    while (prox < fila.length) {
      const l = fila[prox++];
      try { await enviarUm(l); ok++; l.enviado = true; }
      catch (err) { erros.push(`${l.file.name}: ${msgErro(err)}`); }
      feitos++;
      $("progresso").textContent = `Enviando… ${feitos} de ${fila.length}`;
    }
  }
  await Promise.all([trabalhador(), trabalhador(), trabalhador(), trabalhador()]);

  $("progresso").textContent = "";
  S.linhas = S.linhas.filter(l => !l.enviado);
  renderUpload();
  const r = $("uploadResultado");
  r.hidden = false;
  r.innerHTML = `<p><b>${ok} de ${fila.length}</b> holerites enviados com sucesso${erros.length ? ` — <b>${erros.length}</b> com erro` : ""}.</p>
    ${erros.length ? `<ul class="errlist">${erros.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}`;
  if (!S.linhas.length) { $("pdfs").value = ""; $("pdfsNome").textContent = "Selecionar PDFs…"; }
  carregarEnviados();
};

/* ---------- holerites: enviados ---------- */
let bt;
$("buscaHol").addEventListener("input", () => { clearTimeout(bt); bt = setTimeout(carregarEnviados, 300); });

async function carregarEnviados() {
  $("countHol").textContent = "Carregando…";
  const filtro = normalizarNome($("buscaHol").value);
  try {
    let docs;
    if (filtro) {
      const uids = S.cols.filter(c => (c.nomeNormalizado || normalizarNome(c.nome)).includes(filtro)).slice(0, 30).map(c => c.uid);
      if (!uids.length) docs = [];
      else docs = (await getDocs(query(collection(db, "holerites"), where("colaboradorId", "in", uids)))).docs;
    } else {
      docs = (await getDocs(query(collection(db, "holerites"), orderBy("enviadoEm", "desc"), limit(100)))).docs;
    }
    const itens = docs.map(d => ({ id: d.id, ...d.data() }));
    $("countHol").textContent = filtro ? `${itens.length} encontrado(s)` : "Mostrando os 100 mais recentes";
    const em = $("emptyHol");
    if (!itens.length) { em.hidden = false; em.textContent = "Nenhum holerite encontrado."; $("tbodyHol").innerHTML = ""; return; }
    em.hidden = true;
    $("tbodyHol").innerHTML = itens.map(h => `<tr>
      <td class="name">${esc((S.porUid.get(h.colaboradorId) || {}).nome || "(colaborador removido)")}</td>
      <td class="num">${esc(competenciaCurta(h.competencia))}</td>
      <td class="trunc muted" title="${esc(h.nomeArquivoOriginal || "")}">${esc(h.nomeArquivoOriginal || "—")}</td>
      <td class="rowactions"><button type="button" class="danger" data-del="${esc(h.id)}" data-path="${esc(h.storagePath)}" data-nome="${esc((S.porUid.get(h.colaboradorId) || {}).nome || "")}" data-comp="${esc(h.competencia)}">Apagar</button></td>
    </tr>`).join("");
  } catch (e) {
    $("countHol").textContent = "";
    toast(msgErro(e));
  }
}

$("tbodyHol").addEventListener("click", async e => {
  const b = e.target.closest("button[data-del]");
  if (!b) return;
  if (!confirm(`Apagar o holerite de ${competenciaCurta(b.dataset.comp)} de ${b.dataset.nome || "este colaborador"}? Essa ação não pode ser desfeita.`)) return;
  b.disabled = true;
  try {
    try { await deleteObject(ref(storage, b.dataset.path)); }
    catch (err) { if (!(err && err.code === "storage/object-not-found")) throw err; }
    await deleteDoc(doc(db, "holerites", b.dataset.del));
    toast("Holerite apagado.");
    carregarEnviados();
  } catch (err) {
    toast(msgErro(err));
    b.disabled = false;
  }
});