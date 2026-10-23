// Rodrigo Táxi - Worker com API (Cloudflare KV, sem banco de dados)
//
// Chaves no KV:
//   mot:<id>              -> cadastro de um motorista (JSON)
//   tel:<telefone>        -> id do motorista (garante telefone único)
//   foto:<id>             -> foto do motorista (data URL JPEG, já reduzida no navegador)
//   msg:<AAAA-MM-DD>:<hora>:<rand> -> log de uma solicitação (dados ficam no "metadata";
//                            expira sozinho após 30 dias)
//   seed:v1               -> marca que os motoristas iniciais já foram criados
//
// Segredos (wrangler secret put):
//   ADMIN_PASSWORD  senha da tela de admin (obrigatória para o admin funcionar)
//   SESSION_SECRET  opcional; chave para assinar as sessões (se faltar, usa ADMIN_PASSWORD)

// ===== Motoristas iniciais (lista em JS). Criados no KV no primeiro acesso. =====
// Depois disso, quem manda é o KV: edite/remova pelo painel de admin.
const MOTORISTAS_INICIAIS = [
  {
    id: "rodrigo",
    nome: "Rodrigo",
    telefone: "5521979903028",
    carro: "Carro de 7 lugares",
    lugares: 7,
    pagamentos: ["Dinheiro", "Pix", "Cartão"],
    regioes: "Todo o Rio de Janeiro",
    aceitaPet: false,
    aceitaBagagem: true,
    horaInicio: 7,
    horaFim: 23,
    dias: [0, 1, 2, 3, 4, 5, 6],
  },
];

const FORMAS_PAGAMENTO = ["Dinheiro", "Pix", "Cartão"];
const LOG_TTL = 60 * 60 * 24 * 30; // 30 dias
const FOTO_MAX = 150_000; // caracteres do data URL
const SESSAO_MOTORISTA = 60 * 60 * 24 * 7;
const SESSAO_ADMIN = 60 * 60 * 12;
const STATUS = ["pendente", "ativo", "inativo"];

// ===== Utilidades =====
const enc = new TextEncoder();

function json(dados, status = 200, extra = {}) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}
const erro = (msg, status = 400) => json({ erro: msg }, status);

function brasilia() {
  // "AAAA-MM-DD HH:MM:SS"
  const s = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" });
  return { data: s.slice(0, 10), hora: parseInt(s.slice(11, 13), 10), iso: s };
}

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function limpa(v, max) {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";
}

function normalizaTelefone(v) {
  let d = String(v || "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = "55" + d; // DDD + número
  return /^55\d{10,11}$/.test(d) ? d : null;
}

function igualConstante(a, b) {
  const x = enc.encode(a), y = enc.encode(b);
  if (x.length !== y.length) return false;
  let r = 0;
  for (let i = 0; i < x.length; i++) r |= x[i] ^ y[i];
  return r === 0;
}

// ===== Senhas (PBKDF2) =====
async function hashSenha(senha, saltB64) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const chave = await crypto.subtle.importKey("raw", enc.encode(senha), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, chave, 256);
  return { hash: b64(bits), salt: b64(salt) };
}

