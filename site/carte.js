"use strict";

// ---------------------------------------------------------------------------
// Carte de l'informatique graphique en France : entreprises (listing AFIG des entreprises) et
// équipes de recherche (listing AFIG des équipes), avec ce qui se trouve à moins de 30 km.
// Les deux listings sont lus directement dans leurs dépôts : la carte suit leurs mises à jour.
// ---------------------------------------------------------------------------

const IS_LOCAL = ['localhost', '127.0.0.1', ''].includes(location.hostname);
const SOURCES = {
    'companies': IS_LOCAL ? '../../entreprises/json/data.json' : 'https://raw.githubusercontent.com/Afig-Asso/entreprises/main/json/data.json',
    'labs': IS_LOCAL ? '../../research-team/json/data.json' : 'https://raw.githubusercontent.com/Afig-Asso/research-team/main/json/data.json',
};
const COMPANIES_LISTING = 'https://afig-asso.github.io/entreprises/';
const LABS_LISTING = 'https://github.com/Afig-Asso/research-team';
const RADIUS_KM = 30;
const FRAMES = [
    {'label': 'France', 'bounds': [[42.2, -4.8], [51.1, 8.3]]},
    {'label': 'Île-de-France', 'bounds': [[48.55, 1.85], [49.05, 2.75]]},
    {'label': 'Lyon – Grenoble', 'bounds': [[44.95, 4.55], [46.0, 6.2]]},
    {'label': 'Bretagne – Pays de la Loire', 'bounds': [[46.9, -4.9], [48.9, -0.4]]},
    {'label': 'Sud-Ouest', 'bounds': [[43.2, -1.5], [45.2, 2.2]]},
    {'label': 'Sud-Est', 'bounds': [[43.0, 3.5], [44.1, 7.6]]},
    {'label': 'Nord-Est', 'bounds': [[47.0, 2.8], [51.2, 8.2]]},
];

const STATE = {
    'map': null, 'companies': [], 'labs': [], 'sites': [],  // points
    'groups': {}, 'circle': null, 'selected': null, 'query': '', 'zones': {},
};
const PANEL = document.querySelector('#panel');
const EMPTY_PANEL = PANEL.innerHTML;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const as_list = (v) => v==null ? [] : (Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim()).filter((x) => x!='');
const NEW_TAB = '<span class="visually-hidden"> (nouvel onglet)</span>';

function km(a, b) {
    const R = 6371, rad = Math.PI/180;
    const dlat = (b.lat - a.lat)*rad, dlon = (b.lon - a.lon)*rad;
    const h = Math.sin(dlat/2)**2 + Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlon/2)**2;
    return 2*R*Math.asin(Math.sqrt(h));
}
const km_text = (d) => d<1 ? 'même site' : `${Math.round(d)} km`;

// ---------------------------------------------------------------------------
// Données
// ---------------------------------------------------------------------------

function employees_count(entry) {
    const m = String(entry['Employees'] ?? '').match(/\d[\d\s]*/);
    if(m==null) return null;
    const N = parseInt(m[0].replace(/\s/g, ''));
    return N>0 ? N : null;
}

function size_text(N) {
    if(N==null) return '';
    if(N<10) return `${N} pers.`;
    if(N<250) return `~${N} pers.`;
    return `~${N.toLocaleString('fr-FR')} pers.`;
}

// Lieux en France d'une entreprise (mêmes règles que le listing des entreprises)
function french_places(place) {
    if(place==null) return [];
    if(typeof place=='string') return as_list(place).map((c) => ({'city': c, 'coords': null}));
    if(Array.isArray(place)) return place.flatMap(french_places);
    const countries = as_list(place['Country']);
    if(countries.length>0 && !countries.includes('France')) return [];
    const cities = as_list(place['City']);
    const single = cities.length==1;
    return cities.map((c) => ({'city': c, 'coords': single ? (place['Coordinates'] || null) : null}));
}

function build_companies(data) {
    const places = data['Places'] || {};
    const out = [];
    data['Listing'].forEach((entry, k) => {
        const seen = new Set();
        french_places(entry['Place']).forEach((p, j) => {
            const coords = p.coords || places['France/' + p.city];
            if(!coords) return;
            const key = coords.join(',');
            if(seen.has(key)) return;
            seen.add(key);
            out.push({
                'kind': 'company', 'id': `c${k}-${j}`, 'k': k, 'entry': entry, 'name': entry['Name'], 'city': p.city,
                'lat': coords[0], 'lon': coords[1], 'employees': employees_count(entry),
                'text': norm([entry['Name'], entry['Name-long'], p.city, entry['Description'], ...as_list(entry['Keywords']),
                    ...as_list(entry['Scientific-domain']), ...as_list(entry['Application-domain'])].join(' ')),
            });
        });
    });
    return out;
}

