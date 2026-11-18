# Portal de Holerites (GitHub Pages + Firebase)

Portal onde o DP cadastra colaboradores e envia os holerites (PDF) por competência, e cada colaborador entra com **CPF e senha** para baixar apenas os próprios arquivos.

- **Páginas:** `index.html` (colaborador) e `admin.html` (painel do DP), hospedadas no GitHub Pages.
- **Dados, login e PDFs:** Firebase (Firestore, Authentication e Storage), na região de São Paulo.
- **Ações de administrador** (criar logins em lote, inativar, redefinir senha): Cloud Functions.
- **Segurança:** nenhum dado de colaborador vai para o GitHub. Quem protege os dados são as regras dos arquivos `firestore.rules` e `storage.rules`.

> Use um projeto Firebase **separado** do app de ASOs/atestados. Holerite tem dado mais sensível (salário) e a equipe com acesso é outra.

---

## Parte 1 — Firebase

### 1. Criar o projeto
1. Acesse <https://console.firebase.google.com> e clique em **Criar projeto**. Nome sugerido: `portal-holerites`. Pode desativar o Google Analytics.

### 2. Plano Blaze (pago conforme o uso)
O Storage (PDFs) e as Cloud Functions exigem o plano **Blaze** em projetos novos. Ele mantém as mesmas cotas gratuitas do plano grátis e só cobra o que passar delas; para ~750 colaboradores a tendência é ficar em zero ou centavos (confirme na página de preços do Firebase).

1. No canto inferior esquerdo do console, clique em **Upgrade** e escolha **Blaze**. Cadastre o cartão.
2. Em **Uso e faturamento > Detalhes e configurações**, crie um **alerta de orçamento** baixo (ex.: R$ 20) para ser avisado se algo fugir do esperado.

### 3. Ativar o login
**Criação > Authentication > Vamos começar > E-mail/senha** → ative a primeira opção e salve.

### 4. Criar o banco e o armazenamento
1. **Criação > Firestore Database > Criar banco de dados**. Local: **southamerica-east1 (São Paulo)**. Modo de produção.
2. **Criação > Storage > Vamos começar**. Mesma região (São Paulo). Modo de produção.

### 5. Ligar o site ao projeto
1. Engrenagem ⚙ > **Configurações do projeto > Seus apps > ícone `</>`** (Web). Dê um apelido e registre (não precisa marcar Hosting).
2. Copie o bloco `firebaseConfig`.
3. Abra `firebase-config.js` no Bloco de Notas e troque cada `COLE_AQUI` pelo valor correspondente. Salve.

