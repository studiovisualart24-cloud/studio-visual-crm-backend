// Motor de automação: dispara e executa os fluxos criados na aba "Automação" do CRM.
//
// Como funciona:
// 1. Um evento real acontece (novo lead criado, etapa do pipeline mudou, tag adicionada,
//    formulário externo preenchido) e o código que trata esse evento chama dispararAutomacoes().
// 2. dispararAutomacoes() procura fluxos ativos com aquele gatilho e cria um AutomationRun
//    (um "registro de execução") para cada um, já ligado ao lead que originou o evento.
// 3. executarProximoPasso() roda os passos do fluxo em sequência. Um passo "esperar X dias"
//    não trava o processo: grava quando deve continuar (waitUntil) e marca status "aguardando".
// 4. retomarAutomacoesPendentes() é chamada periodicamente pelo agendador em server.js e retoma
//    qualquer execução cujo waitUntil já passou — inclusive depois de o servidor reiniciar.
//
// Importante: os passos que alteram o próprio contato (mover_pipeline, adicionar_tag) mexem
// direto no banco em vez de chamar as rotas HTTP do CRM. Isso é proposital: evita que uma
// automação dispare outra automação em cadeia (loop infinito). Se um dia quiser encadear
// automações de propósito, isso precisa ser feito com cuidado (ex: limite de profundidade).

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const { enviarEmail } = require('./emailService');
const { enviarWhatsapp } = require('./whatsappService');
const { gerarTexto } = require('./iaService');

function linha(texto) {
  return `[${new Date().toISOString()}] ${texto}`;
}

// Troca {{campo}} no texto pelo valor daquele campo no contato (ex: {{nome}}, {{empresa}}).
function preencherVariaveis(texto, contato) {
  if (!texto) return texto;
  return String(texto).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, campo) => {
    const valor = contato ? contato[campo] : undefined;
    return valor === undefined || valor === null ? '' : String(valor);
  });
}