// Une équipe = un point (ses coordonnées, sinon celles du labo) ; un labo sans équipe = un point
function build_labs(data) {
    const out = [];
    for(const [lab_key, lab] of Object.entries(data)) {
        const teams = Object.entries(lab['Equipes'] || {});
        const add = (team_key, team) => {
            const coords = (team && team['Coordonnées']) || lab['Coordonnées'];
            if(!coords) return;
            const ville = (team && team['Ville']) || lab['Ville'] || '';
            out.push({
                'kind': 'lab', 'id': team_key ? `${lab_key}/${team_key}` : lab_key, 'lab_key': lab_key, 'lab': lab,
                'team_key': team_key, 'team': team, 'name': team_key ? `${lab_key} – ${team_key}` : lab_key,
                'city': ville, 'lat': coords[0], 'lon': coords[1], 'inria': team && 'Inria' in team,
                'text': norm([lab_key, lab['Nom'], ville, team_key, team?.['Nom'], team?.['Thèmes'] ?? lab['Thèmes']].join(' ')),
            });
        };
        if(teams.length==0) add(null, null);
        teams.forEach(([t, team]) => add(t, team));
    }
    return out;
}

// Équipes au même endroit (même bâtiment) : un seul repère
function build_sites(labs) {
    const sites = new Map();
    for(const p of labs) {
        const key = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
        if(!sites.has(key)) sites.set(key, {'kind': 'site', 'id': 's' + sites.size, 'lat': p.lat, 'lon': p.lon, 'teams': []});
        sites.get(key).teams.push(p);
        p.site = sites.get(key);
    }
    return [...sites.values()];
}

// ---------------------------------------------------------------------------
// Carte
// ---------------------------------------------------------------------------

function dot_icon(p, selected) {
    const size = p.employees==null ? 12 : Math.round(Math.min(30, 10 + 4*Math.log10(p.employees)));
    return L.divIcon({'className': 'pin dot' + (p.employees==null ? ' dot-unknown' : '') + (selected ? ' is-selected' : ''),
        'html': '', 'iconSize': [size, size]});
}

function lab_icon(site, N, selected) {
    const size = N>1 ? 26 : 18;
    return L.divIcon({'className': 'pin diamond' + (selected ? ' is-selected' : ''),
        'html': N>1 ? `<span>${N}</span>` : '', 'iconSize': [size, size]});
}

function create_map() {
    const map = L.map('map', {'scrollWheelZoom': false, 'minZoom': 4, 'zoomSnap': 0.5});
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        'attribution': '&copy; <a href="https://www.openstreetmap.org/copyright">contributeurs OpenStreetMap</a>', 'maxZoom': 18,
    }).addTo(map);
    // la molette ne zoome qu'après un clic sur la carte (la page défile dans le site de l'AFIG)
    map.on('click focus', () => { map.scrollWheelZoom.enable(); document.querySelector('#map-help').classList.add('is-hidden'); });
    map.on('mouseout blur', () => map.scrollWheelZoom.disable());
    map.fitBounds(FRAMES[0].bounds);

    STATE.groups.companies = L.markerClusterGroup({
        'showCoverageOnHover': false, 'maxClusterRadius': 45, 'spiderfyOnMaxZoom': true,
        'iconCreateFunction': (c) => {
            const N = c.getChildCount(), size = Math.round(28 + 5*Math.log2(N));
            return L.divIcon({'className': 'pin cluster-company', 'html': `<span>${N}</span>`, 'iconSize': [size, size]});
        },
    });
    STATE.groups.labs = L.markerClusterGroup({
        'showCoverageOnHover': false, 'maxClusterRadius': 28, 'spiderfyOnMaxZoom': true,
        'iconCreateFunction': (c) => {
            const N = c.getAllChildMarkers().reduce((s, m) => s + m.options.teams, 0);
            return L.divIcon({'className': 'pin diamond cluster-lab', 'html': `<span>${N}</span>`, 'iconSize': [30, 30]});
        },
    });
    STATE.groups.companies.addTo(map);
    STATE.groups.labs.addTo(map);  // au-dessus des entreprises
    STATE.map = map;
}

function matches(p) {
    return STATE.query=='' || STATE.query.split(/\s+/).every((w) => p.text.includes(w));
}

