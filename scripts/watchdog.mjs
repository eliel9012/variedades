#!/usr/bin/env node
// Vigia da noite de apuração: avisa no Telegram quando algo quebra e quando
// volta. Checa a cada 30s:
// - espelho do TSE parado (status.json sem sucesso há mais de 2 min);
// - TSE direto em espera (bloqueio/limite) e ingest usando o upstream reserva;
// - site público fora do ar (healthz pelo Cloudflare) e backend de Cenários IA;
// - progresso da apuração de Presidente (marcos de seções apuradas).
// Credenciais em /etc/apura-telegram.env (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID).

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MIRROR_DIR = process.env.TSE_MIRROR_DIR || path.join(ROOT, 'tse-mirror')
const SITE = process.env.SITE_URL || 'https://eleicoes.meulab.fun'
const API = process.env.API_URL || 'http://127.0.0.1:8790/api/health'
const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const CHAT = process.env.TELEGRAM_CHAT_ID
const CHECK_MS = 30_000
const REMIND_MS = 15 * 60_000
const MIRROR_STALE_MS = 2 * 60_000
const MILESTONES = [1, 10, 25, 50, 75, 90, 95, 99, 100]

const log = (...args) => console.log(new Date().toISOString(), ...args)

async function telegram(text) {
  if (!TOKEN || !CHAT) {
    log('telegram não configurado:', text)
    return
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text, disable_web_page_preview: true }),
    })
    if (!response.ok) log('telegram HTTP', response.status)
    else log('alerta enviado:', text)
  } catch (error) {
    log('telegram falhou:', error.message)
  }
}

async function fetchStatus(url, timeoutMs = 10_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'cache-control': 'no-cache' } })
    return response.status
  } catch {
    return 0
  } finally {
    clearTimeout(timer)
  }
}

/** Problemas ativos: chave -> { since, lastSentAt }. */
const active = new Map()

async function setProblem(key, isProblem, message, recoveredMessage) {
  const now = Date.now()
  const current = active.get(key)
  if (isProblem) {
    if (!current) {
      active.set(key, { since: now, lastSentAt: now })
      await telegram(`⚠️ ${message}`)
    } else if (now - current.lastSentAt > REMIND_MS) {
      current.lastSentAt = now
      const minutes = Math.round((now - current.since) / 60_000)
      await telegram(`⚠️ Ainda: ${message} (há ${minutes} min)`)
    }
  } else if (current) {
    active.delete(key)
    const minutes = Math.round((now - current.since) / 60_000)
    await telegram(`✅ ${recoveredMessage} (durou ${minutes} min)`)
  }
}

let lastMilestone = null

async function checkProgress() {
  try {
    const file = path.join(MIRROR_DIR, 'oficial', 'ele2026', '6257', 'dados', 'br', 'br-c0001-e006257-u.json')
    const data = JSON.parse(await readFile(file, 'utf8'))
    const pct = Number(String(data.s?.pst ?? '0').replace(',', '.'))
    const reached = MILESTONES.filter((m) => pct >= m).pop() ?? null
    if (reached !== null && reached !== lastMilestone) {
      if (lastMilestone !== null || reached < 100) {
        const rows = []
        for (const agr of data.carg?.[0]?.agr ?? []) for (const par of agr.par ?? []) for (const cand of par.cand ?? []) rows.push(cand)
        rows.sort((a, b) => Number(b.vap) - Number(a.vap))
        const top = rows.slice(0, 3).map((c) => `${c.nmu} ${c.pvap}%`).join(' · ')
        await telegram(`🗳️ Presidente: ${data.s.pst}% das seções apuradas (${data.dg} ${data.hg}). ${top}`)
      }
      lastMilestone = reached
    }
  } catch {
    // Arquivo ainda não existe ou está sendo regravado: tenta no próximo ciclo.
  }
}

async function check() {
  // Espelho do TSE.
  let status = null
  try {
    status = JSON.parse(await readFile(path.join(MIRROR_DIR, 'status.json'), 'utf8'))
  } catch {
    status = null
  }
  const lastOk = status?.lastSuccessAt ? Date.parse(status.lastSuccessAt) : NaN
  const stale = !Number.isFinite(lastOk) || Date.now() - lastOk > MIRROR_STALE_MS
  await setProblem(
    'mirror',
    stale,
    `Espelho do TSE parado: último sucesso ${status?.lastSuccessAt ?? 'nunca'}. Erro: ${status?.lastError ?? 'n/d'}. O site está mandando os visitantes direto ao TSE.`,
    'Espelho do TSE voltou a atualizar',
  )
  const primary = status?.upstreams?.[0]
  const primaryBlocked = !!primary && primary.blockedUntil > Date.now()
  await setProblem(
    'tse-blocked',
    primaryBlocked,
    `TSE direto em espera (${primary?.failures ?? '?'} falha(s) seguida(s), ${
      /^HTTP (403|429)/.test(primary?.lastFailure ?? '') ? `${primary.lastFailure}: provável limite/bloqueio` : primary?.lastFailure ?? 'motivo n/d'
    }). Ingest usando o upstream reserva.`,
    'TSE direto respondendo de novo',
  )

  // Site público (passa pelo Cloudflare) e backend da IA.
  const site = await fetchStatus(`${SITE}/healthz`)
  await setProblem('site', site !== 200, `Site fora do ar pelo Cloudflare (healthz HTTP ${site || 'sem resposta'}).`, 'Site no ar de novo')
  const api = await fetchStatus(API)
  await setProblem('api', api !== 200 && api !== 401, `Backend de Cenários IA sem resposta (HTTP ${api || 'sem resposta'}).`, 'Backend de Cenários IA de volta')

  await checkProgress()
}

log(`watchdog: espelho ${MIRROR_DIR}, site ${SITE}`)
await telegram('🟢 Vigia da apuração ligado.')
for (;;) {
  await check().catch((error) => log('check:', error.message))
  await new Promise((resolve) => setTimeout(resolve, CHECK_MS))
}