// Avalia condições simples digitadas no passo "Condição (Se/Então)", ex:
// "stage == Proposta", "valorMensal != 0", "segmento contem Jurídico".
// Uma condição em formato não reconhecido (ou sem contato associado) não bloqueia a automação.
function avaliarCondicao(condicao, contato) {
  if (!condicao || !condicao.trim()) return true;
  const m = condicao.match(/^\s*(\w+)\s*(==|!=|contem)\s*(.+?)\s*$/i);
  if (!m || !contato) return true;
  const [, campo, op, valorBrutoRaw] = m;
  const valorEsperado = valorBrutoRaw.replace(/^['"]|['"]$/g, '').toLowerCase();
  const atual = contato[campo];
  const atualStr = atual === undefined || atual === null ? '' : String(atual).toLowerCase();
  if (op === '==') return atualStr === valorEsperado;
  if (op === '!=') return atualStr !== valorEsperado;
  return atualStr.includes(valorEsperado); // "contem"
}

// Procura fluxos ativos para este gatilho e começa a execução de cada um.
// contato é opcional (ex: gatilhos futuros que não sejam sobre um lead específico).
async function dispararAutomacoes(accountId, gatilho, contato) {
  if (!accountId || !gatilho) return [];
  const flows = await prisma.automacao.findMany({ where: { accountId, gatilho, ativo: true } });
  const runsIniciados = [];
  for (const flow of flows) {
    const run = await prisma.automationRun.create({
      data: {
        flowId: flow.id,
        flowNome: flow.nome,
        accountId,
        contatoId: contato?.id || null,
        contatoNome: contato?.nome || null,
        gatilho,
        status: 'rodando',
        currentStepIndex: 0,
        log: [linha(`Disparado pelo gatilho "${gatilho}"${contato ? ` para o lead ${contato.nome}` : ''}.`)],
      },
    });
    runsIniciados.push(run.id);
    // Não usamos await aqui de propósito: quem chamou dispararAutomacoes (ex: a rota que acabou
    // de criar o lead) não precisa esperar a automação inteira rodar para responder ao front-end.
    executarProximoPasso(run.id).catch((err) => console.error(`Erro ao executar automação ${flow.id}:`, err));
  }
  return runsIniciados;
}

// Executa o passo atual de uma execução e, se não for um passo de espera, chama a si mesma
// para o próximo passo — até acabar o fluxo, parar numa condição, esperar ou dar erro.
async function executarProximoPasso(runId) {
  const run = await prisma.automationRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== 'rodando') return;

  const flow = await prisma.automacao.findUnique({ where: { id: run.flowId } });
  const log = Array.isArray(run.log) ? [...run.log] : [];

  if (!flow) {
    log.push(linha('O fluxo foi apagado antes desta execução terminar.'));
    await prisma.automationRun.update({ where: { id: runId }, data: { status: 'erro', log } });
    return;
  }

  const steps = Array.isArray(flow.steps) ? flow.steps : [];
  if (run.currentStepIndex >= steps.length) {
    await prisma.automationRun.update({ where: { id: runId }, data: { status: 'concluido', log } });
    return;
  }

  const contato = run.contatoId ? await prisma.contato.findUnique({ where: { id: run.contatoId } }) : null;
  const step = steps[run.currentStepIndex] || {};

  try {
    switch (step.tipo) {
      case 'enviar_email': {
        const destino = contato?.email || step.para;
        if (!destino) {
          log.push(linha('Email pulado: nem o lead nem o passo têm um email definido.'));
          break;
        }
        const resultado = await enviarEmail({
          para: destino,
          assunto: preencherVariaveis(step.assunto, contato) || 'Sem assunto',
          corpo: preencherVariaveis(step.corpo, contato) || '',
        });
        log.push(linha(resultado.enviado ? `Email enviado para ${destino}.` : `Email não enviado: ${resultado.aviso || resultado.error}`));
        break;
      }
      case 'enviar_whatsapp': {
        const destino = contato?.whatsapp || contato?.telefone || step.para;
        if (!destino) {
          log.push(linha('WhatsApp pulado: nem o lead nem o passo têm um número definido.'));
          break;
        }
        // Se o passo tem um "modeloNome" preenchido, usa um modelo (template) aprovado pelo WhatsApp —
        // obrigatório para iniciar conversa com um lead que nunca falou com a gente antes (mensagem
        // "iniciada pela empresa"). Sem modelo, manda texto livre (só entrega se o lead já escreveu
        // pra gente nas últimas 24h). O modelo hoje só suporta uma variável nomeada {{nome}} = nome do lead
        // (a Meta exige variáveis nomeadas em letra minúscula, não mais numeradas tipo {{1}}).
        const resultado = step.modeloNome
          ? await enviarWhatsapp({ para: destino, templateName: step.modeloNome, templateParams: [{ name: 'nome', text: contato?.nome || '' }] })
          : await enviarWhatsapp({ para: destino, mensagem: preencherVariaveis(step.mensagem, contato) || '' });
        log.push(linha(resultado.enviado ? `WhatsApp enviado para ${destino}.` : `WhatsApp não enviado: ${resultado.aviso || resultado.error}`));
        break;
      }
      case 'criar_tarefa': {
        const titulo = preencherVariaveis(step.titulo, contato) || 'Tarefa da automação';
        await prisma.tarefa.create({ data: { accountId: run.accountId, titulo, data: new Date(), responsavel: 'Você' } });
        log.push(linha(`Tarefa criada: "${titulo}" (veja na Agenda).`));
        break;
      }
      case 'adicionar_tag': {
        if (!contato || !step.tag) {
          log.push(linha('Adicionar tag pulado: sem lead associado ou tag não definida no passo.'));
        } else if ((contato.tags || []).includes(step.tag)) {
          log.push(linha(`O lead já tinha a tag "${step.tag}".`));
        } else {
          await prisma.contato.update({ where: { id: contato.id }, data: { tags: { push: step.tag } } });
          log.push(linha(`Tag "${step.tag}" adicionada ao lead.`));
        }
        break;
      }
      case 'mover_pipeline': {
        if (!contato || !step.etapa) {
          log.push(linha('Mover no pipeline pulado: sem lead associado ou etapa não definida no passo.'));
        } else {
          await prisma.contato.update({ where: { id: contato.id }, data: { stage: step.etapa } });
          log.push(linha(`Lead movido para a etapa "${step.etapa}".`));
        }
        break;
      }
      case 'disparar_ia': {
        const prompt = preencherVariaveis(step.prompt, contato) || 'Gere uma sugestão útil para este passo de automação de marketing.';
        const resultado = await gerarTexto({ prompt, maxTokens: 400 });
        log.push(linha(resultado.ok ? `IA respondeu: ${resultado.texto}` : `IA não respondeu: ${resultado.aviso || resultado.error}`));
        break;
      }
      case 'condicao': {
        const passa = avaliarCondicao(step.condicao, contato);
        log.push(linha(`Condição "${step.condicao || '(vazia)'}" ${passa ? 'verdadeira — automação continua.' : 'falsa — automação parada aqui.'}`));
        if (!passa) {
          await prisma.automationRun.update({ where: { id: runId }, data: { status: 'parado', log } });
          return;
        }
        break;
      }
      case 'esperar': {
        const dias = Number(step.dias) || 0;
        const waitUntil = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
        log.push(linha(`Aguardando ${dias} dia(s) — retoma automaticamente em ${waitUntil.toLocaleString('pt-BR')}.`));
        await prisma.automationRun.update({
          where: { id: runId },
          data: { status: 'aguardando', waitUntil, currentStepIndex: run.currentStepIndex + 1, log },
        });
        return;
      }
      default:
        log.push(linha(`Passo "${step.tipo}" não reconhecido, pulado.`));
    }
  } catch (err) {
    console.error('Erro executando passo de automação:', err);
    log.push(linha(`Erro inesperado neste passo: ${String(err.message || err)}`));
    await prisma.automationRun.update({ where: { id: runId }, data: { status: 'erro', log } });
    return;
  }

  await prisma.automationRun.update({
    where: { id: runId },
    data: { currentStepIndex: run.currentStepIndex + 1, log },
  });
  await executarProximoPasso(runId);
}

// Chamada pelo agendador (server.js) a cada alguns minutos: retoma qualquer execução
// que estava esperando e cujo prazo já passou — mesmo que o servidor tenha reiniciado.
async function retomarAutomacoesPendentes() {
  const pendentes = await prisma.automationRun.findMany({
    where: { status: 'aguardando', waitUntil: { lte: new Date() } },
  });
  for (const run of pendentes) {
    await prisma.automationRun.update({ where: { id: run.id }, data: { status: 'rodando' } });
    executarProximoPasso(run.id).catch((err) => console.error(`Erro ao retomar automação ${run.id}:`, err));
  }
  return pendentes.length;
}

module.exports = { dispararAutomacoes, executarProximoPasso, retomarAutomacoesPendentes };