function draw_markers() {
    const show_c = document.querySelector('#show-companies').checked, show_l = document.querySelector('#show-labs').checked;
    STATE.groups.companies.clearLayers();
    STATE.groups.labs.clearLayers();
    const companies = STATE.companies.filter(matches);
    const teams = STATE.labs.filter(matches);
    const sel = STATE.selected;
    if(show_c) {
        STATE.groups.companies.addLayers(companies.map((p) => {
            const m = L.marker([p.lat, p.lon], {'icon': dot_icon(p, sel && sel.kind=='company' && sel.k==p.k), 'title': p.name, 'alt': p.name, 'keyboard': true});
            m.bindTooltip(`${esc(p.name)}<br><span class="tip-city">${esc(p.city)}</span>`, {'direction': 'top', 'offset': [0, -6]});
            m.on('click', () => select(p));
            return m;
        }));
    }
    if(show_l) {
        const by_site = new Map();
        teams.forEach((p) => { if(!by_site.has(p.site)) by_site.set(p.site, []); by_site.get(p.site).push(p); });
        STATE.groups.labs.addLayers([...by_site.entries()].map(([site, list]) => {
            const names = list.map((p) => p.name).join(', ');
            const selected = sel && sel.kind=='lab' && sel.site==site;
            const m = L.marker([site.lat, site.lon], {'icon': lab_icon(site, list.length, selected), 'title': names, 'alt': names, 'teams': list.length, 'keyboard': true, 'zIndexOffset': 1000});
            m.bindTooltip(list.map((p) => esc(p.name)).join('<br>') + `<br><span class="tip-city">${esc(list[0].city)}</span>`, {'direction': 'top', 'offset': [0, -8]});
            m.on('click', () => select(list.length==1 ? list[0] : {'kind': 'lab', 'site': site, 'multi': list}));
            return m;
        }));
    }
    document.querySelector('#count-companies').textContent = new Set(companies.map((p) => p.k)).size;  // entreprises, pas implantations
    document.querySelector('#count-labs').textContent = teams.length;
}

// ---------------------------------------------------------------------------
// Panneau : la sélection et ce qui est à moins de 30 km
// ---------------------------------------------------------------------------

function near(center, points, exclude) {
    return points.filter((p) => !exclude(p)).map((p) => ({p, 'd': km(center, p)})).filter((x) => x.d<=RADIUS_KM)
        .sort((a, b) => a.d - b.d || a.p.name.localeCompare(b.p.name, 'fr'));
}

function company_block(p) {
    const e = p.entry;
    const cities = [...new Set(STATE.companies.filter((q) => q.k==p.k).map((q) => q.city))];
    const tags = [...as_list(e['Scientific-domain']), ...as_list(e['Application-domain'])];
    return `<p class="kind kind-company"><span class="swatch swatch-company" aria-hidden="true"></span> Entreprise</p>
        <h2>${e['url'] ? `<a href="${esc(e['url'])}" target="_blank" rel="noopener">${esc(e['Name'])}${NEW_TAB}</a>` : esc(e['Name'])}</h2>
        <p class="where">${esc(cities.join(', '))}${p.employees ? ' · ' + size_text(p.employees) : ''}</p>
        ${e['Description'] ? `<p class="desc">${esc(e['Description'])}</p>` : ''}
        ${tags.length ? `<p class="tags">${tags.map((t) => `<span>${esc(t)}</span>`).join('')}</p>` : ''}
        <p class="links">${e['Jobs'] ? `<a href="${esc(e['Jobs'])}" target="_blank" rel="noopener">Offres d'emploi${NEW_TAB}</a>` : ''}
            <a href="${COMPANIES_LISTING}" target="_blank" rel="noopener">Listing des entreprises${NEW_TAB}</a></p>`;
}

function team_block(p) {
    const team = p.team || {}, lab = p.lab;
    const themes = team['Thèmes'] ?? lab['Thèmes'];
    const url = team['URL'] || lab['URL'];
    const title = p.team_key ? `${esc(p.lab_key)} – ${esc(p.team_key)}` : esc(p.lab_key);
    return `<div class="team">
        <h3>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${title}${NEW_TAB}</a>` : title}${p.inria ? ' <span class="badge">Inria</span>' : ''}</h3>
        ${team['Nom'] ? `<p class="team-name">${esc(team['Nom'])}</p>` : ''}
        ${themes ? `<p class="desc">${esc(themes)}</p>` : ''}</div>`;
}

