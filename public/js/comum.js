// Funções compartilhadas pelas telas de motorista e admin

const NOMES_DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const FORMAS_PAGAMENTO = ["Dinheiro", "Pix", "Cartão"];

async function api(caminho, opcoes = {}) {
    const init = { method: opcoes.method || "GET", headers: {}, credentials: "same-origin" };
    if (opcoes.corpo !== undefined) {
        init.headers["content-type"] = "application/json";
        init.body = JSON.stringify(opcoes.corpo);
    }
    let resp;
    try {
        resp = await fetch(caminho, init);
    } catch {
        throw Object.assign(new Error("Sem conexão com o servidor."), { status: 0 });
    }
    let dados = null;
    try { dados = await resp.json(); } catch { /* sem corpo */ }
    if (!resp.ok) throw Object.assign(new Error((dados && dados.erro) || "Erro inesperado."), { status: resp.status });
    return dados;
}

function esc(t) {
    return String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function mostraAlerta(el, msg, tipo = "danger") {
    el.className = `alert alert-${tipo}`;
    el.textContent = msg;
    el.classList.remove("d-none");
}

// Reduz a foto no navegador (máx. 320px, JPEG) para caber no KV
function reduzFoto(arquivo, max = 320) {
    return new Promise((resolve, reject) => {
        if (!arquivo.type.startsWith("image/")) return reject(new Error("Escolha um arquivo de imagem."));
        const img = new Image();
        const url = URL.createObjectURL(arquivo);
        img.onload = () => {
            const escala = Math.min(1, max / Math.max(img.width, img.height));
            const c = document.createElement("canvas");
            c.width = Math.round(img.width * escala);
            c.height = Math.round(img.height * escala);
            c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(url);
            resolve(c.toDataURL("image/jpeg", 0.8));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Não foi possível ler a imagem.")); };
        img.src = url;
    });
}

// Campos do perfil do motorista (usados no cadastro e no painel)
function camposPerfilHTML() {
    const horas = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${h}:00</option>`).join("");
    return `
    <div class="col-md-6">
        <label class="form-label" for="p_carro">Seu carro</label>
        <input class="form-control" id="p_carro" placeholder="Volkswagen Polo" maxlength="60" required>
    </div>
    <div class="col-md-6">
        <label class="form-label" for="p_lugares">Lugares para passageiros</label>
        <input class="form-control" id="p_lugares" type="number" min="1" max="15" value="4" required>
    </div>
    <div class="col-12">
        <label class="form-label" for="p_regioes">Regiões que atende (opcional)</label>
        <input class="form-control" id="p_regioes" placeholder="Zona Sul, Centro, Barra..." maxlength="200">
    </div>
    <div class="col-12">
        <span class="form-label d-block">Formas de pagamento aceitas</span>
        ${FORMAS_PAGAMENTO.map((f) => `<div class="form-check form-check-inline"><input class="form-check-input" type="checkbox" name="p_pag" id="pag_${f}" value="${f}"><label class="form-check-label" for="pag_${f}">${f}</label></div>`).join("")}
    </div>
    <div class="col-12">
        <span class="form-label d-block">Dias de atendimento</span>
        ${NOMES_DIAS.map((d, i) => `<div class="form-check form-check-inline"><input class="form-check-input" type="checkbox" name="p_dia" id="dia_${i}" value="${i}" checked><label class="form-check-label" for="dia_${i}">${d}</label></div>`).join("")}
    </div>
    <div class="col-6">
        <label class="form-label" for="p_ini">Atende a partir de</label>
        <select class="form-select" id="p_ini">${horas}</select>
    </div>
    <div class="col-6">
        <label class="form-label" for="p_fim">Último horário de saída</label>
        <select class="form-select" id="p_fim">${horas}</select>
    </div>
    <div class="col-12">
        <div class="form-check form-check-inline"><input class="form-check-input" type="checkbox" id="p_pet"><label class="form-check-label" for="p_pet">Aceito pets</label></div>
        <div class="form-check form-check-inline"><input class="form-check-input" type="checkbox" id="p_bag"><label class="form-check-label" for="p_bag">Aceito bagagem grande</label></div>
    </div>
    <div class="col-12">
        <label class="form-label" for="p_foto">Foto (opcional)</label>
        <input class="form-control" id="p_foto" type="file" accept="image/*">
        <img id="p_prev" class="foto-prev mt-2 d-none" alt="Prévia da foto">
    </div>`;
}

function preencherPerfil(d) {
    document.getElementById("p_carro").value = d.carro || "";
    document.getElementById("p_lugares").value = d.lugares || 4;
    document.getElementById("p_regioes").value = d.regioes || "";
    document.querySelectorAll("[name=p_pag]").forEach((c) => (c.checked = (d.pagamentos || ["Dinheiro", "Pix"]).includes(c.value)));
    document.querySelectorAll("[name=p_dia]").forEach((c) => (c.checked = (d.dias || [0, 1, 2, 3, 4, 5, 6]).includes(Number(c.value))));
    document.getElementById("p_ini").value = d.horaInicio ?? 7;
    document.getElementById("p_fim").value = d.horaFim ?? 23;
    document.getElementById("p_pet").checked = !!d.aceitaPet;
    document.getElementById("p_bag").checked = !!d.aceitaBagagem;
}

function lerPerfil() {
    return {
        carro: document.getElementById("p_carro").value,
        lugares: parseInt(document.getElementById("p_lugares").value, 10),
        regioes: document.getElementById("p_regioes").value,
        pagamentos: [...document.querySelectorAll("[name=p_pag]:checked")].map((c) => c.value),
        dias: [...document.querySelectorAll("[name=p_dia]:checked")].map((c) => Number(c.value)),
        horaInicio: parseInt(document.getElementById("p_ini").value, 10),
        horaFim: parseInt(document.getElementById("p_fim").value, 10),
        aceitaPet: document.getElementById("p_pet").checked,
        aceitaBagagem: document.getElementById("p_bag").checked,
    };
}

// Foto escolhida: guarda a versão reduzida e mostra a prévia
function ligarFoto(onFoto) {
    const campo = document.getElementById("p_foto");
    const prev = document.getElementById("p_prev");
    campo.addEventListener("change", async () => {
        if (!campo.files[0]) return onFoto(null);
        try {
            const foto = await reduzFoto(campo.files[0]);
            prev.src = foto;
            prev.classList.remove("d-none");
            onFoto(foto);
        } catch (e) {
            campo.value = "";
            onFoto(null);
            alert(e.message);
        }
    });
}

const NAV_MOTORISTA = `
<nav class="navbar navbar-expand-lg bg-body-tertiary rounded-5 mt-2">
    <div class="container-fluid">
        <a class="navbar-brand" href="/">Rodrigo Táxi</a>
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav"
            aria-controls="navbarNav" aria-expanded="false" aria-label="Abrir menu"><span class="navbar-toggler-icon"></span></button>
        <div class="collapse navbar-collapse" id="navbarNav">
            <ul class="navbar-nav">
                <li class="nav-item"><a class="nav-link" href="/">Início</a></li>
                <li class="nav-item"><a class="nav-link" href="/#agendar">Agendar corrida</a></li>
                <li class="nav-item"><a class="nav-link" href="/telas/motorista/motorista_login.html">Sou motorista</a></li>
            </ul>
        </div>
    </div>
</nav>`;
