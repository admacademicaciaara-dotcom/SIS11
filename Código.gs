/**
 * ================================================================
 *  SISTEMA DE GESTÃO ACADÊMICA — CIAARA-11
 *  Back-end (Google Apps Script)
 * ================================================================
 *  COMO INSTALAR:
 *  1. Na planilha "Banco de dados CIAARA-11": Extensões > Apps Script.
 *  2. Substitua o conteúdo de Código.gs por este arquivo.
 *     ATENÇÃO: se você instalou o arquivo Auth_CIAARA.gs antes,
 *     REMOVA-O do projeto — as funções de autenticação já estão
 *     incorporadas aqui (funções duplicadas causam conflito).
 *  3. Crie um arquivo HTML chamado exatamente "index" e cole o
 *     conteúdo de index.html.
 *  4. Implantar > Nova implantação > App da Web:
 *       - Executar como: "Usuário que acessa o app"
 *       - Quem pode acessar: "Qualquer pessoa com uma Conta Google"
 *  5. Abra a URL gerada. Só e-mails cadastrados na aba "Usuarios"
 *     conseguem entrar.
 *
 *  PERFIS (coluna Funcao da aba Usuarios):
 *   - Admin        → tudo (cadastros-base + registros + relatórios)
 *   - Operador     → registrar aulas e avaliações + relatórios
 *   - Visualizacao → somente leitura
 * ================================================================
 */

// ---------------------------------------------------------------
// CONSTANTES E CONFIGURAÇÃO
// ---------------------------------------------------------------
var ABAS = {
  USUARIOS:    'Usuarios',
  CURSOS:      'Cad_Cursos',
  TURMAS:      'Turmas_Ativas',
  MATERIAS:    'Cad_Matérias',
  INSTRUTORES: 'Cad_Instrutor',
  VINCULOS:    'Instrutor_Materia',
  REGISTROS:   'Registro_Aulas_E_Atividades',
  AVALIACOES:  'Avaliacoes',
  CONFIG:      'Config_Listas',
  EVENTOS:     'Eventos_Globais',         // feriados/recessos (Motor de Capacidade)
  // NOVO — módulo DSA (Detalhe Semanal de Aula)
  DSA_SEMANAS:    'DSA_Semanas',
  DSA_ALTERACOES: 'DSA_Alteracoes',
  DSA_TEMPOS:     'DSA_Tempos',
  TIPOS_EVENTO:   'Cad_TiposEvento'
};

// Papéis com permissão de ESCRITA por aba (leitura: qualquer usuário cadastrado)
var CRUD_CONFIG = {
  'Registro_Aulas_E_Atividades': { prefixo: 'REG', escrita: ['Admin', 'Operador'] },
  'Avaliacoes':                  { prefixo: 'AVA', escrita: ['Admin', 'Operador'] },
  'Turmas_Ativas':               { prefixo: '',    escrita: ['Admin'] },
  'Cad_Cursos':                  { prefixo: '',    escrita: ['Admin'] },
  'Cad_Matérias':                { prefixo: '',    escrita: ['Admin'] },
  'Cad_Instrutor':               { prefixo: '',    escrita: ['Admin'] },
  'Instrutor_Materia':           { prefixo: '',    escrita: ['Admin'] },
  'Config_Listas':               { prefixo: '',    escrita: ['Admin'] },
  'Usuarios':                    { prefixo: 'USR', escrita: ['Admin'] },
  'Eventos_Globais':             { prefixo: 'EVT', escrita: ['Admin'] },
  // NOVO — módulo DSA
  'DSA_Semanas':                 { prefixo: 'SEM', escrita: ['Admin', 'Operador'] },
  'DSA_Alteracoes':              { prefixo: 'ALT', escrita: ['Admin', 'Operador'] },
  'DSA_Tempos':                  { prefixo: 'TMP', escrita: ['Admin', 'Operador'] },
  'Cad_TiposEvento':             { prefixo: '',    escrita: ['Admin'] }
};

// Tipos de atividade que podem ser lançados SEM matéria vinculada
var TIPOS_SEM_MATERIA = ['Palestra', 'Atividade Extracurricular', 'Evento/Cerimônia'];

// Tempos de aula por dia (fallback quando a coluna Tempos_Por_Dia estiver vazia)
var TEMPOS_POR_DIA_PADRAO = 6;

// NOVO — Regime_Esforco -> tempos/dia (Contexto V1). Fallback: coluna legada Tempos_Por_Dia.
var TEMPOS_POR_DIA_REGIME = { 'Marcha 1': 8, 'Marcha 2': 9, 'Marcha 3': 8 };

// NOVO — módulo DSA: horários padrão de cada tempo de aula (1º a 9º).
// Inferido do modelo real (planilha "C-AP-HN 2026", aba Detalhe Semanal de Aula, Google Drive
// Controle_Cursos/Cursos Regulares). REVISAR com a Divisão de Ensino antes de oficializar —
// são os únicos valores deste módulo que não vieram 100% confirmados linha a linha.
var TEMPOS_HORARIO_PADRAO = [
  { tempo: 1, periodo: 'Manhã', inicio: '07:50', fim: '08:35' },
  { tempo: 2, periodo: 'Manhã', inicio: '08:40', fim: '09:25' },
  { tempo: 3, periodo: 'Manhã', inicio: '09:30', fim: '10:15' },
  { tempo: 4, periodo: 'Manhã', inicio: '10:20', fim: '11:05' },
  { tempo: 5, periodo: 'Manhã', inicio: '11:10', fim: '11:55' },
  { tempo: 6, periodo: 'Tarde', inicio: '13:05', fim: '13:50' },
  { tempo: 7, periodo: 'Tarde', inicio: '13:55', fim: '14:40' },
  { tempo: 8, periodo: 'Tarde', inicio: '14:45', fim: '15:30' },
  { tempo: 9, periodo: 'Tarde', inicio: '15:35', fim: '16:20' }
];

// ---------------------------------------------------------------
// AUTENTICAÇÃO (RBAC via conta Google + aba Usuarios)
// ---------------------------------------------------------------
function getUsuarioAtual() {
  var email = Session.getActiveUser().getEmail();
  if (!email) {
    throw new Error('Não foi possível identificar seu e-mail. Verifique se está logado com uma Conta Google.');
  }
  var dados = lerAbaComoObjetos_(ABAS.USUARIOS);
  var alvo = email.trim().toLowerCase();
  for (var i = 0; i < dados.length; i++) {
    if (String(dados[i]['Email'] || '').trim().toLowerCase() === alvo) {
      return {
        id: dados[i]['ID_Usuario'],
        email: dados[i]['Email'],
        nome: dados[i]['Nome'],
        funcao: dados[i]['Funcao'],
        idInstrutorLink: dados[i]['ID_Instrutor_Link'] || ''
      };
    }
  }
  return null;
}

function exigirFuncao(funcoesPermitidas) {
  var usuario = getUsuarioAtual();
  if (!usuario) {
    throw new Error('Acesso negado: e-mail ' + Session.getActiveUser().getEmail() + ' não cadastrado na aba ' + ABAS.USUARIOS + '.');
  }
  if (funcoesPermitidas.indexOf(usuario.funcao) === -1) {
    throw new Error('Acesso negado: seu perfil (' + usuario.funcao + ') não permite esta ação.');
  }
  return usuario;
}