function list_block(title, items, empty, limit) {
    if(items.length==0) return `<h3 class="near-title">${title}</h3><p class="muted">${empty}</p>`;
    const row = ({p, d}) => `<li><button type="button" class="goto" data-id="${esc(p.id)}">${esc(p.name)}</button>
        <span class="dist">${km_text(d)}</span>${p.kind=='lab' && p.team?.['Nom'] ? `<span class="sub">${esc(p.team['Nom'])}</span>` : ''}</li>`;
    const shown = items.slice(0, limit), rest = items.slice(limit);
    return `<h3 class="near-title">${title} <span class="count">${items.length}</span></h3><ul class="near">${shown.map(row).join('')}</ul>`
        + (rest.length ? `<details class="more"><summary>Voir les ${rest.length} autres</summary><ul class="near">${rest.map(row).join('')}</ul></details>` : '');
}

function render_panel(sel) {
    if(sel==null) { PANEL.innerHTML = EMPTY_PANEL; render_hubs(); return; }
    const center = sel.kind=='company' ? sel : sel.site;
    const site_teams = sel.kind=='company' ? [] : (sel.multi || sel.site.teams);
    let html = '';
    if(sel.kind=='company') {
        html += company_block(sel);
        html += list_block(`Équipes de recherche à moins de ${RADIUS_KM} km`, near(center, STATE.labs, () => false),
            `Aucune équipe de recherche du listing à moins de ${RADIUS_KM} km.`, 12);
        html += list_block(`Autres entreprises à moins de ${RADIUS_KM} km`, near(center, STATE.companies, (q) => q.k==sel.k),
            'Aucune autre entreprise du listing à proximité.', 8);
    }
    else {
        html += `<p class="kind kind-lab"><span class="swatch swatch-lab" aria-hidden="true"></span> Recherche${site_teams.length>1 ? ` · ${site_teams.length} équipes sur ce site` : ''}</p>`;
        const lab = site_teams[0].lab;
        html += `<h2>${esc(site_teams[0].lab_key)}</h2><p class="where">${esc(lab['Nom'] || '')}${site_teams[0].city ? ' · ' + esc(site_teams[0].city) : ''}</p>`;
        html += site_teams.map(team_block).join('');
        html += list_block(`Entreprises à moins de ${RADIUS_KM} km`, near(center, STATE.companies, () => false),
            `Aucune entreprise du listing à moins de ${RADIUS_KM} km.`, 15);
        html += list_block(`Autres équipes de recherche à moins de ${RADIUS_KM} km`, near(center, STATE.labs, (q) => q.site==sel.site),
            'Aucune autre équipe du listing à proximité.', 8);
    }
    html += `<p class="panel-actions"><button type="button" class="reset">← Retour à la vue d'ensemble</button></p>`;
    PANEL.innerHTML = `<div class="panel-sel">${html}</div>`;
}

function select(sel, options = {}) {
    STATE.selected = sel;
    if(STATE.circle) { STATE.circle.remove(); STATE.circle = null; }
    if(sel) {
        const center = sel.kind=='company' ? sel : sel.site;
        STATE.circle = L.circle([center.lat, center.lon], {'radius': RADIUS_KM*1000, 'color': sel.kind=='company' ? '#56720c' : '#a3162b',
            'weight': 1.5, 'dashArray': '6 5', 'fillOpacity': 0.05, 'interactive': false}).addTo(STATE.map);
        if(options.fly) STATE.map.flyToBounds(STATE.circle.getBounds(), {'duration': 0.6});
    }
    draw_markers();
    render_panel(sel);
    // lien partageable vers la sélection
    const params = new URLSearchParams();
    if(sel?.kind=='company') params.set('entreprise', sel.name);
    else if(sel?.kind=='lab') params.set('equipe', sel.multi ? sel.multi[0].lab_key : sel.id);
    history.replaceState(null, '', params.toString() ? '?' + params : location.pathname);
    if(window.parentIFrame) window.parentIFrame.size();
}