### 6. Publicar regras e funções (uma vez, e de novo quando eu enviar versão nova)
Aqui é preciso usar o terminal, mas são poucos comandos. Instale o [Node.js (versão LTS)](https://nodejs.org) se ainda não tiver.

1. Abra o **Prompt de Comando** (não o PowerShell; ele às vezes bloqueia esses comandos) dentro da pasta do projeto. Dica: no Explorador de Arquivos, abra a pasta, clique na barra de endereço, digite `cmd` e Enter.
2. Rode, um por vez:
   ```
   npm install -g firebase-tools
   firebase login
   firebase use --add
   ```
   (no `use --add`, escolha o projeto `portal-holerites` e dê o apelido `default`)
3. Instale as dependências das funções:
   ```
   cd functions
   npm install
   cd ..
   ```
4. Publique tudo (regras do Firestore, regras do Storage e as funções):
   ```
   firebase deploy
   ```

### 7. Criar o primeiro administrador (equipe do DP)
Não existe tela de "criar conta de admin" de propósito: assim ninguém vira admin sozinho.

1. **Authentication > Usuários > Adicionar usuário**: e-mail e senha da pessoa do DP.
2. **Firestore Database > Dados > Iniciar coleção**, ID da coleção `admins`.
   - **ID do documento:** o e-mail da pessoa, **todo em minúsculas**.
   - **Campo:** `nome`, tipo `string`, com o nome da pessoa.
3. Repita para cada pessoa do DP que vai usar o painel. Para tirar o acesso, apague o documento em `admins` e o usuário em Authentication.

---

## Parte 2 — GitHub Pages

1. Crie o repositório `portal-holerites` (público, exigência do GitHub Pages gratuito; o código fica visível, mas os dados não).
2. Envie todos os arquivos **exceto** a pasta `functions` (ela é só para o Firebase; pode enviar também, não faz mal). **Não envie** planilhas, PDFs nem arquivos de senhas.
3. **Settings > Pages > Deploy from a branch > `main` / root > Save.**
4. No Firebase: **Authentication > Configurações > Domínios autorizados > Adicionar domínio** e adicione `victor-antoniio.github.io` (como o projeto é novo, o domínio precisa ser autorizado de novo).

Links finais:
- Colaboradores: `https://victor-antoniio.github.io/portal-holerites/`
- Painel do DP: `https://victor-antoniio.github.io/portal-holerites/admin.html`

---

## Parte 3 — Primeiro uso

1. Entre no painel do DP e, na aba **Colaboradores**, importe a planilha (colunas `nome`, `cpf`, e opcionais `matricula` e `email`). Veja `modelo-colaboradores.csv`.
2. Ao final, clique em **Baixar lista de senhas provisórias (CSV)** e **guarde esse arquivo com cuidado**. As senhas não ficam salvas em lugar nenhum e não dá para consultá-las depois. Se perder, use **Redefinir senha** na pessoa.
3. Na aba **Holerites**, selecione os PDFs. O sistema lê o nome do arquivo (`NOME - HOLERITE PGTO MMAAAA.pdf`), identifica colaborador e competência e destaca em amarelo o que precisa de conferência (nome duplicado ou não encontrado).
4. O colaborador entra com **CPF + senha provisória**, é obrigado a criar uma senha própria e passa a ver os holerites.

## Dia a dia

| Tarefa | Onde |
|---|---|
| Novo colaborador | Painel > Colaboradores > **+ Novo colaborador** (ou importar planilha) |
| Colaborador desligado | **Inativar** na linha dele: perde o acesso na hora, histórico fica guardado |
| Esqueceu a senha | **Redefinir senha** na linha dele: gera nova senha provisória |
| Enviou holerite errado | Aba Holerites > lista de enviados > **Apagar** |
| Reenviar uma competência | É só enviar de novo: o arquivo antigo é substituído |

## Pontos de atenção

- **Link de download:** ao clicar em "Baixar", o Firebase gera um link para o arquivo, e esse link **não expira sozinho** (só deixa de valer se o token for revogado no console). O portal não guarda o link, mas quem o copiar consegue abrir o PDF por ele. Por isso, depois de inativar alguém, um link que a pessoa já tinha gerado antes continua abrindo; ela só não consegue gerar novos. Se isso for um problema para vocês, dá para trocar por download sem link permanente (exige uma configuração de CORS no bucket); peça ajuda.
- **Senha provisória:** é aleatória e entregue pelo DP (não é o CPF). Quem sabe o CPF de um colega não consegue entrar com ele.
- **Limite por arquivo:** 5 MB por PDF (regra do `storage.rules`).
- **Colaboradores com nome idêntico:** aparecem para escolha manual no upload, mostrando o CPF de cada um.

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `index.html` / `colaborador.js` | Página do colaborador (login, troca de senha, download) |
| `admin.html` / `admin.js` | Painel do DP |
| `shared.js` | Conexão com o Firebase e funções comuns (leitura do nome do arquivo etc.) |
| `style.css` | Visual (o mesmo do controle de ASOs) |
| `firebase-config.js` | Liga o site ao seu projeto Firebase |
| `firestore.rules` / `storage.rules` | Regras de quem pode ver e alterar dados e PDFs |
| `functions/` | Cloud Functions: criar colaboradores em lote, inativar, redefinir senha |
| `firebase.json` | Configuração para o `firebase deploy` |
