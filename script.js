document.getElementById("formCorrida").addEventListener("submit", function (event) {
event.preventDefault();

const partida = document.getElementById("partida").value.trim();
const chegada = document.getElementById("chegada").value.trim();
const horario = document.getElementById("horario").value;

// Gera uma rota entre a partida e a chegada
const linkMaps = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(partida)}&destination=${encodeURIComponent(chegada)}&travelmode=driving`;

const mensagem = `Olá! Gostaria de solicitar uma corrida.

📍 Partida: ${partida}
🏁 Chegada: ${chegada}
🕒 Horário desejado: ${horario}

🗺️ Rota no Google Maps:
${linkMaps}`;

// Troque pelo número que receberá as solicitações
const telefone = "5521979903028";

const linkWhatsApp = `https://wa.me/${telefone}?text=${encodeURIComponent(mensagem)}`;

window.open(linkWhatsApp, "_blank");


});