// Pôles : les équipes de recherche regroupées par zone (zones du listing des entreprises, sinon équipes
// à moins de 30 km les unes des autres), avec les entreprises à moins de 30 km d'une de leurs équipes
function render_hubs() {
    const element = document.querySelector('#hubs');
    if(!element || STATE.labs.length==0) return;
    const hubs = [];
    const zone_of = (p) => STATE.zones[String(p.city || p.lab['Ville'] || '').split(',')[0].trim()];
    // d'abord les équipes dont la ville a une zone, puis les autres rejoignent le pôle le plus proche
    for(const p of [...STATE.labs].sort((a, b) => !zone_of(a) - !zone_of(b))) {
        const city = String(p.city || p.lab['Ville'] || '').split(',')[0].trim();
        const zone = zone_of(p);
        let hub = hubs.find((h) => (zone && h.zone==zone) || (!zone && h.teams.some((q) => km(p, q)<=RADIUS_KM)));
        if(!hub) { hub = {'zone': zone, 'city': zone || city, 'teams': []}; hubs.push(hub); }
        hub.teams.push(p);
    }
    const list = hubs.map((h) => {
        const companies = STATE.companies.filter((c) => h.teams.some((t) => km(c, t)<=RADIUS_KM));
        const lat = h.teams.reduce((s, t) => s + t.lat, 0)/h.teams.length, lon = h.teams.reduce((s, t) => s + t.lon, 0)/h.teams.length;
        return {...h, lat, lon, 'companies': new Set(companies.map((c) => c.k)).size,
            'bounds': L.latLngBounds(h.teams.map((t) => [t.lat, t.lon])).pad(0.1)};
    }).sort((a, b) => b.teams.length - a.teams.length || b.companies - a.companies);
    element.innerHTML = `<h3 class="near-title">Les pôles</h3><p class="muted">Équipes de recherche et entreprises à moins de ${RADIUS_KM} km.</p>
        <ul class="hubs">${list.map((h, i) => `<li><button type="button" class="hub" data-i="${i}">${esc(h.city)}</button>
        <span class="hub-counts"><span class="swatch swatch-lab" aria-hidden="true"></span>${h.teams.length}
        <span class="swatch swatch-company" aria-hidden="true"></span>${h.companies}</span></li>`).join('')}</ul>`;
    element.querySelectorAll('.hub').forEach((b) => b.addEventListener('click', () => {
        const h = list[+b.dataset.i];
        STATE.map.flyToBounds(h.bounds.extend(L.latLng(h.lat, h.lon).toBounds(2*RADIUS_KM*1000)), {'duration': 0.6});
    }));
}

function find_point(id) {
    return STATE.companies.find((p) => p.id==id) || STATE.labs.find((p) => p.id==id);
}

PANEL.addEventListener('click', (event) => {
    const go = event.target.closest('.goto');
    if(go) { const p = find_point(go.dataset.id); if(p) select(p, {'fly': true}); return; }
    if(event.target.closest('.reset')) select(null);
});

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

function init_frames() {
    const nav = document.querySelector('#frames');
    nav.innerHTML = FRAMES.map((f, i) => `<button type="button" class="frame" data-i="${i}">${esc(f.label)}</button>`).join('');
    nav.addEventListener('click', (event) => {
        const b = event.target.closest('.frame');
        if(b) STATE.map.flyToBounds(FRAMES[+b.dataset.i].bounds, {'duration': 0.6});
    });
}

function select_from_url() {
    const params = new URLSearchParams(location.search);
    const company = params.get('entreprise'), team = params.get('equipe');
    if(company) {
        const p = STATE.companies.find((q) => norm(q.name)==norm(company));
        if(p) select(p, {'fly': true});
    }
    else if(team) {
        const p = STATE.labs.find((q) => norm(q.id)==norm(team));
        const lab = STATE.labs.filter((q) => norm(q.lab_key)==norm(team));
        if(p) select(p, {'fly': true});
        else if(lab.length) select(lab.length==1 ? lab[0] : {'kind': 'lab', 'site': lab[0].site, 'multi': lab.filter((q) => q.site==lab[0].site)}, {'fly': true});
    }
}

async function start() {
    create_map();
    init_frames();
    try {
        const [companies, labs] = await Promise.all(Object.values(SOURCES).map((url) => fetch(url).then((r) => {
            if(!r.ok) throw new Error(`HTTP ${r.status} : ${url}`);
            return r.json();
        })));
        STATE.companies = build_companies(companies);
        STATE.labs = build_labs(labs);
        STATE.sites = build_sites(STATE.labs);
        STATE.zones = companies['Zones'] || {};
        if(companies['Updated']) document.querySelector('#updated').textContent = `Listing des entreprises mis à jour le ${companies['Updated']}.`;
    }
    catch(error) {
        PANEL.innerHTML = `<p class="error">Les données n'ont pas pu être chargées (${esc(error.message)}).</p>`;
        return;
    }
    STATE.map.invalidateSize();
    STATE.map.fitBounds(FRAMES[0].bounds);
    draw_markers();
    render_hubs();
    select_from_url();
    for(const id of ['show-companies', 'show-labs']) document.querySelector('#' + id).addEventListener('change', draw_markers);
    let timer = null;
    document.querySelector('#search').addEventListener('input', (event) => {
        clearTimeout(timer);
        timer = setTimeout(() => { STATE.query = norm(event.target.value.trim()); draw_markers(); }, 150);
    });
    document.addEventListener('keydown', (event) => { if(event.key=='Escape' && STATE.selected) select(null); });
}

start();
