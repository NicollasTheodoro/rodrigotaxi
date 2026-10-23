// ===== Data/hora atual no fuso de Brasília =====
function agoraBrasilia() {
    // formato "AAAA-MM-DD HH:MM:SS"
    const s = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" });
    return { data: s.slice(0, 10), hora: parseInt(s.slice(11, 13), 10) };
}

const NOMES_DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const ABREV_DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const form = document.getElementById("formCorrida");
const campoData = document.getElementById("data");
const campoHorario = document.getElementById("horario");
const avisoHorario = document.getElementById("avisoHorario");
const avisoData = document.getElementById("avisoData");
const erroEnvio = document.getElementById("erroEnvio");
const $ = (id) => document.getElementById(id);

let motorista = null; // motorista escolhido (o formulário se adapta a ele)

function esc(t) {
    return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ===== Lista de motoristas =====
async function carregarMotoristas() {
    const status = $("statusMotoristas");
    try {
        const resp = await fetch("/api/motoristas");
        if (!resp.ok) throw new Error();
        const lista = await resp.json();
        if (!lista.length) {
            status.textContent = "Nenhum motorista disponível no momento.";
            return;
        }
        status.classList.add("d-none");
        $("listaMotoristas").innerHTML = lista.map((m) => `
            <div class="col-12 col-md-6">
                <button type="button" class="card-motorista" data-id="${esc(m.id)}" ${m.pausado ? "disabled" : ""}>
                    ${m.temFoto
                        ? `<img class="avatar" src="/api/motoristas/${esc(m.id)}/foto" alt="Foto de ${esc(m.nome)}" width="64" height="64">`
                        : `<span class="avatar" aria-hidden="true">🚖</span>`}
                    <span>
                        <strong>${esc(m.nome)}</strong>${m.pausado ? " <small>(indisponível agora)</small>" : ""}<br>
                        <small>${esc(m.carro)} · ${m.lugares} lugares<br>${esc(m.regioes || "")}</small>
                    </span>
                </button>
            </div>`).join("");
        $("listaMotoristas").addEventListener("click", (ev) => {
            const b = ev.target.closest("button[data-id]");
            if (b) escolher(lista.find((m) => m.id === b.dataset.id));
        });
        // Só um motorista disponível: já vem selecionado
        const livres = lista.filter((m) => !m.pausado);
        if (livres.length === 1 && lista.length === 1) escolher(livres[0], false);
    } catch {
        status.textContent = "Não foi possível carregar os motoristas. Tente novamente em instantes.";
    }
}

// ===== O formulário se adapta ao motorista =====
function escolher(m, rolar = true) {
    motorista = m;
    erroEnvio.classList.add("d-none");
    $("nomeEscolhido").textContent = m.nome;
    $("infoEscolhido").textContent =
        `${m.carro} · atende ${m.horaInicio}:00 às ${m.horaFim}:00 · ${m.dias.length === 7 ? "todos os dias" : m.dias.map((d) => ABREV_DIAS[d]).join(", ")}`;
    $("botaoEnviar").textContent = `Contatar ${m.nome}`;

    // Passageiros: até a capacidade do carro
    $("passageiros").innerHTML = Array.from({ length: m.lugares }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("");

    // Pagamento: só o que o motorista aceita
    $("pagamento").innerHTML = m.pagamentos.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");

    // Horários: só a janela do motorista
    let opcoes = '<option value="" selected disabled>Selecione o horário</option>';
    for (let h = m.horaInicio; h <= m.horaFim; h++) opcoes += `<option value="${h}:00">${h}:00</option>`;
    campoHorario.innerHTML = opcoes;

    // Extras: só aparecem se o motorista aceita
    const extras = [];
    if (m.aceitaBagagem) extras.push('<div class="form-check form-check-inline"><input class="form-check-input" type="checkbox" id="bagagem"><label class="form-check-label" for="bagagem">Levo bagagem grande</label></div>');
    if (m.aceitaPet) extras.push('<div class="form-check form-check-inline"><input class="form-check-input" type="checkbox" id="pet"><label class="form-check-label" for="pet">Levo um pet</label></div>');
    $("extras").innerHTML = extras.join("");

    campoData.min = agoraBrasilia().data;
    campoData.value = "";
    avisoData.textContent = m.dias.length === 7 ? "" : `Atende: ${m.dias.map((d) => NOMES_DIAS[d]).join(", ")}.`;
    validarHorario();

    form.classList.remove("d-none");
    $("escolha").classList.add("d-none");
    if (rolar) form.scrollIntoView({ behavior: "smooth", block: "start" });
}

$("trocar").addEventListener("click", () => {
    motorista = null;
    form.classList.add("d-none");
    $("escolha").classList.remove("d-none");
});

function diaDaSemana(iso) {
    return new Date(iso + "T12:00:00Z").getUTCDay();
}

// Valida dia da semana e horário conforme o motorista
function validarHorario() {
    campoHorario.setCustomValidity("");
    campoData.setCustomValidity("");
    avisoHorario.textContent = "";
    if (!motorista) return;

    if (campoData.value && !motorista.dias.includes(diaDaSemana(campoData.value))) {
        const msg = `${motorista.nome} não atende ${NOMES_DIAS[diaDaSemana(campoData.value)]}.`;
        campoData.setCustomValidity(msg);
        avisoData.textContent = msg;
        return;
    }
    if (motorista.dias.length < 7) avisoData.textContent = `Atende: ${motorista.dias.map((d) => NOMES_DIAS[d]).join(", ")}.`;

    if (!campoData.value || !campoHorario.value) return;
    const agora = agoraBrasilia();
    if (campoData.value === agora.data && parseInt(campoHorario.value, 10) <= agora.hora) {
        const msg = "Esse horário já passou. Escolha um horário futuro.";
        campoHorario.setCustomValidity(msg);
        avisoHorario.textContent = msg;
    }
}

campoData.addEventListener("change", validarHorario);
campoHorario.addEventListener("change", validarHorario);

// ===== Envio: registra no servidor e abre o WhatsApp do motorista =====
form.addEventListener("submit", async function (event) {
    event.preventDefault();
    validarHorario();
    if (!form.reportValidity() || !motorista) return;

    const botao = $("botaoEnviar");
    botao.disabled = true;
    erroEnvio.classList.add("d-none");

    // Abre a aba já no clique (evita bloqueio de pop-up) e preenche depois
    const janela = window.open("about:blank", "_blank");

    try {
        const resp = await fetch("/api/mensagens", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                motoristaId: motorista.id,
                nome: $("nome").value,
                partida: $("partida").value,
                chegada: $("chegada").value,
                data: campoData.value,
                horario: campoHorario.value,
                passageiros: $("passageiros").value,
                pagamento: $("pagamento").value,
                bagagem: !!($("bagagem") && $("bagagem").checked),
                pet: !!($("pet") && $("pet").checked),
                obs: $("obs").value,
            }),
        });
        const dados = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(dados.erro || "Não foi possível enviar.");

        if (janela) {
            janela.opener = null;
            janela.location.href = dados.link;
        } else {
            window.location.href = dados.link;
        }
    } catch (e) {
        if (janela) janela.close();
        erroEnvio.textContent = e.message;
        erroEnvio.classList.remove("d-none");
    }
    botao.disabled = false;
});

carregarMotoristas();
