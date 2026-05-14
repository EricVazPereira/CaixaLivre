/**
 * erp.js — Integração com a API REST DataSnap do ERP Fenix
 * Base:  <Endereço do Network.ini>/datasnap/rest/TSM
 * Auth:  Basic  TOKEN_AUTENTICACAO_API : 123
 */

const http  = require('http');
const https = require('https');

const { ERP_HOST, ERP_PORT, ERP_HTTPS, ERP_AUTH, NM_ESTACAO } = require('./config');

const httpLib  = ERP_HTTPS ? https : http;
const ERP_BASE = '/datasnap/rest/TSM';

/**
 * Executa uma requisição HTTP ao ERP e resolve com result[0] ou o valor cru.
 * @param {number} [timeoutMs=10000] - Timeout em ms. Use valores maiores para
 *   operações pesadas (GravaItens, FechamentoComanda) que envolvem I/O de BD.
 */
function requisitarERP(method, path, body = null, timeoutMs = 10_000) {
  const json    = body ? JSON.stringify(body) : null;
  const headers = {
    Authorization: ERP_AUTH,
    Accept:        'application/json',
    ...(json && { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) }),
  };

  return new Promise((resolve, reject) => {
    const req = httpLib.request({ hostname: ERP_HOST, port: ERP_PORT, path, method, headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        console.log(`[ERP] ${method} ${path} → HTTP ${res.statusCode} | ${data}`);
        if (res.statusCode < 200 || res.statusCode >= 300)
          return reject(new Error(`ERP ${path} → HTTP ${res.statusCode}: ${data}`));
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.result !== undefined ? parsed.result[0] : parsed);
        } catch {
          resolve(data.trim());
        }
      });
    });

    req.on('error', e => reject(new Error(`Conexão com ERP falhou: ${e.message}`)));
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error(`ERP timeout (${timeoutMs / 1000}s)`)); });
    if (json) req.write(json);
    req.end();
  });
}

const chamarERPPost = (metodo, body, timeoutMs) => requisitarERP('POST', `${ERP_BASE}/${metodo}`, body, timeoutMs);
const chamarERPGet  = (metodo, path)             => requisitarERP('GET',  `${ERP_BASE}/${metodo}/${path}`);

// ── Métodos do ERP ───────────────────────────────────────────────────────────

/**
 * Verifica se o caixa está aberto para este computador.
 * Retorna true (aberto) ou false (fechado).
 */
async function verificarCaixaAberto() {
  const result = await chamarERPPost('VerficaCxAberto', { nm_estacao: NM_ESTACAO });
  console.log('[VerficaCxAberto] resposta bruta:', JSON.stringify(result), '| estação:', NM_ESTACAO);
  // Retorna { retorno: "1" } quando aberto, { retorno: "0" } quando fechado
  const retorno = result?.retorno ?? result
  const aberto = String(retorno).trim() === '1';
  return { aberto, nm_estacao: NM_ESTACAO };
}

/**
 * Abre o caixa no ERP para este computador.
 * cod_operador e cod_executor são os códigos dos operadores (padrão "0" = GERAL).
 */
async function abrirCaixaERP(cod_operador = '0', cod_executor = '0') {
  return chamarERPPost('AberturaCX', {
    nm_estacao:   NM_ESTACAO,
    cod_operador: String(cod_operador),
    cod_executor: String(cod_executor),
  });
}

/**
 * Grava itens no ERP (cria a conta/consumo no ERP Fenix).
 *
 * @param {Object} opts
 * @param {string} opts.id       - ID da conta (vazio = ERP gera automaticamente)
 * @param {string} opts.nrMesa   - Número da mesa (vazio para totem)
 * @param {Array}  opts.consumo  - Lista de itens:
 *   { produto_codigo, quantidade, vl_unitario, obs }
 *
 * Retorna o que o ERP devolver (geralmente o ID da conta criada).
 */