// ---------------------------------------------------------------
// WEB APP
// ---------------------------------------------------------------
function doGet() {
  var usuario = getUsuarioAtual();
  if (!usuario) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;padding:40px;text-align:center">' +
      '<h2>🚫 Acesso negado</h2>' +
      '<p>O e-mail <b>' + Session.getActiveUser().getEmail() + '</b> não está cadastrado no sistema.</p>' +
      '<p>Solicite o cadastro ao administrador do CIAARA-11.</p></div>'
    ).setTitle('CIAARA-11 — Acesso negado');
  }
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('CIAARA-11 — Gestão Acadêmica')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(nomeArquivo) {
  return HtmlService.createHtmlOutputFromFile(nomeArquivo).getContent();
}

// ---------------------------------------------------------------
// HELPERS DE PLANILHA
// ---------------------------------------------------------------
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function tz_() { return ss_().getSpreadsheetTimeZone() || Session.getScriptTimeZone(); }

/** Lê uma aba inteira e devolve array de objetos {Cabecalho: valor}. Datas viram 'yyyy-MM-dd'. */
function lerAbaComoObjetos_(nomeAba) {
  var aba = ss_().getSheetByName(nomeAba);
  if (!aba) throw new Error('Aba "' + nomeAba + '" não encontrada.');
  var valores = aba.getDataRange().getValues();
  if (valores.length < 2) return [];
  var cab = valores[0].map(String);
  var out = [];
  for (var r = 1; r < valores.length; r++) {
    var linha = valores[r];
    // ignora linhas totalmente vazias
    var temAlgo = linha.some(function (c) { return c !== '' && c !== null; });
    if (!temAlgo) continue;
    var obj = { _row: r + 1 };
    for (var c = 0; c < cab.length; c++) {
      var v = linha[c];
      if (v instanceof Date) v = Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
      obj[cab[c]] = v;
    }
    out.push(obj);
  }
  return out;
}

/** Converte 'yyyy-MM-dd' em Date local (sem deslocamento de fuso). */
function isoParaDate_(iso) {
  if (!iso) return '';
  var p = String(iso).split('-');
  if (p.length !== 3) return iso;
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

/** Gera próximo ID sequencial 'PREFIXO-NNNN' na coluna A da aba. */
function gerarProximoId_(nomeAba, prefixo) {
  var dados = lerAbaComoObjetos_(nomeAba);
  var max = 0;
  dados.forEach(function (d) {
    var id = String(d[Object.keys(d)[1]] || ''); // primeira coluna após _row
    var m = id.match(new RegExp('^' + prefixo + '-(\\d+)$'));
    if (m) max = Math.max(max, Number(m[1]));
  });
  return prefixo + '-' + Utilities.formatString('%04d', max + 1);
}

/**
 * Dias úteis entre duas datas (inclusive), conforme o Regime_Esforco da turma:
 *  - 'Marcha 3' conta seg-sáb (só exclui domingo); demais regimes contam seg-sex.
 *  - Desconta datas presentes em `feriados` (mapa 'yyyy-MM-dd'->true), vindas de
 *    Eventos_Globais com Impacto = 'Dia Inteiro'.
 */
function diasUteis_(de, ate, regime, feriados) {
  if (!(de instanceof Date) || !(ate instanceof Date) || ate < de) return 0;
  var incluirSabado = (regime === 'Marcha 3');
  var n = 0, d = new Date(de.getTime());
  while (d <= ate) {
    var dow = d.getDay(); // 0=Dom … 6=Sáb
    var diaUtil = incluirSabado ? (dow !== 0) : (dow >= 1 && dow <= 5);
    var iso = Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
    if (diaUtil && !(feriados && feriados[iso])) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}

/** Mapa {'yyyy-MM-dd': true} dos dias de Eventos_Globais com Impacto = 'Dia Inteiro'. */
function feriadosDiaInteiro_() {
  var aba = ss_().getSheetByName(ABAS.EVENTOS);
  if (!aba) return {}; // aba ainda não criada: nenhum feriado a descontar (degrada com segurança)
  var set = {};
  lerAbaComoObjetos_(ABAS.EVENTOS).forEach(function (e) {
    if (String(e['Impacto'] || '').trim() === 'Dia Inteiro' && e['Data']) set[e['Data']] = true;
  });
  return set;
}

/** Carga horária de uma matéria, tolerando Carga_Horaria OU Carga_Horaria_Tempos como nome de coluna. */
function cargaHorariaDe_(materia) {
  return Number(materia['Carga_Horaria'] || materia['Carga_Horaria_Tempos'] || 0);
}

/** Como lerAbaComoObjetos_, mas devolve [] em vez de lançar erro se a aba ainda não existir. */
function lerAbaComoObjetosSeguro_(nomeAba) {
  if (!ss_().getSheetByName(nomeAba)) return [];
  return lerAbaComoObjetos_(nomeAba);
}

/** Acrescenta uma coluna ao final da aba, se ela ainda não existir. */
function garantirColuna_(nomeAba, nomeColuna) {
  var aba = ss_().getSheetByName(nomeAba);
  if (!aba) return;
  var ultimaCol = Math.max(aba.getLastColumn(), 1);
  var cab = aba.getRange(1, 1, 1, ultimaCol).getValues()[0].map(String);
  if (cab.indexOf(nomeColuna) === -1) {
    aba.getRange(1, ultimaCol + 1).setValue(nomeColuna);
  }
}

/** Horários (início/fim) dos N primeiros tempos de aula do dia, conforme TEMPOS_HORARIO_PADRAO. */
function horariosPorRegime_(regime, temposNoDia) {
  var n = Math.max(1, Math.min(TEMPOS_HORARIO_PADRAO.length, Number(temposNoDia) || TEMPOS_POR_DIA_PADRAO));
  return TEMPOS_HORARIO_PADRAO.slice(0, n);
}

/** Lança erro amigável se as abas do módulo DSA ainda não tiverem sido criadas. */
function exigirEstruturaDSA_() {
  var necessarias = [ABAS.DSA_SEMANAS, ABAS.DSA_ALTERACOES, ABAS.DSA_TEMPOS, ABAS.TIPOS_EVENTO];
  var faltando = necessarias.filter(function (n) { return !ss_().getSheetByName(n); });
  if (faltando.length) {
    throw new Error('Estrutura do DSA ainda não configurada (faltam as abas: ' + faltando.join(', ') +
      '). Peça a um Admin para clicar em "Configurar estrutura" na aba Detalhe Semanal.');
  }
}

// ---------------------------------------------------------------
// CONTEXTO INICIAL (carrega tudo que o front precisa nos dropdowns)
// Expansível: novo curso/turma/matéria na planilha aparece sozinho.
// ---------------------------------------------------------------
function getContextoInicial() {
  var usuario = exigirFuncao(['Admin', 'Operador', 'Visualizacao']);

  var turmas = lerAbaComoObjetos_(ABAS.TURMAS).map(function (t) {
    return {
      idTurma: t['ID_Turma'],
      idCurso: t['ID_Curso'],
      nome: t['Nome_Completo_Curso'],
      turma: t['Turma'],
      ano: t['Ano_Letivo'],
      modalidade: t['Modalidade'],
      dataInicio: t['Data_Inicio'],
      dataTermino: t['Data_Termino'],
      status: t['Status'],
      temposPorDia: Number(t['Tempos_Por_Dia']) || TEMPOS_POR_DIA_PADRAO
    };
  });

  var materias = lerAbaComoObjetos_(ABAS.MATERIAS).map(function (m) {
    return {
      idGrade: m['ID_Grade'],
      idCurso: m['ID_Curso'],
      cod: m['Cod'],
      nome: m['Nome_Materia'],
      cargaHoraria: Number(m['Carga_Horaria']) || 0
    };
  });

  var instrutores = lerAbaComoObjetos_(ABAS.INSTRUTORES).map(function (i) {
    return { id: String(i['ID_Instrutor']), pg: i['P/G'], nome: i['NOME'] };
  });

  // Vínculos instrutor↔matéria (para sugerir instrutores habilitados)
  var vinculos = lerAbaComoObjetos_(ABAS.VINCULOS).map(function (v) {
    var chaves = Object.keys(v);
    return { idInstrutor: String(v['ID_Instrutor'] || v[chaves[1]]), idGrade: String(v['ID_Grade (Matéria)'] || v['ID_Grade'] || '') };
  }).filter(function (v) { return v.idInstrutor && v.idGrade; });

  var cfg = lerListasConfig_();

  // NOVO — catálogo de eventos do módulo DSA (lê com segurança: [] se a aba ainda não existe)
  var tiposEvento = lerAbaComoObjetosSeguro_(ABAS.TIPOS_EVENTO)
    .filter(function (e) { return String(e['Ativo'] || 'Sim').trim().toLowerCase() !== 'não'; })
    .map(function (e) {
      return {
        codigo: e['Codigo'],
        categoria: e['Categoria'],
        nome: e['Nome'],
        requerMateria: String(e['Requer_Materia'] || '').trim().toLowerCase() === 'sim',
        requerInstrutor: String(e['Requer_Instrutor'] || '').trim().toLowerCase() === 'sim'
      };
    });

  return {
    usuario: usuario,
    turmas: turmas,
    materias: materias,
    instrutores: instrutores,
    vinculos: vinculos,
    metodologias: cfg.metodologias,
    tiposAtividade: cfg.tiposAtividade,
    tiposAvaliacao: cfg.tiposAvaliacao,
    statusAvaliacao: cfg.statusAvaliacao,
    tiposSemMateria: TIPOS_SEM_MATERIA,
    tiposEvento: tiposEvento,
    hoje: Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd')
  };
}

function lerListasConfig_() {
  var aba = ss_().getSheetByName(ABAS.CONFIG);
  var valores = aba.getDataRange().getValues();
  var col = function (idx) {
    var out = [];
    for (var r = 1; r < valores.length; r++) {
      var v = String(valores[r][idx] || '').trim();
      if (v) out.push(v);
    }
    return out;
  };
  return {
    metodologias: col(0),
    tiposAtividade: col(1),
    tiposAvaliacao: col(2),
    statusAvaliacao: col(3)
  };
}

// ---------------------------------------------------------------
// CRUD UNIVERSAL (whitelist + RBAC)
// ---------------------------------------------------------------
function crudListar(nomeAba) {
  exigirFuncao(['Admin', 'Operador', 'Visualizacao']);
  if (!CRUD_CONFIG[nomeAba]) throw new Error('Aba não autorizada: ' + nomeAba);
  return lerAbaComoObjetos_(nomeAba);
}

function crudCriar(nomeAba, obj) {
  var cfg = CRUD_CONFIG[nomeAba];
  if (!cfg) throw new Error('Aba não autorizada: ' + nomeAba);
  exigirFuncao(cfg.escrita);

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var aba = ss_().getSheetByName(nomeAba);
    var cab = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].map(String);
    var idCol = cab[0];

    if (!obj[idCol] && cfg.prefixo) obj[idCol] = gerarProximoId_(nomeAba, cfg.prefixo);

    var linha = cab.map(function (h) {
      var v = obj.hasOwnProperty(h) ? obj[h] : '';
      // campos de data chegam como ISO do front
      if (/^Data|_Data|Data_/.test(h) && v) v = isoParaDate_(v);
      if (h === 'Timestamp_Registro') v = new Date();
      return v;
    });
    aba.appendRow(linha);
    return { ok: true, id: obj[idCol] };
  } finally {
    lock.releaseLock();
  }
}

