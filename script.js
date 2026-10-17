// ===== CONFIGURAÇÃO =====
// Número que receberá as solicitações (DDI + DDD + número, só dígitos)
const TELEFONE = "5521979903028";

// ===== Data/hora atual no fuso de Brasília =====
function agoraBrasilia() {
    // formato "AAAA-MM-DD HH:MM:SS"
    const s = new Date().toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" });
    return { data: s.slice(0, 10), hora: parseInt(s.slice(11, 13), 10) };
}

const form = document.getElementById("formCorrida");
const campoData = document.getElementById("data");
const campoHorario = document.getElementById("horario");
const aviso = document.getElementById("avisoHorario");

// Não permite escolher datas passadas
campoData.min = agoraBrasilia().data;

// Não permite agendar horário que já passou (quando a data é hoje)
function validarHorario() {
    campoHorario.setCustomValidity("");
    aviso.textContent = "";

    if (!campoData.value || !campoHorario.value) return;

    const agora = agoraBrasilia();
    const horaEscolhida = parseInt(campoHorario.value, 10);

    if (campoData.value === agora.data && horaEscolhida <= agora.hora) {
        const msg = "Esse horário já passou. Escolha um horário futuro.";
        campoHorario.setCustomValidity(msg);
        aviso.textContent = msg;
    }
}

campoData.addEventListener("change", validarHorario);
campoHorario.addEventListener("change", validarHorario);

// "2026-10-17" -> "17/10/2026"
function formatarData(iso) {
    const [a, m, d] = iso.split("-");
    return `${d}/${m}/${a}`;
}

form.addEventListener("submit", function (event) {
    event.preventDefault();
    validarHorario();
    if (!form.reportValidity()) return;

    const nome = document.getElementById("nome").value.trim();
    const partida = document.getElementById("partida").value.trim();
    const chegada = document.getElementById("chegada").value.trim();
    const data = formatarData(campoData.value);
    const horario = campoHorario.value;

    // Rota entre a partida e a chegada
    const linkMaps = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(partida)}&destination=${encodeURIComponent(chegada)}&travelmode=driving`;

    const mensagem = `Olá! Gostaria de solicitar uma corrida.

👤 Nome: ${nome}
📍 Partida: ${partida}
🏁 Chegada: ${chegada}
📅 Data: ${data}
🕒 Horário desejado: ${horario}

🗺️ Rota no Google Maps:
${linkMaps}`;

    const linkWhatsApp = `https://wa.me/${TELEFONE}?text=${encodeURIComponent(mensagem)}`;

    // Se o navegador bloquear a nova aba, abre na mesma aba
    const janela = window.open(linkWhatsApp, "_blank");
    if (janela) {
        janela.opener = null;
    } else {
        window.location.href = linkWhatsApp;
    }
});
