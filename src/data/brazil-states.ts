export type BrazilRegion = 'Norte' | 'Nordeste' | 'Centro-Oeste' | 'Sudeste' | 'Sul'

export type BrazilState = {
  uf: string
  name: string
  capital: string
  region: BrazilRegion
  color: string
  path: string
  label: [number, number]
  offices: string[]
}

const state = (
  uf: string,
  name: string,
  capital: string,
  region: BrazilRegion,
  color: string,
  path: string,
  label: [number, number],
  offices: string[] = ['Governador', 'Senador', 'Deputado federal', 'Deputado estadual'],
): BrazilState => ({ uf, name, capital, region, color, path, label, offices })

// Cartograma local, leve e legível. Geografia aproximada; clique sempre representa UF real.
export const BRAZIL_STATES: BrazilState[] = [
  state('RR', 'Roraima', 'Boa Vista', 'Norte', '#78a98b', 'M102 12 L129 16 L144 39 L125 58 L95 46 Z', [120, 36]),
  state('AP', 'Amapá', 'Macapá', 'Norte', '#78a98b', 'M235 14 L259 23 L272 70 L250 94 L229 80 Z', [250, 54]),
  state('AM', 'Amazonas', 'Manaus', 'Norte', '#5e9879', 'M34 55 L100 30 L170 45 L225 82 L203 137 L157 152 L132 158 L97 154 L74 164 L35 151 Z', [123, 98]),
  state('PA', 'Pará', 'Belém', 'Norte', '#5e9879', 'M169 46 L228 65 L270 90 L259 145 L215 166 L157 151 L203 137 L225 82 Z', [215, 111]),
  state('AC', 'Acre', 'Rio Branco', 'Norte', '#78a98b', 'M36 170 L68 156 L100 165 L108 190 L87 207 L51 202 Z', [70, 183]),
  state('RO', 'Rondônia', 'Porto Velho', 'Norte', '#5e9879', 'M102 157 L137 154 L151 178 L132 215 L105 215 L88 201 L108 188 Z', [119, 185]),
  state('TO', 'Tocantins', 'Palmas', 'Norte', '#78a98b', 'M243 151 L283 137 L310 165 L298 235 L268 246 L245 215 Z', [276, 192]),
  state('MA', 'Maranhão', 'São Luís', 'Nordeste', '#d5b85a', 'M279 65 L347 58 L374 84 L346 121 L304 139 L269 120 L282 91 Z', [325, 96]),
  state('CE', 'Ceará', 'Fortaleza', 'Nordeste', '#d5b85a', 'M375 77 L422 69 L455 100 L424 128 L386 122 Z', [415, 99]),
  state('RN', 'Rio Grande do Norte', 'Natal', 'Nordeste', '#d5b85a', 'M423 67 L468 74 L480 96 L444 104 Z', [451, 87]),
  state('PB', 'Paraíba', 'João Pessoa', 'Nordeste', '#d5b85a', 'M444 104 L485 104 L492 124 L453 131 Z', [468, 117]),
  state('PE', 'Pernambuco', 'Recife', 'Nordeste', '#d5b85a', 'M424 129 L487 125 L480 151 L421 158 Z', [454, 142]),
  state('AL', 'Alagoas', 'Maceió', 'Nordeste', '#d5b85a', 'M454 151 L487 151 L493 179 L462 180 Z', [474, 165]),
  state('SE', 'Sergipe', 'Aracaju', 'Nordeste', '#d5b85a', 'M422 159 L460 178 L449 199 L417 188 Z', [438, 180]),
  state('PI', 'Piauí', 'Teresina', 'Nordeste', '#d5b85a', 'M347 123 L394 109 L421 151 L406 202 L361 222 L314 215 L300 167 Z', [363, 166]),
  state('BA', 'Bahia', 'Salvador', 'Nordeste', '#c9a94b', 'M361 223 L406 202 L447 196 L464 233 L435 287 L395 292 L360 253 Z', [410, 247]),
  state('MT', 'Mato Grosso', 'Cuiabá', 'Centro-Oeste', '#5e9879', 'M161 214 L245 215 L286 277 L220 290 L177 269 L145 239 Z', [207, 248]),
  state('GO', 'Goiás', 'Goiânia', 'Centro-Oeste', '#5e9879', 'M245 215 L298 235 L337 245 L286 277 L220 290 L205 260 Z', [270, 257]),
  state('DF', 'Distrito Federal', 'Brasília', 'Centro-Oeste', '#d5b85a', 'M277 241 L289 250 L280 263 L268 253 Z', [279, 253], ['Governador', 'Senador', 'Deputado federal', 'Deputado distrital']),
  state('MS', 'Mato Grosso do Sul', 'Campo Grande', 'Centro-Oeste', '#5e9879', 'M220 290 L286 277 L307 314 L266 355 L230 344 L205 320 Z', [253, 316]),
  state('MG', 'Minas Gerais', 'Belo Horizonte', 'Sudeste', '#78a98b', 'M337 245 L395 292 L430 287 L448 325 L404 360 L352 344 L306 314 L286 277 Z', [369, 308]),
  state('ES', 'Espírito Santo', 'Vitória', 'Sudeste', '#78a98b', 'M448 287 L482 279 L496 314 L468 343 L430 330 Z', [464, 313]),
  state('RJ', 'Rio de Janeiro', 'Rio de Janeiro', 'Sudeste', '#d5b85a', 'M405 359 L443 348 L456 366 L425 382 L397 373 Z', [426, 365]),
  state('SP', 'São Paulo', 'São Paulo', 'Sudeste', '#78a98b', 'M288 313 L352 344 L397 362 L370 394 L313 386 L266 355 Z', [330, 356]),
  state('PR', 'Paraná', 'Curitiba', 'Sul', '#5e9879', 'M266 355 L313 386 L299 419 L253 408 L232 383 Z', [272, 388]),
  state('SC', 'Santa Catarina', 'Florianópolis', 'Sul', '#5e9879', 'M254 409 L300 419 L291 448 L251 443 Z', [273, 430]),
  state('RS', 'Rio Grande do Sul', 'Porto Alegre', 'Sul', '#5e9879', 'M251 443 L291 448 L280 494 L238 528 L208 503 L222 461 Z', [251, 484]),
]

export const BRAZIL_STATE_BY_UF = Object.fromEntries(
  BRAZIL_STATES.map((brazilState) => [brazilState.uf, brazilState]),
) as Record<string, BrazilState>
