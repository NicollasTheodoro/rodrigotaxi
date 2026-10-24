# rodrigotaxi

Site de agendamento de corridas com vários motoristas, rodando em Cloudflare Workers
(arquivos estáticos em `public/` + API em `src/index.js`) e **Cloudflare KV** para guardar os dados (sem banco de dados).

## Telas

| Rota | Quem usa | O que faz |
|---|---|---|
| `/` | Passageiro | Escolhe o motorista; o formulário se adapta a ele (lugares, pagamentos, dias e horários, pet/bagagem) e abre o WhatsApp dele |
| `/telas/motorista/motorista_cadastro.html` | Motorista | Cadastro (entra como **pendente** até o admin aprovar) |
| `/telas/motorista/motorista_login.html` | Motorista | Login com WhatsApp + senha |
| `/telas/motorista/motorista.html` | Motorista | Painel: edita dados, foto, pausa o atendimento, vê quantas solicitações recebeu |
| `/admin/` | Admin | Aprova/desativa/remove motoristas; vê as mensagens por período e por motorista; baixa CSV; apaga logs |

## Como publicar

1. Instale as dependências: `npm install`
2. Defina a senha do admin (obrigatória): `npx wrangler secret put ADMIN_PASSWORD`
   (opcional: `npx wrangler secret put SESSION_SECRET` com um texto aleatório longo)
3. Publique: `npx wrangler deploy`

O namespace KV (`TAXI_KV`) é criado automaticamente no primeiro deploy. Se o seu deploy reclamar disso, crie
manualmente com `npx wrangler kv namespace create TAXI_KV` e coloque o `id` em `wrangler.jsonc`.

Se o deploy é feito pelo GitHub (Workers Builds), adicione `ADMIN_PASSWORD` em
**Workers & Pages → rodrigotaxi → Settings → Variables and Secrets** (tipo *Secret*).

Para testar localmente: crie `.dev.vars` com `ADMIN_PASSWORD=sua-senha` e rode `npm run dev`.

## Dados no KV

- `mot:<id>` cadastro do motorista · `tel:<telefone>` índice de telefone único · `foto:<id>` foto (reduzida para 320px)
- `msg:<data>:<hora>:<id>` log de cada solicitação (fica no *metadata*), **expira sozinho em 30 dias**
- O motorista inicial (Rodrigo) está na lista `MOTORISTAS_INICIAIS` no topo de `src/index.js` e é criado no KV no primeiro acesso.

## Observações

- O plano gratuito do KV permite ~1.000 gravações/exclusões por dia: cada solicitação enviada = 1 gravação; apagar logs = 1 exclusão por mensagem.
- Os logs guardam nome e endereços de passageiros: trate o CSV conforme a LGPD.
- Alterações no KV podem levar até ~60 s para aparecer em outras regiões.
- Não foi implementado limite de tentativas de login nem proteção contra spam no formulário. Se o site ganhar tráfego, vale adicionar o rate limiting da Cloudflare.