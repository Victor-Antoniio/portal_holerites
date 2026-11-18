// Portal de Holerites — área do colaborador
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, updateDoc, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ref, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { configurado, auth, db, storage, $, esc, soDigitos, emailDoCpf, competenciaExtenso, rotuloTipo, ordemTipo, mostrarView, toast } from "./shared.js";

let avisoLogin = ""; // mensagem para mostrar na tela de login depois de um signOut forçado

function erroLogin(msg) {
  const el = $("lErr");
  el.textContent = msg;
  el.hidden = !msg;
}

if (!configurado) {
  mostrarView("setupView");
} else {
  iniciar();
}

function iniciar() {
  onAuthStateChanged(auth, user => {
    if (user) carregar(user);
    else {
      mostrarView("loginView");
      erroLogin(avisoLogin);
      avisoLogin = "";
    }
  });

  $("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    erroLogin("");
    const cpf = soDigitos($("lCpf").value).padStart(11, "0");
    const senha = $("lSenha").value;
    if (soDigitos($("lCpf").value).length < 11 || !senha) {
      erroLogin("Informe um CPF válido (11 números) e a senha.");
      return;
    }
    $("lBtn").disabled = true;
    try {
      await signInWithEmailAndPassword(auth, emailDoCpf(cpf), senha);
    } catch (err) {
      const c = err && err.code;
      if (c === "auth/user-disabled") erroLogin("Acesso desativado. Fale com o departamento pessoal.");
      else if (c === "auth/too-many-requests") erroLogin("Muitas tentativas. Aguarde alguns minutos e tente de novo.");
      else if (c === "auth/network-request-failed") erroLogin("Sem conexão. Verifique a internet e tente de novo.");
      else erroLogin("CPF ou senha incorretos.");
    } finally {
      $("lBtn").disabled = false;
    }
  });

  $("trocaForm").addEventListener("submit", trocarSenha);
  $("tSair").onclick = () => signOut(auth);
  $("btnSair").onclick = () => signOut(auth);
}

async function carregar(user) {
  let snap;
  try {
    snap = await getDoc(doc(db, "colaboradores", user.uid));
  } catch {
    avisoLogin = "Não foi possível carregar seu cadastro. Tente de novo.";
    await signOut(auth);
    return;
  }

  if (!snap.exists()) {
    avisoLogin = "Cadastro não encontrado. Fale com o departamento pessoal.";
    await signOut(auth);
    return;
  }
  const c = snap.data();
  if (c.ativo === false) {
    avisoLogin = "Acesso indisponível para este cadastro. Fale com o departamento pessoal.";
    await signOut(auth);
    return;
  }
  if (c.senhaProvisoria) {
    mostrarView("trocaView");
    return;
  }

  $("saudacao").textContent = "Olá, " + String(c.nome || "").split(" ")[0];
  mostrarView("appView");
  listar(user.uid);
}

async function trocarSenha(e) {
  e.preventDefault();
  const err = $("tErr");
  err.hidden = true;
  const nova = $("tSenha").value;
  const conf = $("tConf").value;
  if (nova.length < 8) { err.textContent = "A senha precisa ter pelo menos 8 caracteres."; err.hidden = false; return; }
  if (nova !== conf) { err.textContent = "As senhas não coincidem."; err.hidden = false; return; }

  $("tBtn").disabled = true;
  try {
    const user = auth.currentUser;
    await updatePassword(user, nova);
    await updateDoc(doc(db, "colaboradores", user.uid), { senhaProvisoria: false });
    await carregar(user);
  } catch (ex) {
    const c = ex && ex.code;
    err.textContent = c === "auth/requires-recent-login"
      ? "Por segurança, saia e entre de novo com a senha provisória para trocar a senha."
      : c === "auth/weak-password"
        ? "Senha muito fraca. Use pelo menos 8 caracteres, misturando letras e números."
        : "Não foi possível trocar a senha. Tente de novo.";
    err.hidden = false;
  } finally {
    $("tBtn").disabled = false;
  }
}

async function listar(uid) {
  const lista = $("lista");
  lista.innerHTML = '<p class="count">Carregando…</p>';
  $("empty").hidden = true;
  try {
    const snap = await getDocs(query(collection(db, "holerites"), where("colaboradorId", "==", uid)));
    const itens = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.competencia < b.competencia ? 1 : -1));
    if (!itens.length) { lista.innerHTML = ""; $("empty").hidden = false; return; }
    // agrupa por mês: cada competência mostra seus holerites (quinzena, pagamento, 13º...)
    const grupos = new Map();
    for (const h of itens) {
      if (!grupos.has(h.competencia)) grupos.set(h.competencia, []);
      grupos.get(h.competencia).push(h);
    }
    lista.innerHTML = [...grupos].map(([comp, hs]) => `
      <div class="item grupo">
        <strong>${esc(competenciaExtenso(comp))}</strong>
        ${hs.sort((a, b) => ordemTipo(a.tipo) - ordemTipo(b.tipo)).map(h => `
        <div class="linha">
          <span>${esc(rotuloTipo(h.tipo))}</span>
          <button type="button" class="primary" data-path="${esc(h.storagePath)}">Baixar</button>
        </div>`).join("")}
      </div>`).join("");
  } catch {
    lista.innerHTML = '<p class="count">Não foi possível carregar os holerites. Atualize a página.</p>';
  }
}

document.addEventListener("click", async e => {
  const b = e.target.closest("button[data-path]");
  if (!b) return;
  b.disabled = true;
  try {
    // O link é gerado só no momento do clique e não fica guardado em lugar nenhum.
    const url = await getDownloadURL(ref(storage, b.dataset.path));
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    toast("Não foi possível baixar o arquivo. Tente de novo.");
  } finally {
    b.disabled = false;
  }
});