// ===== Sessões (cookie assinado com HMAC) =====
async function hmac(env, texto) {
  const segredo = env.SESSION_SECRET || env.ADMIN_PASSWORD || "";
  const k = await crypto.subtle.importKey("raw", enc.encode("rt:" + segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", k, enc.encode(texto)));
}

async function criaSessao(env, papel, id, ttl) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const corpo = `${papel}.${id}.${exp}`;
  const token = `${corpo}.${await hmac(env, corpo)}`;
  return `rt_sess=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${ttl}`;
}

const cookieLimpo = "rt_sess=; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=0";

async function lerSessao(request, env) {
  if (!env.ADMIN_PASSWORD && !env.SESSION_SECRET) return null;
  const m = (request.headers.get("cookie") || "").match(/(?:^|;\s*)rt_sess=([^;]+)/);
  if (!m) return null;
  const token = decodeURIComponent(m[1]);
  const partes = token.split(".");
  if (partes.length < 4) return null;
  const assinatura = partes.pop();
  const corpo = partes.join(".");
  if (!igualConstante(assinatura, await hmac(env, corpo))) return null;
  const [papel, id, exp] = partes;
  if (Number(exp) < Date.now() / 1000) return null;
  return { papel, id };
}

// ===== Motoristas =====
async function garanteSeed(env) {
  if (await env.TAXI_KV.get("seed:v1")) return;
  for (const m of MOTORISTAS_INICIAIS) {
    const reg = { ...m, status: "ativo", pausado: false, temFoto: false, criadoEm: brasilia().iso };
    await env.TAXI_KV.put(`mot:${m.id}`, JSON.stringify(reg));
    await env.TAXI_KV.put(`tel:${m.telefone}`, m.id);
  }
  await env.TAXI_KV.put("seed:v1", "1");
}

async function listaMotoristas(env) {
  await garanteSeed(env);
  const chaves = [];
  let cursor;
  do {
    const r = await env.TAXI_KV.list({ prefix: "mot:", cursor });
    chaves.push(...r.keys);
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor);
  const regs = await Promise.all(chaves.map((k) => env.TAXI_KV.get(k.name, "json")));
  return regs.filter(Boolean).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

const getMotorista = (env, id) => env.TAXI_KV.get(`mot:${id}`, "json");

function publico(m) {
  return {
    id: m.id, nome: m.nome, carro: m.carro, lugares: m.lugares, pagamentos: m.pagamentos,
    regioes: m.regioes, aceitaPet: m.aceitaPet, aceitaBagagem: m.aceitaBagagem,
    horaInicio: m.horaInicio, horaFim: m.horaFim, dias: m.dias, pausado: !!m.pausado, temFoto: !!m.temFoto,
  };
}
function privado(m) {
  const { senhaHash, senhaSalt, ...resto } = m;
  return resto;
}

// Valida os campos de perfil (usado no cadastro e na edição). Devolve { dados } ou { erro }.
function validaPerfil(b) {
  const nome = limpa(b.nome, 60);
  const carro = limpa(b.carro, 60);
  if (nome.length < 2) return { erro: "Informe seu nome." };
  if (carro.length < 2) return { erro: "Informe o seu carro." };

  const lugares = Number.isInteger(b.lugares) ? b.lugares : parseInt(b.lugares, 10);
  if (!(lugares >= 1 && lugares <= 15)) return { erro: "Quantidade de lugares inválida." };

  const pagamentos = [...new Set((Array.isArray(b.pagamentos) ? b.pagamentos : []).filter((p) => FORMAS_PAGAMENTO.includes(p)))];
  if (!pagamentos.length) return { erro: "Escolha ao menos uma forma de pagamento." };

  const horaInicio = parseInt(b.horaInicio, 10);
  const horaFim = parseInt(b.horaFim, 10);
  if (!(horaInicio >= 0 && horaFim <= 23 && horaInicio <= horaFim)) return { erro: "Horário de atendimento inválido." };

  const dias = [...new Set((Array.isArray(b.dias) ? b.dias : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (!dias.length) return { erro: "Escolha ao menos um dia de atendimento." };

  return {
    dados: {
      nome, carro, lugares, pagamentos, horaInicio, horaFim, dias,
      regioes: limpa(b.regioes, 200),
      aceitaPet: !!b.aceitaPet,
      aceitaBagagem: !!b.aceitaBagagem,
    },
  };
}

function validaFoto(foto) {
  if (typeof foto !== "string" || foto.length > FOTO_MAX) return false;
  return /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(foto);
}

// ===== Logs de mensagens =====
// Cabe tudo no metadata do KV (limite 1 KB), assim listar já traz os dados sem um get por item.
function montaMetadata(r) {
  const m = { ...r };
  const tam = () => enc.encode(JSON.stringify(m)).length;
  for (const campo of ["obs", "chegada", "partida", "nome"]) {
    while (tam() > 1000 && m[campo].length > 10) m[campo] = m[campo].slice(0, Math.floor(m[campo].length * 0.8));
  }
  return m;
}

async function listaMensagens(env, de, ate) {
  const mesmoDia = de === ate;
  const prefixo = mesmoDia ? `msg:${de}` : "msg:";
  const itens = [];
  let cursor;
  do {
    const r = await env.TAXI_KV.list({ prefix: prefixo, cursor });
    for (const k of r.keys) {
      const dia = k.name.slice(4, 14);
      if (dia < de || dia > ate) continue;
      if (k.metadata) itens.push({ chave: k.name, ...k.metadata });
    }
    cursor = r.list_complete ? undefined : r.cursor;
  } while (cursor && itens.length < 10000);
  itens.sort((a, b) => (a.chave < b.chave ? -1 : 1));
  return itens;
}

const dataValida = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");

function celulaCsv(v) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita fórmulas em planilhas
  return `"${s.replace(/"/g, '""')}"`;
}

// ===== Rotas =====
async function corpoJson(request) {
  if (!(request.headers.get("content-type") || "").includes("application/json")) return null;
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function exigeAdmin(request, env) {
  const s = await lerSessao(request, env);
  return s && s.papel === "admin" ? s : null;
}
async function exigeMotorista(request, env) {
  const s = await lerSessao(request, env);
  return s && s.papel === "mot" ? s : null;
}

async function rotas(request, env) {
  const url = new URL(request.url);
  const caminho = url.pathname.replace(/\/+$/, "");
  const metodo = request.method;
  let m;

  if (!env.TAXI_KV) return erro("KV não configurado (binding TAXI_KV).", 500);

  // ---------- Público ----------
  if (caminho === "/api/motoristas" && metodo === "GET") {
    const lista = (await listaMotoristas(env)).filter((x) => x.status === "ativo");
    return json(lista.map(publico));
  }

  if ((m = caminho.match(/^\/api\/motoristas\/([\w-]+)\/foto$/)) && metodo === "GET") {
    const mot = await getMotorista(env, m[1]);
    const foto = mot && mot.status === "ativo" ? await env.TAXI_KV.get(`foto:${m[1]}`) : null;
    if (!foto) return new Response("Sem foto", { status: 404 });
    const [, tipo, dados] = foto.match(/^data:(image\/jpeg);base64,(.+)$/);
    return new Response(unb64(dados), { headers: { "content-type": tipo, "cache-control": "public, max-age=300" } });
  }

  // Cadastro de motorista (entra como "pendente")
  if (caminho === "/api/motoristas" && metodo === "POST") {
    const b = await corpoJson(request);
    if (!b) return erro("Requisição inválida.");
    const telefone = normalizaTelefone(b.telefone);
    if (!telefone) return erro("Telefone inválido. Use DDD + número.");
    if (typeof b.senha !== "string" || b.senha.length < 6 || b.senha.length > 100) return erro("A senha precisa ter ao menos 6 caracteres.");
    const v = validaPerfil(b);
    if (v.erro) return erro(v.erro);
    if (b.foto && !validaFoto(b.foto)) return erro("Foto inválida ou grande demais.");

    await garanteSeed(env);
    if (await env.TAXI_KV.get(`tel:${telefone}`)) return erro("Esse telefone já está cadastrado.", 409);

    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const { hash, salt } = await hashSenha(b.senha);
    const reg = {
      id, telefone, ...v.dados, status: "pendente", pausado: false, temFoto: !!b.foto,
      senhaHash: hash, senhaSalt: salt, criadoEm: brasilia().iso,
    };
    await env.TAXI_KV.put(`mot:${id}`, JSON.stringify(reg));
    await env.TAXI_KV.put(`tel:${telefone}`, id);
    if (b.foto) await env.TAXI_KV.put(`foto:${id}`, b.foto);
    return json({ ok: true }, 201);
  }

  // Passageiro envia solicitação: registra no log e devolve o link do WhatsApp
  if (caminho === "/api/mensagens" && metodo === "POST") {
    const b = await corpoJson(request);
    if (!b) return erro("Requisição inválida.");
    const mot = typeof b.motoristaId === "string" ? await getMotorista(env, b.motoristaId) : null;
    if (!mot || mot.status !== "ativo") return erro("Motorista indisponível.", 404);
    if (mot.pausado) return erro("Esse motorista está pausado no momento.", 409);

    const nome = limpa(b.nome, 50), partida = limpa(b.partida, 120), chegada = limpa(b.chegada, 120);
    const obs = limpa(b.obs, 80);
    if (nome.length < 2 || partida.length < 3 || chegada.length < 3) return erro("Preencha nome, partida e chegada.");

    if (!dataValida(b.data)) return erro("Data inválida.");
    const agora = brasilia();
    const hora = parseInt(b.horario, 10);
    if (b.data < agora.data || (b.data === agora.data && hora <= agora.hora)) return erro("Esse horário já passou.");
    if (!mot.dias.includes(new Date(b.data + "T12:00:00Z").getUTCDay())) return erro("O motorista não atende nesse dia da semana.");
    if (!(hora >= mot.horaInicio && hora <= mot.horaFim)) return erro("Horário fora do atendimento do motorista.");

    const passageiros = parseInt(b.passageiros, 10) || 1;
    if (passageiros < 1 || passageiros > mot.lugares) return erro(`Esse carro leva até ${mot.lugares} passageiro(s).`);
    const pagamento = mot.pagamentos.includes(b.pagamento) ? b.pagamento : null;
    if (!pagamento) return erro("Forma de pagamento não aceita por esse motorista.");
    const pet = mot.aceitaPet && !!b.pet;
    const bagagem = mot.aceitaBagagem && !!b.bagagem;

    const [dia, mes, ano] = [b.data.slice(8), b.data.slice(5, 7), b.data.slice(0, 4)];
    const linkMaps = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(partida)}&destination=${encodeURIComponent(chegada)}&travelmode=driving`;
    const linhas = [
      `Olá, ${mot.nome}! Gostaria de solicitar uma corrida.`, "",
      `👤 Nome: ${nome}`,
      `📍 Partida: ${partida}`,
      `🏁 Chegada: ${chegada}`,
      `📅 Data: ${dia}/${mes}/${ano}`,
      `🕒 Horário desejado: ${hora}:00`,
      `👥 Passageiros: ${passageiros}`,
      `💳 Pagamento: ${pagamento}`,
    ];
    if (bagagem) linhas.push("🧳 Levo bagagem grande");
    if (pet) linhas.push("🐾 Levo um pet");
    if (obs) linhas.push(`📝 Obs: ${obs}`);
    linhas.push("", "🗺️ Rota no Google Maps:", linkMaps);
    const link = `https://wa.me/${mot.telefone}?text=${encodeURIComponent(linhas.join("\n"))}`;

    const rand = crypto.randomUUID().slice(0, 6);
    const chave = `msg:${agora.data}:${agora.iso.slice(11, 19)}:${rand}`;
    const meta = montaMetadata({
      ts: agora.iso, mid: mot.id, mnome: mot.nome, nome, partida, chegada,
      data: b.data, hora, pax: passageiros, pg: pagamento, pet: pet ? 1 : 0, bag: bagagem ? 1 : 0, obs,
    });
    await env.TAXI_KV.put(chave, "1", { metadata: meta, expirationTtl: LOG_TTL });
    return json({ link });
  }

  // ---------- Motorista ----------
  if (caminho === "/api/motorista/login" && metodo === "POST") {
    const b = await corpoJson(request);
    const tel = normalizaTelefone(b && b.telefone);
    const falha = () => erro("Telefone ou senha incorretos.", 401);
    if (!b || !tel || typeof b.senha !== "string") return falha();
    await garanteSeed(env);
    const id = await env.TAXI_KV.get(`tel:${tel}`);
    const mot = id ? await getMotorista(env, id) : null;
    if (!mot || !mot.senhaHash) { await hashSenha("x"); return falha(); }
    const { hash } = await hashSenha(b.senha, mot.senhaSalt);
    if (!igualConstante(hash, mot.senhaHash)) return falha();
    return json({ ok: true }, 200, { "set-cookie": await criaSessao(env, "mot", mot.id, SESSAO_MOTORISTA) });
  }

  if (caminho === "/api/motorista/logout" && metodo === "POST") {
    return json({ ok: true }, 200, { "set-cookie": cookieLimpo });
  }

  if (caminho === "/api/motorista/me") {
    const s = await exigeMotorista(request, env);
    if (!s) return erro("Não autenticado.", 401);
    const mot = await getMotorista(env, s.id);
    if (!mot) return erro("Cadastro não encontrado.", 404);

    if (metodo === "GET") {
      const hoje = brasilia().data;
      const msgs = (await listaMensagens(env, "0000-00-00", "9999-99-99")).filter((x) => x.mid === mot.id);
      return json({ ...privado(mot), solicitacoes30d: msgs.length, solicitacoesHoje: msgs.filter((x) => x.ts.startsWith(hoje)).length });
    }

    if (metodo === "PUT") {
      const b = await corpoJson(request);
      if (!b) return erro("Requisição inválida.");
      const v = validaPerfil(b);
      if (v.erro) return erro(v.erro);
      const novo = { ...mot, ...v.dados, pausado: !!b.pausado };
      if (b.foto) {
        if (!validaFoto(b.foto)) return erro("Foto inválida ou grande demais.");
        await env.TAXI_KV.put(`foto:${mot.id}`, b.foto);
        novo.temFoto = true;
      } else if (b.removerFoto) {
        await env.TAXI_KV.delete(`foto:${mot.id}`);
        novo.temFoto = false;
      }
      if (typeof b.novaSenha === "string" && b.novaSenha) {
        if (b.novaSenha.length < 6 || b.novaSenha.length > 100) return erro("A nova senha precisa ter ao menos 6 caracteres.");
        const { hash, salt } = await hashSenha(b.novaSenha);
        novo.senhaHash = hash;
        novo.senhaSalt = salt;
      }
      await env.TAXI_KV.put(`mot:${mot.id}`, JSON.stringify(novo));
      return json({ ok: true });
    }
  }

  // ---------- Admin ----------
  if (caminho === "/api/admin/login" && metodo === "POST") {
    if (!env.ADMIN_PASSWORD) return erro("ADMIN_PASSWORD não configurada no Worker.", 503);
    const b = await corpoJson(request);
    const a = await hashSenha(String((b && b.senha) || ""), "AAAAAAAAAAAAAAAAAAAAAA==");
    const c = await hashSenha(env.ADMIN_PASSWORD, "AAAAAAAAAAAAAAAAAAAAAA==");
    if (!igualConstante(a.hash, c.hash)) return erro("Senha incorreta.", 401);
    return json({ ok: true }, 200, { "set-cookie": await criaSessao(env, "admin", "admin", SESSAO_ADMIN) });
  }

  if (caminho === "/api/admin/logout" && metodo === "POST") {
    return json({ ok: true }, 200, { "set-cookie": cookieLimpo });
  }

  if (caminho.startsWith("/api/admin/")) {
    if (!(await exigeAdmin(request, env))) return erro("Não autenticado.", 401);

    if (caminho === "/api/admin/motoristas" && metodo === "GET") {
      return json((await listaMotoristas(env)).map(privado));
    }

    if ((m = caminho.match(/^\/api\/admin\/motoristas\/([\w-]+)$/))) {
      const mot = await getMotorista(env, m[1]);
      if (!mot) return erro("Motorista não encontrado.", 404);

      if (metodo === "PATCH") {
        const b = await corpoJson(request);
        if (!b) return erro("Requisição inválida.");
        if (b.status !== undefined) {
          if (!STATUS.includes(b.status)) return erro("Status inválido.");
          mot.status = b.status;
        }
        if (b.pausado !== undefined) mot.pausado = !!b.pausado;
        await env.TAXI_KV.put(`mot:${mot.id}`, JSON.stringify(mot));
        return json({ ok: true });
      }

      if (metodo === "DELETE") {
        await env.TAXI_KV.delete(`mot:${mot.id}`);
        await env.TAXI_KV.delete(`tel:${mot.telefone}`);
        await env.TAXI_KV.delete(`foto:${mot.id}`);
        return json({ ok: true });
      }
    }

    if (caminho === "/api/admin/mensagens" || caminho === "/api/admin/mensagens.csv") {
      const hoje = brasilia().data;
      const de = url.searchParams.get("de") || url.searchParams.get("data") || hoje;
      const ate = url.searchParams.get("ate") || url.searchParams.get("data") || de;
      if (!dataValida(de) || !dataValida(ate) || de > ate) return erro("Período inválido.");

      if (metodo === "GET" && caminho.endsWith(".csv")) {
        const itens = await listaMensagens(env, de, ate);
        const cab = ["Enviada em", "Motorista", "Passageiro", "Partida", "Chegada", "Data da corrida", "Horário", "Passageiros", "Pagamento", "Bagagem", "Pet", "Obs"];
        const linhas = itens.map((i) => [i.ts, i.mnome, i.nome, i.partida, i.chegada, i.data, `${i.hora}:00`, i.pax, i.pg, i.bag ? "sim" : "não", i.pet ? "sim" : "não", i.obs].map(celulaCsv).join(";"));
        const csv = "﻿" + [cab.map(celulaCsv).join(";"), ...linhas].join("\r\n");
        return new Response(csv, {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="solicitacoes_${de}${de === ate ? "" : "_a_" + ate}.csv"`,
            "cache-control": "no-store",
          },
        });
      }

      if (metodo === "GET") {
        const itens = await listaMensagens(env, de, ate);
        const porMotorista = {};
        for (const i of itens) {
          porMotorista[i.mid] ||= { id: i.mid, nome: i.mnome, total: 0 };
          porMotorista[i.mid].total++;
        }
        return json({
          de, ate, total: itens.length,
          porMotorista: Object.values(porMotorista).sort((a, b) => b.total - a.total),
          mensagens: itens.reverse(),
        });
      }

      if (metodo === "DELETE") {
        const itens = await listaMensagens(env, de, ate);
        // em lotes pequenos para respeitar o limite de operações por requisição
        for (let i = 0; i < itens.length; i += 25) {
          await Promise.all(itens.slice(i, i + 25).map((x) => env.TAXI_KV.delete(x.chave)));
        }
        return json({ ok: true, apagadas: itens.length });
      }
    }
  }

  return erro("Rota não encontrada.", 404);
}

export default {
  async fetch(request, env) {
    try {
      const metodo = request.method;
      if (metodo !== "GET" && metodo !== "HEAD") {
        // Defesa extra contra CSRF: só aceita requisições do próprio site
        const origem = request.headers.get("origin");
        if (origem && origem !== new URL(request.url).origin) return erro("Origem não permitida.", 403);
      }
      return await rotas(request, env);
    } catch (e) {
      console.error(e);
      return erro("Erro interno.", 500);
    }
  },
};