async function gravarItensERP({ id = '', nrMesa = '', consumo = [] }) {
  // 30s: GravaItens envolve escrita no BD do ERP e pode demorar mais que o default,
  // especialmente na primeira chamada quando o ERP cria a conta/comanda.
  return chamarERPPost('GravaItens', {
    cabecalho: {
      ID:         id,
      nm_estacao: NM_ESTACAO,
      NrMesa:     nrMesa,
    },
    consumo: consumo.map(item => ({
      Cod_pro:   String(item.produto_codigo).padStart(14, '0'),
      Obs_pro:   item.obs || '',
      Qtde_pro:  String(item.quantidade),
      Vl_Pro:    (Number(item.vl_unitario) * Number(item.quantidade)).toFixed(2),
      Acomp_Pro: '',
    })),
  }, 30_000);
}

/**
 * Fecha a comanda no ERP (FechamentoComandaSmartPDV).
 *
 * @param {Object} opts
 * @param {string} opts.subtotal       - Soma dos itens sem acréscimo/desconto (ex: "10.00")
 * @param {string} opts.total          - Valor total a pagar (ex: "10.00")
 * @param {string} opts.barcode        - NRGERADOR retornado pelo GravaItens (ex: "004299")
 * @param {string} [opts.discount]     - Desconto (padrão "0")
 * @param {string} [opts.cpf]          - CPF do cliente (vazio se não informado)
 * @param {string} [opts.add_service]  - Acréscimo/taxa de serviço (vazio se não houver)
 * @param {string} opts.operadora      - Formato: "OPERADORA|VALOR|" (ex: "PIX|10.00|")
 */
async function fecharComandaERP({ subtotal, total, barcode, discount = '0', cpf = '', add_service = '0', operadora }) {
  // 30s: fechamento envolve geração de NF-Ce + escrita no BD, pode demorar.
  return chamarERPPost('FechamentoComandaSmartPDV', {
    subtotal:             String(subtotal),
    total:                String(total),
    barcode:              String(barcode),
    discount:             String(discount),
    cpf:                  cpf || '',
    add_service:          String(add_service),
    operadora_smart_pdv:  operadora,
    nm_estacao:           NM_ESTACAO,
  }, 30_000);
}

/**
 * Fecha o caixa no ERP (FechamentoCX).
 * @param {string} [cod_executor] - Código do executor (padrão "0")
 * Retorna ex: { message_sucess: "Caixa(X) Fechado com Sucesso !", sucess: true, id_sucess: 0 }
 */
async function fecharCaixaERP(cod_executor = '0') {
  return chamarERPPost('FechamentoCX', {
    nm_estacao:   NM_ESTACAO,
    cod_executor: String(cod_executor),
  });
}

/**
 * Consulta o FORMATO_PRO de um produto via ERP.
 * Retorna { cod_pro, ds_pro, formato_pro, fl_ativo } ou lança em caso de falha.
 */
const consultaFormatoProduto = (codPro) =>
  chamarERPGet('ConsultaFormatoProduto', encodeURIComponent(String(codPro)));

/**
 * Grava o FORMATO_PRO de um produto via ERP.
 * POST /datasnap/rest/TSM/GravaFormatoProduto
 * Body: { cod_pro: "1", formato: "1" }
 */
function gravaFormatoProduto(codPro, pesoGramas) {
  return chamarERPPost('GravaFormatoProduto', {
    cod_pro: String(codPro),
    formato: String(pesoGramas),
  });
}

/**
 * Busca os dados da empresa via ERP.
 * GET /datasnap/rest/TSM/PegaDadosEmpresa
 * Retorna objeto com CNPJ, IE, Nome Fantasia, Razao Social, endereço etc.
 */
const pegaDadosEmpresa = () =>
  requisitarERP('GET', `${ERP_BASE}/PegaDadosEmpresa`);

module.exports = { NM_ESTACAO, verificarCaixaAberto, abrirCaixaERP, gravarItensERP, fecharComandaERP, fecharCaixaERP, consultaFormatoProduto, gravaFormatoProduto, pegaDadosEmpresa };