function crudAtualizar(nomeAba, id, obj) {
  var cfg = CRUD_CONFIG[nomeAba];
  if (!cfg) throw new Error('Aba não autorizada: ' + nomeAba);
  exigirFuncao(cfg.escrita);

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var aba = ss_().getSheetByName(nomeAba);
    var valores = aba.getDataRange().getValues();
    var cab = valores[0].map(String);
    for (var r = 1; r < valores.length; r++) {
      if (String(valores[r][0]) === String(id)) {
        cab.forEach(function (h, c) {
          if (obj.hasOwnProperty(h) && c > 0) { // nunca sobrescreve o ID
            var v = obj[h];
            if (/^Data|_Data|Data_/.test(h) && v) v = isoParaDate_(v);
            aba.getRange(r + 1, c + 1).setValue(v);
          }
        });
        return { ok: true };
      }
    }
    throw new Error('Registro ' + id + ' não encontrado em ' + nomeAba + '.');
  } finally {
    lock.releaseLock();
  }
}

function crudExcluir(nomeAba, id) {
  var cfg = CRUD_CONFIG[nomeAba];
  if (!cfg) throw new Error('Aba não autorizada: ' + nomeAba);
  exigirFuncao(cfg.escrita);

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var aba = ss_().getSheetByName(nomeAba);
    var valores = aba.getDataRange().getValues();
    for (var r = 1; r < valores.length; r++) {
      if (String(valores[r][0]) === String(id)) {
        aba.deleteRow(r + 1);
        return { ok: true };
      }
    }
    throw new Error('Registro ' + id + ' não encontrado em ' + nomeAba + '.');
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------
// REGISTRO DE AULAS (com validações de negócio)
// ---------------------------------------------------------------
function registrarAula(p) {
  var usuario = exigirFuncao(['Admin', 'Operador']);

  if (!p || !p.idTurma) throw new Error('Selecione a turma.');
  if (!p.data) throw new Error('Informe a data.');
  if (!p.tipoAtividade) throw new Error('Selecione o tipo de atividade.');
  if (!p.metodologia) throw new Error('Selecione a metodologia.');
  var tempos = Number(p.tempos);
  if (!tempos || tempos <= 0) throw new Error('Tempos consumidos deve ser um número maior que zero.');
  if (!p.idInstrutor) throw new Error('Selecione o instrutor.');

  var precisaMateria = TIPOS_SEM_MATERIA.indexOf(p.tipoAtividade) === -1;
  if (precisaMateria && !p.idGrade) throw new Error('Selecione a matéria (obrigatória para "' + p.tipoAtividade + '").');

  // Valida que a matéria pertence ao curso da turma
  if (p.idGrade) {
    var turma = lerAbaComoObjetos_(ABAS.TURMAS).filter(function (t) { return t['ID_Turma'] === p.idTurma; })[0];
    if (!turma) throw new Error('Turma não encontrada: ' + p.idTurma);
    var materia = lerAbaComoObjetos_(ABAS.MATERIAS).filter(function (m) { return m['ID_Grade'] === p.idGrade; })[0];
    if (!materia) throw new Error('Matéria não encontrada: ' + p.idGrade);
    if (String(materia['ID_Curso']) !== String(turma['ID_Curso'])) {
      throw new Error('A matéria "' + p.idGrade + '" não pertence ao curso da turma ' + p.idTurma + '.');
    }
  }

  // NOVO — Valida que o instrutor está habilitado (vinculado) na matéria: Contexto V1, regra 1
  if (p.idGrade) {
    var habilitado = lerAbaComoObjetos_(ABAS.VINCULOS).some(function (v) {
      var chaves = Object.keys(v);
      var vInstrutor = String(v['ID_Instrutor'] || v[chaves[1]] || '');
      var vGrade = String(v['ID_Grade (Matéria)'] || v['ID_Grade'] || '');
      return vGrade === String(p.idGrade) && vInstrutor === String(p.idInstrutor);
    });
    if (!habilitado) {
      throw new Error('O instrutor selecionado não está habilitado (vinculado) para ministrar esta matéria.');
    }
  }

  var res = crudCriar(ABAS.REGISTROS, {
    'ID_Registro': '',
    'Data': p.data,
    'ID_Turma': p.idTurma,
    'ID_Grade': p.idGrade || '',
    'ID_Instrutor': p.idInstrutor,
    'Tipo_Atividade': p.tipoAtividade,
    'Metodologia': p.metodologia,
    'Tempos_Consumidos': tempos,
    'Conteudo_Resumo': p.conteudo || '',
    'Observacoes': p.observacoes || '',
    'Registrado_Por': usuario.email
  });

  var saldo = p.idGrade ? saldoDaMateria_(p.idTurma, p.idGrade) : null;
  return { ok: true, id: res.id, saldo: saldo };
}

/** Saldo de tempos de uma matéria em uma turma: CH prevista − Σ consumido. */
function saldoDaMateria_(idTurma, idGrade) {
  var materia = lerAbaComoObjetos_(ABAS.MATERIAS).filter(function (m) { return m['ID_Grade'] === idGrade; })[0];
  var prevista = materia ? (Number(materia['Carga_Horaria']) || 0) : 0;
  var consumida = 0;
  lerAbaComoObjetos_(ABAS.REGISTROS).forEach(function (r) {
    if (r['ID_Turma'] === idTurma && r['ID_Grade'] === idGrade) {
      consumida += Number(r['Tempos_Consumidos']) || 0;
    }
  });
  return { prevista: prevista, consumida: consumida, saldo: prevista - consumida };
}

/** Agenda uma avaliação, validando matéria×curso e habilitação do instrutor responsável. */
function registrarAvaliacao(obj) {
  var usuario = exigirFuncao(['Admin', 'Operador']);
  if (!obj || !obj['ID_Turma'] || !obj['ID_Grade'] || !obj['Tipo_Avaliacao'] || !obj['Data_Avaliacao']) {
    throw new Error('Preencha turma, matéria, tipo e data da avaliação.');
  }

  var turma = lerAbaComoObjetos_(ABAS.TURMAS).filter(function (t) { return t['ID_Turma'] === obj['ID_Turma']; })[0];
  if (!turma) throw new Error('Turma não encontrada: ' + obj['ID_Turma']);
  var materia = lerAbaComoObjetos_(ABAS.MATERIAS).filter(function (m) { return m['ID_Grade'] === obj['ID_Grade']; })[0];
  if (!materia) throw new Error('Matéria não encontrada: ' + obj['ID_Grade']);
  if (String(materia['ID_Curso']) !== String(turma['ID_Curso'])) {
    throw new Error('A matéria não pertence ao curso da turma ' + obj['ID_Turma'] + '.');
  }

  if (obj['ID_Instrutor_Responsavel']) {
    var habilitado = lerAbaComoObjetos_(ABAS.VINCULOS).some(function (v) {
      var chaves = Object.keys(v);
      var vInstrutor = String(v['ID_Instrutor'] || v[chaves[1]] || '');
      var vGrade = String(v['ID_Grade (Matéria)'] || v['ID_Grade'] || '');
      return vGrade === String(obj['ID_Grade']) && vInstrutor === String(obj['ID_Instrutor_Responsavel']);
    });
    if (!habilitado) throw new Error('O instrutor responsável não está habilitado nesta matéria.');
  }

  obj['Registrado_Por'] = usuario.email; // paridade de auditoria com registrarAula; inofensivo se a coluna não existir
  return crudCriar(ABAS.AVALIACOES, obj);
}

// ---------------------------------------------------------------
// DSA — DETALHE SEMANAL DE AULA (versão semanal do Registro de Aulas)
// ---------------------------------------------------------------

/**
 * Cria as abas do módulo DSA se ainda não existirem, semeia o catálogo padrão de
 * Cad_TiposEvento e garante as colunas de rastreio em Registro_Aulas_E_Atividades.
 * Rode uma vez (via botão "Configurar estrutura" no front, ou pelo editor do Apps Script).
 */
function configurarSistemaDSA() {
  exigirFuncao(['Admin']);

  var especificacoes = {
    'DSA_Semanas':    ['ID_Semana', 'ID_Turma', 'Numero_Semana', 'Data_Inicio', 'Data_Fim', 'Regime_Esforco', 'Status', 'Versao_Atual', 'Criado_Por', 'Criado_Em', 'Atualizado_Por', 'Atualizado_Em'],
    'DSA_Alteracoes': ['ID_Alteracao', 'ID_Semana', 'Numero_Alteracao', 'Tipo', 'Alterado_Por', 'Alterado_Em', 'Snapshot_JSON', 'Observacao'],
    'DSA_Tempos':     ['ID_Tempo', 'ID_Semana', 'Data', 'Tempo_Num', 'Periodo', 'Hora_Inicio', 'Hora_Fim', 'Tipo_Registro', 'ID_Grade', 'ID_TipoEvento', 'ID_Instrutor', 'Local', 'TE', 'Descricao_UE', 'Observacoes'],
    'Cad_TiposEvento': ['Codigo', 'Categoria', 'Nome', 'Requer_Materia', 'Requer_Instrutor', 'Ativo']
  };

  var criadas = [];
  Object.keys(especificacoes).forEach(function (nome) {
    if (!ss_().getSheetByName(nome)) {
      var aba = ss_().insertSheet(nome);
      aba.getRange(1, 1, 1, especificacoes[nome].length).setValues([especificacoes[nome]]);
      aba.setFrozenRows(1);
      criadas.push(nome);
    }
  });

  if (criadas.indexOf('Cad_TiposEvento') !== -1) {
    var padrao = [
      ['TR',    'Tempo Reserva/Estudo',       'Tempo Reserva (Estudo Dirigido)',  'Não', 'Não', 'Sim'],
      ['EI',    'Tempo Reserva/Estudo',       'Estudo Individual',                'Não', 'Não', 'Sim'],
      ['LA',    'Licença Administrativa',     'Licença Administrativa',           'Não', 'Não', 'Sim'],
      ['FR',    'Licença Administrativa',     'Feriado',                          'Não', 'Não', 'Sim'],
      ['EC',    'Atividade Extracurricular',  'Extra-Classe',                     'Não', 'Não', 'Sim'],
      ['PAL',   'Evento Extra',               'Palestra',                         'Não', 'Sim', 'Sim'],
      ['SIMP',  'Evento Extra',               'Simpósio',                         'Não', 'Não', 'Sim'],
      ['COLQ',  'Evento Extra',               'Colóquio',                         'Não', 'Não', 'Sim'],
      ['CERIM', 'Evento Extra',               'Evento/Cerimônia',                 'Não', 'Não', 'Sim'],
      ['TA',    'Tarefa Administrativa',      'Tarefa Administrativa',            'Não', 'Não', 'Sim'],
      ['AV',    'Avaliação',                  'Avaliação (Prova/Trabalho)',       'Sim', 'Sim', 'Sim'],
      ['VP',    'Avaliação',                  'Vista de Prova',                   'Sim', 'Sim', 'Sim']
    ];
    ss_().getSheetByName('Cad_TiposEvento').getRange(2, 1, padrao.length, padrao[0].length).setValues(padrao);
  }

  garantirColuna_(ABAS.REGISTROS, 'ID_Semana_DSA');
  garantirColuna_(ABAS.REGISTROS, 'ID_Tempo_DSA');

  return {
    ok: true,
    abasCriadas: criadas,
    mensagem: criadas.length ? ('Estrutura criada: ' + criadas.join(', ') + '.') : 'Estrutura do DSA já existia — nada a fazer.'
  };
}

/**
 * Calcula todas as semanas do curso (a partir de Data_Inicio/Data_Termino da turma),
 * cruza com DSA_Semanas já salvas e identifica a semana atual (abertura inteligente):
 * a primeira semana que ainda não está com status "Oficial".
 */
function getEstruturaSemanas(idTurma) {
  exigirFuncao(['Admin', 'Operador', 'Visualizacao']);
  exigirEstruturaDSA_();

  var turma = lerAbaComoObjetos_(ABAS.TURMAS).filter(function (t) { return t['ID_Turma'] === idTurma; })[0];
  if (!turma) throw new Error('Turma não encontrada: ' + idTurma);

  var inicio = isoParaDate_(turma['Data_Inicio']);
  var termino = isoParaDate_(turma['Data_Termino']);
  if (!(inicio instanceof Date) || !(termino instanceof Date)) {
    throw new Error('A turma ' + idTurma + ' não tem Data_Inicio/Data_Termino definidas.');
  }
  var regime = turma['Regime_Esforco'] || '';
  var incluirSabado = (regime === 'Marcha 3');
  var diasNaSemana = incluirSabado ? 6 : 5;

  var existentesPorNumero = {};
  lerAbaComoObjetos_(ABAS.DSA_SEMANAS)
    .filter(function (s) { return s['ID_Turma'] === idTurma; })
    .forEach(function (s) { existentesPorNumero[Number(s['Numero_Semana'])] = s; });

  var semanas = [];
  var cursor = new Date(inicio.getTime());
  var numero = 1;
  while (cursor <= termino) {
    var fimSemana = new Date(cursor.getTime());
    fimSemana.setDate(fimSemana.getDate() + (diasNaSemana - 1));
    if (fimSemana > termino) fimSemana = new Date(termino.getTime());

    var existente = existentesPorNumero[numero];
    semanas.push({
      numero: numero,
      dataInicio: Utilities.formatDate(cursor, tz_(), 'yyyy-MM-dd'),
      dataFim: Utilities.formatDate(fimSemana, tz_(), 'yyyy-MM-dd'),
      status: existente ? existente['Status'] : 'Não iniciada',
      idSemana: existente ? existente['ID_Semana'] : null,
      versaoAtual: existente ? Number(existente['Versao_Atual']) : null
    });

    cursor.setDate(cursor.getDate() + 7);
    numero++;
  }

  var idxAtual = semanas.findIndex(function (s) { return s.status !== 'Oficial'; });
  var semanaAtual = idxAtual === -1 ? (semanas.length ? semanas[semanas.length - 1].numero : 1) : semanas[idxAtual].numero;

  return { semanas: semanas, semanaAtual: semanaAtual };
}

/** Cabeçalho + grid atual + histórico de alterações de uma semana específica do DSA. */
function getDSASemana(idTurma, numeroSemana) {
  exigirFuncao(['Admin', 'Operador', 'Visualizacao']);
  exigirEstruturaDSA_();

  var turma = lerAbaComoObjetos_(ABAS.TURMAS).filter(function (t) { return t['ID_Turma'] === idTurma; })[0];
  if (!turma) throw new Error('Turma não encontrada: ' + idTurma);

  var estrutura = getEstruturaSemanas(idTurma);
  var infoSemana = estrutura.semanas.filter(function (s) { return s.numero === Number(numeroSemana); })[0];
  if (!infoSemana) throw new Error('Semana ' + numeroSemana + ' fora do intervalo do curso ' + idTurma + '.');

  var regime = turma['Regime_Esforco'] || '';
  var temposPorDia = TEMPOS_POR_DIA_REGIME[regime] || Number(turma['Tempos_Por_Dia']) || TEMPOS_POR_DIA_PADRAO;
  var incluirSabado = (regime === 'Marcha 3');

  var tempos = [];
  var historico = [];
  if (infoSemana.idSemana) {
    tempos = lerAbaComoObjetos_(ABAS.DSA_TEMPOS).filter(function (t) { return t['ID_Semana'] === infoSemana.idSemana; });
    historico = lerAbaComoObjetos_(ABAS.DSA_ALTERACOES)
      .filter(function (a) { return a['ID_Semana'] === infoSemana.idSemana; })
      .map(function (a) {
        return { numero: Number(a['Numero_Alteracao']), tipo: a['Tipo'], por: a['Alterado_Por'], em: a['Alterado_Em'], obs: a['Observacao'] || '' };
      })
      .sort(function (a, b) { return a.numero - b.numero; });
  }

  return {
    turma: { idTurma: turma['ID_Turma'], nome: turma['Nome_Completo_Curso'], regime: regime },
    semana: infoSemana,
    temposPorDia: temposPorDia,
    incluirSabado: incluirSabado,
    horarios: horariosPorRegime_(regime, Math.max(temposPorDia, TEMPOS_POR_DIA_REGIME['Marcha 2'])),
    tempos: tempos,
    historico: historico
  };
}

/**
 * Algoritmo de alocação (v1): cruza as matérias com saldo pendente (mesma lógica de
 * saldoDaMateria_ já usada no resto do sistema) com a capacidade da semana e preenche
 * os tempos em blocos contínuos, autopreenchendo o instrutor pelo vínculo Instrutor_Materia.
 * O resultado é salvo com status "Prévia" — o usuário pode reescrever tudo antes de confirmar.
 */
function gerarPreviaDSA(idTurma, numeroSemana) {
  var usuario = exigirFuncao(['Admin', 'Operador']);
  exigirEstruturaDSA_();

  var turma = lerAbaComoObjetos_(ABAS.TURMAS).filter(function (t) { return t['ID_Turma'] === idTurma; })[0];
  if (!turma) throw new Error('Turma não encontrada: ' + idTurma);

  var estrutura = getEstruturaSemanas(idTurma);
  var infoSemana = estrutura.semanas.filter(function (s) { return s.numero === Number(numeroSemana); })[0];
  if (!infoSemana) throw new Error('Semana ' + numeroSemana + ' fora do intervalo do curso ' + idTurma + '.');
  if (infoSemana.status === 'Oficial') {
    throw new Error('A semana ' + numeroSemana + ' já está com registro Oficial. Edite manualmente em vez de gerar nova prévia.');
  }

  var regime = turma['Regime_Esforco'] || '';
  var temposPorDia = TEMPOS_POR_DIA_REGIME[regime] || Number(turma['Tempos_Por_Dia']) || TEMPOS_POR_DIA_PADRAO;
  var horarios = horariosPorRegime_(regime, temposPorDia);

  var materias = lerAbaComoObjetos_(ABAS.MATERIAS).filter(function (m) { return String(m['ID_Curso']) === String(turma['ID_Curso']); });
  var fila = materias
    .map(function (m) {
      var saldo = saldoDaMateria_(idTurma, m['ID_Grade']);
      return { idGrade: m['ID_Grade'], saldo: saldo.saldo };
    })
    .filter(function (m) { return m.saldo > 0; });

  var vinculos = lerAbaComoObjetos_(ABAS.VINCULOS);
  function instrutorPadrao_(idGrade) {
    var v = vinculos.filter(function (v) {
      var chaves = Object.keys(v);
      var vGrade = String(v['ID_Grade (Matéria)'] || v['ID_Grade'] || '');
      return vGrade === String(idGrade);
    })[0];
    if (!v) return '';
    var chaves = Object.keys(v);
    return String(v['ID_Instrutor'] || v[chaves[1]] || '');
  }

  var diasDaSemana = [];
  var cursor = isoParaDate_(infoSemana.dataInicio);
  var fimSemana = isoParaDate_(infoSemana.dataFim);
  while (cursor <= fimSemana) {
    diasDaSemana.push(Utilities.formatDate(cursor, tz_(), 'yyyy-MM-dd'));
    cursor.setDate(cursor.getDate() + 1);
  }

  var novosTempos = [];
  diasDaSemana.forEach(function (dataISO) {
    for (var i = 0; i < temposPorDia; i++) {
      var h = horarios[i];
      while (fila.length && fila[0].saldo <= 0) fila.shift();
      var alocacao = fila.length ? fila[0] : null;

      if (alocacao) {
        alocacao.saldo -= 1;
        novosTempos.push({
          data: dataISO, tempoNum: h.tempo, periodo: h.periodo, horaInicio: h.inicio, horaFim: h.fim,
          tipoRegistro: 'Materia', idGrade: alocacao.idGrade, idTipoEvento: '',
          idInstrutor: instrutorPadrao_(alocacao.idGrade), local: '', te: 'EO', descricaoUE: '', observacoes: ''
        });
      } else {
        novosTempos.push({
          data: dataISO, tempoNum: h.tempo, periodo: h.periodo, horaInicio: h.inicio, horaFim: h.fim,
          tipoRegistro: 'Evento', idGrade: '', idTipoEvento: 'TR',
          idInstrutor: '', local: '', te: 'EI', descricaoUE: '', observacoes: 'Gerado pela Prévia automática — sem matéria pendente disponível.'
        });
      }
    }
  });

  return salvarDSA_({
    idTurma: idTurma, numeroSemana: numeroSemana, regime: regime,
    dataInicio: infoSemana.dataInicio, dataFim: infoSemana.dataFim,
    tempos: novosTempos, tipoAlteracao: 'Prévia_Automática', usuario: usuario, observacao: ''
  }, infoSemana.idSemana);
}

/** Salva a semana (Prévia editada ou Oficial) vinda do front, registrando nova Alteração. */
function salvarDSA(payload) {
  var usuario = exigirFuncao(['Admin', 'Operador']);
  exigirEstruturaDSA_();

  if (!payload || !payload.idTurma || !payload.numeroSemana || !payload.tempos) {
    throw new Error('Dados incompletos para salvar o Detalhe Semanal de Aula.');
  }

  var turma = lerAbaComoObjetos_(ABAS.TURMAS).filter(function (t) { return t['ID_Turma'] === payload.idTurma; })[0];
  if (!turma) throw new Error('Turma não encontrada: ' + payload.idTurma);

  var estrutura = getEstruturaSemanas(payload.idTurma);
  var infoSemana = estrutura.semanas.filter(function (s) { return s.numero === Number(payload.numeroSemana); })[0];
  if (!infoSemana) throw new Error('Semana ' + payload.numeroSemana + ' fora do intervalo do curso ' + payload.idTurma + '.');

  return salvarDSA_({
    idTurma: payload.idTurma, numeroSemana: payload.numeroSemana, regime: turma['Regime_Esforco'] || '',
    dataInicio: infoSemana.dataInicio, dataFim: infoSemana.dataFim,
    tempos: payload.tempos, tipoAlteracao: 'Edição_Manual', usuario: usuario, observacao: payload.observacao || ''
  }, infoSemana.idSemana);
}

/**
 * Núcleo do versionamento: cria/atualiza DSA_Semanas, regrava DSA_Tempos do zero (mais
 * simples e seguro que diff célula a célula) e grava uma nova linha em DSA_Alteracoes
 * com snapshot completo — é o "Alteração 1, 2, 3..." pedido. Só promove a semana para
 * "Oficial" (e só então sincroniza com Registro_Aulas_E_Atividades) numa Edição_Manual;
 * uma Prévia_Automática fica marcada como rascunho e não entra nos dashboards ainda.
 */
function salvarDSA_(dados, idSemanaExistente) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var agora = new Date();
    var idSemana = idSemanaExistente;
    var novaVersao = 0;
    var statusFinal = dados.tipoAlteracao === 'Prévia_Automática' ? 'Prévia' : 'Oficial';

    if (!idSemana) {
      var criada = crudCriar(ABAS.DSA_SEMANAS, {
        'ID_Semana': '', 'ID_Turma': dados.idTurma, 'Numero_Semana': dados.numeroSemana,
        'Data_Inicio': dados.dataInicio, 'Data_Fim': dados.dataFim, 'Regime_Esforco': dados.regime,
        'Status': statusFinal, 'Versao_Atual': 0,
        'Criado_Por': dados.usuario.email, 'Criado_Em': agora, 'Atualizado_Por': dados.usuario.email, 'Atualizado_Em': agora
      });
      idSemana = criada.id;
    } else {
      var semanaAtual = lerAbaComoObjetos_(ABAS.DSA_SEMANAS).filter(function (s) { return s['ID_Semana'] === idSemana; })[0];
      novaVersao = Number(semanaAtual['Versao_Atual']) + 1;
      crudAtualizar(ABAS.DSA_SEMANAS, idSemana, {
        'Status': statusFinal, 'Versao_Atual': novaVersao,
        'Atualizado_Por': dados.usuario.email, 'Atualizado_Em': agora
      });
    }

    // Regrava os tempos da semana do zero (o estado "vivo" fica só em DSA_Tempos; o
    // histórico versionado fica no snapshot de DSA_Alteracoes abaixo).
    var abaTempos = ss_().getSheetByName(ABAS.DSA_TEMPOS);
    var valoresTempos = abaTempos.getDataRange().getValues();
    for (var r = valoresTempos.length - 1; r >= 1; r--) {
      if (String(valoresTempos[r][1]) === String(idSemana)) abaTempos.deleteRow(r + 1);
    }
    dados.tempos.forEach(function (t) {
      crudCriar(ABAS.DSA_TEMPOS, {
        'ID_Tempo': '', 'ID_Semana': idSemana, 'Data': t.data, 'Tempo_Num': t.tempoNum, 'Periodo': t.periodo,
        'Hora_Inicio': t.horaInicio, 'Hora_Fim': t.horaFim, 'Tipo_Registro': t.tipoRegistro,
        'ID_Grade': t.idGrade || '', 'ID_TipoEvento': t.idTipoEvento || '', 'ID_Instrutor': t.idInstrutor || '',
        'Local': t.local || '', 'TE': t.te || '', 'Descricao_UE': t.descricaoUE || '', 'Observacoes': t.observacoes || ''
      });
    });

    crudCriar(ABAS.DSA_ALTERACOES, {
      'ID_Alteracao': '', 'ID_Semana': idSemana, 'Numero_Alteracao': novaVersao, 'Tipo': dados.tipoAlteracao,
      'Alterado_Por': dados.usuario.email, 'Alterado_Em': agora,
      'Snapshot_JSON': JSON.stringify(dados.tempos), 'Observacao': dados.observacao || ''
    });

    if (statusFinal === 'Oficial') sincronizarRegistroAulas_(idSemana, dados.idTurma);

    return { ok: true, idSemana: idSemana, versao: novaVersao, status: statusFinal };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Sincroniza DSA_Tempos -> Registro_Aulas_E_Atividades (insere/atualiza/remove), cumprindo
 * o requisito de manter o registro oficial de aulas espelhado no que está no DSA. Só
 * tempos com matéria, ou eventos de categoria letiva (Avaliação/Extracurricular/Evento
 * Extra), viram registro de aula — Licença Administrativa, Feriado e Tempo Reserva/Estudo
 * são administrativos e não entram no cômputo de aulas ministradas.
 */
function sincronizarRegistroAulas_(idSemana, idTurma) {
  var CATEGORIAS_LETIVAS = ['Avaliação', 'Atividade Extracurricular', 'Evento Extra'];
  var tiposEventoPorCodigo = {};
  lerAbaComoObjetos_(ABAS.TIPOS_EVENTO).forEach(function (e) { tiposEventoPorCodigo[e['Codigo']] = e; });

  var tempos = lerAbaComoObjetos_(ABAS.DSA_TEMPOS).filter(function (t) { return t['ID_Semana'] === idSemana; });
  var registrosExistentes = lerAbaComoObjetos_(ABAS.REGISTROS).filter(function (r) { return r['ID_Semana_DSA'] === idSemana; });
  var existentesPorTempo = {};
  registrosExistentes.forEach(function (r) { existentesPorTempo[r['ID_Tempo_DSA']] = r; });

  var mantidos = {};
  tempos.forEach(function (t) {
    var ev = tiposEventoPorCodigo[t['ID_TipoEvento']];
    var deveSincronizar = t['Tipo_Registro'] === 'Materia' ||
      (t['Tipo_Registro'] === 'Evento' && ev && CATEGORIAS_LETIVAS.indexOf(ev['Categoria']) !== -1);
    if (!deveSincronizar) return;

    mantidos[t['ID_Tempo']] = true;
    var dadosLinha = {
      'Data': t['Data'], 'ID_Turma': idTurma,
      'ID_Grade': t['Tipo_Registro'] === 'Materia' ? t['ID_Grade'] : '',
      'ID_Instrutor': t['ID_Instrutor'] || '',
      'Tipo_Atividade': t['Tipo_Registro'] === 'Materia' ? 'Aula' : (ev ? ev['Nome'] : ''),
      'Metodologia': t['TE'] || '',
      'Tempos_Consumidos': 1,
      'Conteudo_Resumo': t['Descricao_UE'] || '',
      'Observacoes': t['Observacoes'] || '',
      'Registrado_Por': 'DSA (sincronização automática)',
      'ID_Semana_DSA': idSemana,
      'ID_Tempo_DSA': t['ID_Tempo']
    };

    var existente = existentesPorTempo[t['ID_Tempo']];
    if (existente) {
      crudAtualizar(ABAS.REGISTROS, existente['ID_Registro'], dadosLinha);
    } else {
      crudCriar(ABAS.REGISTROS, dadosLinha);
    }
  });

  registrosExistentes.forEach(function (r) {
    if (!mantidos[r['ID_Tempo_DSA']]) crudExcluir(ABAS.REGISTROS, r['ID_Registro']);
  });
}

// ---------------------------------------------------------------
// DASHBOARDS
// ---------------------------------------------------------------
/** Panorama geral: uma linha por turma, com progresso e alerta preditivo. */
function getDashboardGeral() {
  exigirFuncao(['Admin', 'Operador', 'Visualizacao']);

  var turmas = lerAbaComoObjetos_(ABAS.TURMAS);
  var materias = lerAbaComoObjetos_(ABAS.MATERIAS);
  var registros = lerAbaComoObjetos_(ABAS.REGISTROS);
  var feriados = feriadosDiaInteiro_();                 // NOVO
  var hoje = new Date(); hoje.setHours(0, 0, 0, 0);

  // CH prevista por curso
  var chPorCurso = {};
  materias.forEach(function (m) {
    var c = m['ID_Curso'];
    chPorCurso[c] = (chPorCurso[c] || 0) + cargaHorariaDe_(m);   // ALTERADO
  });

  // consumo por turma (só registros com matéria contam no progresso da grade)
  var consumoTurma = {}, extrasTurma = {};
  registros.forEach(function (r) {
    var t = r['ID_Turma'];
    var v = Number(r['Tempos_Consumidos']) || 0;
    if (r['ID_Grade']) consumoTurma[t] = (consumoTurma[t] || 0) + v;
    else extrasTurma[t] = (extrasTurma[t] || 0) + v;
  });

  return turmas.map(function (t) {
    var prevista = chPorCurso[t['ID_Curso']] || 0;
    var consumida = consumoTurma[t['ID_Turma']] || 0;
    var restante = Math.max(prevista - consumida, 0);
    var termino = isoParaDate_(t['Data_Termino']);
    var regime = t['Regime_Esforco'] || '';                                                              // NOVO
    var temposDia = TEMPOS_POR_DIA_REGIME[regime] || Number(t['Tempos_Por_Dia']) || TEMPOS_POR_DIA_PADRAO; // ALTERADO
    var du = (termino instanceof Date) ? diasUteis_(hoje, termino, regime, feriados) : 0;                 // ALTERADO
    var capacidade = du * temposDia;
    var gordura = capacidade - restante;
    var emAndamento = (t['Status'] === 'Ativa');
    return {
      idTurma: t['ID_Turma'],
      nome: t['Nome_Completo_Curso'],
      status: t['Status'],
      prevista: prevista,
      consumida: consumida,
      extras: extrasTurma[t['ID_Turma']] || 0,
      pct: prevista ? Math.round(100 * consumida / prevista) : 0,
      diasUteisRestantes: du,
      capacidadeRestante: capacidade,
      gordura: gordura,
      regime: regime || '—',                                                                              // NOVO
      atrasada: emAndamento && gordura < 0
    };
  });
}

/** Detalhe de uma turma: saldo por matéria + resumo + próximas avaliações. */
function getDashboardTurma(idTurma) {
  exigirFuncao(['Admin', 'Operador', 'Visualizacao']);

  var turma = lerAbaComoObjetos_(ABAS.TURMAS).filter(function (t) { return t['ID_Turma'] === idTurma; })[0];
  if (!turma) throw new Error('Turma não encontrada: ' + idTurma);

  var materias = lerAbaComoObjetos_(ABAS.MATERIAS).filter(function (m) { return String(m['ID_Curso']) === String(turma['ID_Curso']); });
  var registros = lerAbaComoObjetos_(ABAS.REGISTROS).filter(function (r) { return r['ID_Turma'] === idTurma; });
  var avaliacoes = lerAbaComoObjetos_(ABAS.AVALIACOES).filter(function (a) { return a['ID_Turma'] === idTurma; });
  var feriados = feriadosDiaInteiro_();                 // NOVO

  var consumoPorGrade = {};
  registros.forEach(function (r) {
    if (r['ID_Grade']) consumoPorGrade[r['ID_Grade']] = (consumoPorGrade[r['ID_Grade']] || 0) + (Number(r['Tempos_Consumidos']) || 0);
  });

  var linhas = materias.map(function (m) {
    var prevista = cargaHorariaDe_(m);                    // ALTERADO
    var consumida = consumoPorGrade[m['ID_Grade']] || 0;
    var pct = prevista ? Math.round(100 * consumida / prevista) : 0;
    var st = consumida === 0 ? 'Não iniciada' : (consumida >= prevista ? 'Concluída' : 'Em andamento');
    if (consumida > prevista) st = 'Excedida';
    return { idGrade: m['ID_Grade'], cod: m['Cod'], nome: m['Nome_Materia'], prevista: prevista, consumida: consumida, saldo: prevista - consumida, pct: pct, status: st };
  });

  var totPrev = linhas.reduce(function (s, l) { return s + l.prevista; }, 0);
  var totCons = linhas.reduce(function (s, l) { return s + l.consumida; }, 0);
  var hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  var termino = isoParaDate_(turma['Data_Termino']);
  var regime = turma['Regime_Esforco'] || '';                                                              // NOVO
  var temposDia = TEMPOS_POR_DIA_REGIME[regime] || Number(turma['Tempos_Por_Dia']) || TEMPOS_POR_DIA_PADRAO; // ALTERADO
  var du = (termino instanceof Date) ? diasUteis_(hoje, termino, regime, feriados) : 0;                     // ALTERADO
  var capacidade = du * temposDia;
  var restante = Math.max(totPrev - totCons, 0);
  var gordura = capacidade - restante;

  return {
    turma: {
      idTurma: turma['ID_Turma'], nome: turma['Nome_Completo_Curso'], status: turma['Status'],
      dataInicio: turma['Data_Inicio'], dataTermino: turma['Data_Termino'], temposPorDia: temposDia,
      regime: regime || '—'                                                                                // NOVO
    },
    resumo: {
      prevista: totPrev, consumida: totCons, restante: restante,
      pct: totPrev ? Math.round(100 * totCons / totPrev) : 0,
      diasUteisRestantes: du, capacidadeRestante: capacidade,
      gordura: gordura, gorduraDias: temposDia ? Math.floor(gordura / temposDia) : 0,
      atrasada: (turma['Status'] === 'Ativa') && gordura < 0
    },
    materias: linhas,
    avaliacoes: avaliacoes
  };
}

// ---------------------------------------------------------------
// RELATÓRIO / IMPRESSÃO
// ---------------------------------------------------------------
function getRelatorio(idTurma, dataIniISO, dataFimISO) {
  exigirFuncao(['Admin', 'Operador', 'Visualizacao']);
  if (!idTurma) throw new Error('Selecione a turma.');

  var turma = lerAbaComoObjetos_(ABAS.TURMAS).filter(function (t) { return t['ID_Turma'] === idTurma; })[0];
  if (!turma) throw new Error('Turma não encontrada.');

  var mapMat = {}, mapInst = {};
  lerAbaComoObjetos_(ABAS.MATERIAS).forEach(function (m) { mapMat[m['ID_Grade']] = m['Nome_Materia']; });
  lerAbaComoObjetos_(ABAS.INSTRUTORES).forEach(function (i) { mapInst[String(i['ID_Instrutor'])] = (i['P/G'] || '') + ' ' + (i['NOME'] || ''); });

  var ini = dataIniISO ? isoParaDate_(dataIniISO) : null;
  var fim = dataFimISO ? isoParaDate_(dataFimISO) : null;

  var linhas = lerAbaComoObjetos_(ABAS.REGISTROS)
    .filter(function (r) {
      if (r['ID_Turma'] !== idTurma) return false;
      var d = isoParaDate_(r['Data']);
      if (ini && d < ini) return false;
      if (fim && d > fim) return false;
      return true;
    })
    .map(function (r) {
      return {
        data: r['Data'],
        materia: r['ID_Grade'] ? (mapMat[r['ID_Grade']] || r['ID_Grade']) : '— (atividade geral)',
        instrutor: mapInst[String(r['ID_Instrutor'])] || r['ID_Instrutor'],
        tipo: r['Tipo_Atividade'],
        metodologia: r['Metodologia'],
        tempos: Number(r['Tempos_Consumidos']) || 0,
        conteudo: r['Conteudo_Resumo'] || '',
        obs: r['Observacoes'] || ''
      };
    })
    .sort(function (a, b) { return a.data < b.data ? -1 : (a.data > b.data ? 1 : 0); });

  var totalTempos = linhas.reduce(function (s, l) { return s + l.tempos; }, 0);

  return {
    turma: { idTurma: turma['ID_Turma'], nome: turma['Nome_Completo_Curso'], periodo: (turma['Data_Inicio'] || '') + ' a ' + (turma['Data_Termino'] || '') },
    filtro: { de: dataIniISO || '', ate: dataFimISO || '' },
    linhas: linhas,
    totalTempos: totalTempos,
    geradoEm: Utilities.formatDate(new Date(), tz_(), 'dd/MM/yyyy HH:mm'),
    geradoPor: getUsuarioAtual().nome
  };
}

// ---------------------------------------------------------------
// TESTE MANUAL
// ---------------------------------------------------------------
function testarAutenticacao() {
  var u = getUsuarioAtual();
  Logger.log(u ? ('Autenticado: ' + u.nome + ' (' + u.funcao + ')') : ('Não cadastrado: ' + Session.getActiveUser().getEmail()));
}