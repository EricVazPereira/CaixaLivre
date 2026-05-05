/**
 * erp.js — Integração com a API REST DataSnap do ERP Fenix
 * Base:  <Endereço do Network.ini>/datasnap/rest/TSM
 * Auth:  Basic  TOKEN_AUTENTICACAO_API : 123
 */

const http  = require('http');
const https = require('https');
const os    = require('os');

const { ERP_HOST, ERP_PORT, ERP_HTTPS, ERP_AUTH } = require('./config');

const httpLib  = ERP_HTTPS ? https : http;
const ERP_BASE = '/datasnap/rest/TSM';
const AUTH     = ERP_AUTH;

/** Nome do computador — usado como NM_ESTACAO em todas as chamadas */
const NM_ESTACAO = os.hostname().toUpperCase();

/**
 * Faz POST JSON para um método DataSnap.
 * DataSnap mapeia POST → update<metodo>, então use para métodos que começam com "update" no ERP.
 * Retorna result[0] ou o valor cru.
 */
function chamarERPPost(metodo, body = {}) {
  const json = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: ERP_HOST,
      port:     ERP_PORT,
      path:     `${ERP_BASE}/${metodo}`,
      method:   'POST',
      headers: {
        Authorization:    AUTH,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(json),
        Accept:           'application/json',
      },
    };

    const req = httpLib.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300)
          return reject(new Error(`ERP ${metodo} → HTTP ${res.statusCode}: ${data}`));
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.result !== undefined ? parsed.result[0] : parsed);
        } catch {
          resolve(data.trim());
        }
      });
    });

    req.on('error', e => reject(new Error(`Conexão com ERP falhou: ${e.message}`)));
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('ERP timeout (10s)')); });
    req.write(json);
    req.end();
  });
}

/**
 * Faz GET para um método DataSnap passando parâmetros como segmentos de URL.
 * DataSnap mapeia GET → <metodo> diretamente (sem prefixo).
 * O parâmetro é passado como JSON URL-encoded no path: /TSM/metodo/<json>
 */
function chamarERPGet(metodo, params = {}) {
  const paramEncoded = encodeURIComponent(JSON.stringify(params));
  const path = `${ERP_BASE}/${metodo}/${paramEncoded}`;

  return new Promise((resolve, reject) => {
    const options = {
      hostname: ERP_HOST,
      port:     ERP_PORT,
      path,
      method:   'GET',
      headers: {
        Authorization: AUTH,
        Accept:        'application/json',
      },
    };

    const req = httpLib.request(options, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300)
          return reject(new Error(`ERP ${metodo} → HTTP ${res.statusCode}: ${data}`));
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.result !== undefined ? parsed.result[0] : parsed);
        } catch {
          resolve(data.trim());
        }
      });
    });

    req.on('error', e => reject(new Error(`Conexão com ERP falhou: ${e.message}`)));
    req.setTimeout(10_000, () => { req.destroy(); reject(new Error('ERP timeout (10s)')); });
    req.end();
  });
}

// Alias para manter compatibilidade com chamadas existentes (POST)
const chamarERP = chamarERPPost;

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
  return chamarERP('AberturaCX', {
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
      Vl_Pro:    Number(item.vl_unitario).toFixed(2),
      Acomp_Pro: '',
    })),
  });
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
async function fecharComandaERP({ subtotal, total, barcode, discount = '0', cpf = '', add_service = '', operadora }) {
  return chamarERPPost('FechamentoComandaSmartPDV', {
    subtotal:             String(subtotal),
    total:                String(total),
    barcode:              String(barcode),
    discount:             String(discount || '0'),
    cpf:                  cpf || '',
    add_service:          add_service || '',
    operadora_smart_pdv:  operadora,
    nm_estacao:           NM_ESTACAO,
  });
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

module.exports = { NM_ESTACAO, verificarCaixaAberto, abrirCaixaERP, gravarItensERP, fecharComandaERP, fecharCaixaERP };
