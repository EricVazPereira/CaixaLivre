const db = require('./db')

function pad14(codigo) {
  return codigo.replace(/\D/g, '').padStart(14, '0')
}

const produtos = [
  { codigo: '7891000100103', descricao: 'Leite Integral 1L',       valor_unitario: 4.99,  estoque: 100, unidade: 'un', ncm: '04011000', cfop: '5102', cst_icms: '400', cst_pis: '07', cst_cofins: '07', aliquota_icms: 0,  aliquota_pis: 0,    aliquota_cofins: 0,   origem: 0 },
  { codigo: '7891000315507', descricao: 'Nescafé Tradicional 500g', valor_unitario: 22.90, estoque: 50,  unidade: 'un', ncm: '21011100', cfop: '5102', cst_icms: '400', cst_pis: '01', cst_cofins: '01', aliquota_icms: 0,  aliquota_pis: 0.65, aliquota_cofins: 3.0, origem: 0 },
  { codigo: '7891910000197', descricao: 'Arroz Tio João 5kg',       valor_unitario: 27.50, estoque: 80,  unidade: 'un', ncm: '10063021', cfop: '5102', cst_icms: '400', cst_pis: '07', cst_cofins: '07', aliquota_icms: 0,  aliquota_pis: 0,    aliquota_cofins: 0,   origem: 0 },
  { codigo: '7896036090046', descricao: 'Feijão Carioca 1kg',       valor_unitario: 8.99,  estoque: 120, unidade: 'un', ncm: '07133319', cfop: '5102', cst_icms: '400', cst_pis: '07', cst_cofins: '07', aliquota_icms: 0,  aliquota_pis: 0,    aliquota_cofins: 0,   origem: 0 },
  { codigo: '7891149410116', descricao: 'Macarrão Espaguete 500g',  valor_unitario: 4.49,  estoque: 200, unidade: 'un', ncm: '19021900', cfop: '5102', cst_icms: '400', cst_pis: '01', cst_cofins: '01', aliquota_icms: 0,  aliquota_pis: 0.65, aliquota_cofins: 3.0, origem: 0 },
  { codigo: '7896085088555', descricao: 'Óleo de Soja 900ml',       valor_unitario: 7.99,  estoque: 90,  unidade: 'un', ncm: '15079019', cfop: '5102', cst_icms: '400', cst_pis: '01', cst_cofins: '01', aliquota_icms: 0,  aliquota_pis: 0.65, aliquota_cofins: 3.0, origem: 0 },
  { codigo: '7891098010575', descricao: 'Sabão em Pó 1kg',          valor_unitario: 12.90, estoque: 60,  unidade: 'un', ncm: '34022000', cfop: '5102', cst_icms: '000', cst_pis: '01', cst_cofins: '01', aliquota_icms: 12, aliquota_pis: 0.65, aliquota_cofins: 3.0, origem: 0 },
  { codigo: '7891155740117', descricao: 'Açúcar Cristal 1kg',       valor_unitario: 5.49,  estoque: 150, unidade: 'un', ncm: '17011400', cfop: '5102', cst_icms: '400', cst_pis: '07', cst_cofins: '07', aliquota_icms: 0,  aliquota_pis: 0,    aliquota_cofins: 0,   origem: 0 },
  { codigo: '7896045100264', descricao: 'Sal Refinado 1kg',         valor_unitario: 2.99,  estoque: 200, unidade: 'un', ncm: '25010020', cfop: '5102', cst_icms: '400', cst_pis: '07', cst_cofins: '07', aliquota_icms: 0,  aliquota_pis: 0,    aliquota_cofins: 0,   origem: 0 },
  { codigo: '7891000244388', descricao: 'Chocolate ao Leite 90g',   valor_unitario: 3.49,  estoque: 300, unidade: 'un', ncm: '18063100', cfop: '5102', cst_icms: '400', cst_pis: '01', cst_cofins: '01', aliquota_icms: 0,  aliquota_pis: 0.65, aliquota_cofins: 3.0, origem: 0 },
  { codigo: '0074468060449', descricao: 'Álcool 70% 1L',            valor_unitario: 9.99,  estoque: 75,  unidade: 'un', ncm: '38089400', cfop: '5102', cst_icms: '000', cst_pis: '01', cst_cofins: '01', aliquota_icms: 12, aliquota_pis: 0.65, aliquota_cofins: 3.0, origem: 0 },
  { codigo: '07894650014141', descricao: 'Raid Aerossol 300ml',     valor_unitario: 18.90, estoque: 40,  unidade: 'un', ncm: '38089290', cfop: '5102', cst_icms: '000', cst_pis: '01', cst_cofins: '01', aliquota_icms: 12, aliquota_pis: 0.65, aliquota_cofins: 3.0, origem: 0 },
].map(p => ({ ...p, codigo: pad14(p.codigo) }))

// Recria dados com códigos normalizados (respeita FK)
db.run('DELETE FROM itens_venda')
db.run('DELETE FROM contas')
db.run('DELETE FROM produtos')

db.run('BEGIN')
for (const p of produtos) {
  db.run(
    `INSERT INTO produtos
      (codigo, descricao, valor_unitario, estoque, unidade,
       ncm, cfop, cst_icms, cst_pis, cst_cofins,
       aliquota_icms, aliquota_pis, aliquota_cofins, origem)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [p.codigo, p.descricao, p.valor_unitario, p.estoque, p.unidade,
     p.ncm, p.cfop, p.cst_icms, p.cst_pis, p.cst_cofins,
     p.aliquota_icms, p.aliquota_pis, p.aliquota_cofins, p.origem]
  )
}
db.run('COMMIT')

console.log(`✅ ${produtos.length} produtos inseridos com códigos de 14 dígitos.`)
produtos.forEach(p => console.log(`  ${p.codigo}  ${p.descricao}`))
