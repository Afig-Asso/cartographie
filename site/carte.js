"use strict";

// ---------------------------------------------------------------------------
// Carte de l'informatique graphique en France : entreprises (listing AFIG des entreprises) et
// équipes de recherche (listing AFIG des équipes), avec ce qui se trouve à moins de 30 km.
// Les deux listings sont lus directement dans leurs dépôts : la carte suit leurs mises à jour.
// Mise en page plein écran : carte, recherche et couches en haut, panneau à gauche (en bas sur mobile).
// ---------------------------------------------------------------------------

const IS_LOCAL = ['localhost', '127.0.0.1', ''].includes(location.hostname);
const SOURCES = {
    'companies': IS_LOCAL ? '../../entreprises/json/data.json' : 'https://raw.githubusercontent.com/Afig-Asso/entreprises/main/json/data.json',
    'labs': IS_LOCAL ? '../../research-team/json/data.json' : 'https://raw.githubusercontent.com/Afig-Asso/research-team/main/json/data.json',
};
const COMPANIES_LISTING = 'https://afig-asso.github.io/entreprises/';
const LABS_LISTING = 'https://github.com/Afig-Asso/research-team';
const RADIUS_KM = 30;
const DOTS_ZOOM = 10;  // à partir de ce zoom : chaque point séparément, plus de regroupements
const FRANCE = [[42.2, -4.8], [51.1, 8.3]];
const REGIONS = [
    {'label': 'France entière', 'bounds': FRANCE},
    {'label': 'Paris – Île-de-France', 'bounds': [[48.6, 1.95], [49.0, 2.7]]},
    {'label': 'Lyon – Grenoble', 'bounds': [[44.95, 4.6], [45.95, 6.1]]},
    {'label': 'Bretagne – Pays de la Loire', 'bounds': [[46.9, -4.9], [48.9, -0.4]]},
    {'label': 'Bordeaux – Toulouse', 'bounds': [[43.3, -1.4], [45.2, 2.0]]},
    {'label': 'Montpellier – Marseille – Nice', 'bounds': [[43.0, 3.5], [44.0, 7.5]]},
    {'label': 'Nord et Est', 'bounds': [[47.0, 2.8], [51.2, 8.2]]},
];
const MOBILE = window.matchMedia('(max-width: 760px)');

const STATE = {
    'map': null, 'companies': [], 'labs': [], 'zones': {}, 'groups': {}, 'markers': new Map(),
    'circle': null, 'selected': null, 'query': '', 'show': {'companies': true, 'labs': true}, 'updated': '',
};
const $ = (s) => document.querySelector(s);
const PANEL = $('#panel'), BODY = $('#panel-body');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const as_list = (v) => v==null ? [] : (Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim()).filter((x) => x!='');
const NEW_TAB = '<span class="visually-hidden"> (nouvel onglet)</span>';
const ICON = {
    'back': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 7-5 5 5 5"/></svg>',
    'web': '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/></svg>',
    'jobs': '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 13h18"/></svg>',
    'list': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>',
    'link': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
    'center': '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
};

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
    return cities.map((c) => ({'city': c, 'coords': cities.length==1 ? (place['Coordinates'] || null) : null}));
}

function build_companies(data) {
    const places = data['Places'] || {};
    const out = [];
    data['Listing'].forEach((entry, k) => {
        const seen = new Set();
        french_places(entry['Place']).forEach((p, j) => {
            const coords = p.coords || places['France/' + p.city];
            if(!coords || seen.has(coords.join(','))) return;
            seen.add(coords.join(','));
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
        const add = (team_key, team) => {
            const coords = (team && team['Coordonnées']) || lab['Coordonnées'];
            if(!coords) return;
            const ville = (team && team['Ville']) || lab['Ville'] || '';
            out.push({
                'kind': 'lab', 'id': team_key ? `${lab_key}/${team_key}` : lab_key, 'lab_key': lab_key, 'lab': lab,
                'team_key': team_key, 'team': team, 'name': team_key ? `${lab_key} – ${team_key}` : lab_key,
                'city': ville, 'lat': coords[0], 'lon': coords[1], 'inria': !!team && 'Inria' in team,
                'text': norm([lab_key, lab['Nom'], ville, team_key, team?.['Nom'], team?.['Thèmes'] ?? lab['Thèmes']].join(' ')),
            });
        };
        const teams = Object.entries(lab['Equipes'] || {});
        if(teams.length==0) add(null, null);
        teams.forEach(([t, team]) => add(t, team));
    }
    // équipes au même endroit (même bâtiment) : un seul repère
    const sites = new Map();
    for(const p of out) {
        const key = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
        if(!sites.has(key)) sites.set(key, {'id': 's' + sites.size, 'lat': p.lat, 'lon': p.lon, 'teams': []});
        sites.get(key).teams.push(p);
        p.site = sites.get(key);
    }
    return out;
}

const site_selection = (site, teams) => teams.length==1 ? teams[0] : {'kind': 'lab', 'site': site, 'multi': teams, 'name': teams[0].lab_key};

// ---------------------------------------------------------------------------
// Carte
// ---------------------------------------------------------------------------

function dot_icon(p, selected) {
    const size = p.employees==null ? 12 : Math.round(Math.min(30, 10 + 4*Math.log10(p.employees)));
    return L.divIcon({'className': 'pin dot' + (p.employees==null ? ' dot-unknown' : '') + (selected ? ' is-selected' : ''), 'html': '', 'iconSize': [size, size]});
}

function lab_icon(N, selected) {
    const size = N>1 ? 28 : 20;
    return L.divIcon({'className': 'pin diamond' + (selected ? ' is-selected' : ''), 'html': N>1 ? `<span>${N}</span>` : '', 'iconSize': [size, size]});
}

// marge pour ne pas cacher la sélection sous le panneau et la barre du haut
function view_padding() {
    if(MOBILE.matches) return {'paddingTopLeft': [20, 120], 'paddingBottomRight': [20, PANEL.classList.contains('is-closed') ? 80 : PANEL.offsetHeight + 20]};
    const left = PANEL.classList.contains('is-closed') ? 30 : PANEL.offsetWidth + 40;
    return {'paddingTopLeft': [left, 80], 'paddingBottomRight': [70, 60]};
}

function fly_to(bounds) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    STATE.map.flyToBounds(bounds, {...view_padding(), 'duration': reduce ? 0 : 0.7, 'animate': !reduce});
}

function create_map() {
    const embedded = document.documentElement.classList.contains('embedded');
    // la molette est gérée par smooth_wheel (celle de Leaflet perd les crans qui arrivent pendant une animation)
    const map = L.map('map', {'zoomControl': false, 'scrollWheelZoom': false, 'minZoom': 4, 'maxZoom': 18, 'zoomSnap': 0, 'zoomDelta': 0.5,
        'worldCopyJump': true});
    STATE.wheel = !embedded;
    smooth_wheel(map, () => STATE.wheel);
    // fond gris clair et discret (les repères de couleur ressortent), noms des lieux par-dessus
    const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
    L.tileLayer(esri + 'World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        'maxNativeZoom': 16, 'maxZoom': 18, 'attribution': 'Fond de carte &copy; Esri, HERE, Garmin, &copy; contributeurs OpenStreetMap',
    }).addTo(map);
    L.tileLayer(esri + 'World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {'maxNativeZoom': 16, 'maxZoom': 18, 'pane': 'shadowPane'}).addTo(map);  // au-delà de 16 : tuiles agrandies
    L.control.zoom({'position': 'bottomright', 'zoomInTitle': 'Zoomer', 'zoomOutTitle': 'Dézoomer'}).addTo(map);
    if(embedded) { // dans le site de l'AFIG, la molette fait défiler la page tant qu'on n'a pas cliqué la carte
        $('#wheel-hint').hidden = false;
        map.on('click focus', () => { STATE.wheel = true; $('#wheel-hint').hidden = true; });
        map.on('mouseout blur', () => { STATE.wheel = false; });
    }
    STATE.groups.companies = L.markerClusterGroup({
        'showCoverageOnHover': false, 'maxClusterRadius': 48, 'spiderfyOnMaxZoom': true, 'disableClusteringAtZoom': DOTS_ZOOM,
        'iconCreateFunction': (c) => {
            const N = c.getChildCount(), size = Math.round(26 + 5*Math.log2(N));
            return L.divIcon({'className': 'pin cluster-company', 'html': `<span>${N}</span>`, 'iconSize': [size, size]});
        },
    }).addTo(map);
    STATE.groups.labs = L.markerClusterGroup({
        'showCoverageOnHover': false, 'maxClusterRadius': 26, 'spiderfyOnMaxZoom': true, 'disableClusteringAtZoom': DOTS_ZOOM,
        'iconCreateFunction': (c) => {
            const N = c.getAllChildMarkers().reduce((s, m) => s + m.options.teams, 0);
            return L.divIcon({'className': 'pin diamond', 'html': `<span>${N}</span>`, 'iconSize': [30, 30]});
        },
    }).addTo(map);
    let spread_timer = null;  // pendant un zoom continu, zoomend arrive à chaque image : on écarte les points une fois le zoom posé
    map.on('zoomend', () => { clearTimeout(spread_timer); spread_timer = setTimeout(spread, 120); });
    STATE.map = map;
}

// Zoom à la molette continu, à la Google Maps : chaque cran (ou geste de trackpad) ajoute au zoom visé, et la
// carte le rejoint en douceur autour du pointeur ; aucun cran n'est perdu, même pendant le mouvement.
const WHEEL_PX_PER_LEVEL = 200;  // un cran de souris (100 px) ≈ un demi-niveau ; un geste de trackpad de 200 px ≈ 1 niveau
function smooth_wheel(map, enabled) {
    let target = null, anchor = null, anchor_ll = null, frame = null, timer = null;
    // le lieu sous le pointeur reste sous le pointeur (calcul exact à chaque image, sans accumuler d'arrondis)
    const zoom_to = (z) => {
        const center = map.unproject(map.project(anchor_ll, z).subtract(anchor).add(map.getSize().divideBy(2)), z);
        map.setView(center, z, {'animate': false});
    };
    const finish = () => { if(target!=null) zoom_to(target); target = null; frame = null; };
    const step = () => {
        const z = map.getZoom(), diff = target - z;
        if(Math.abs(diff)<0.01) { finish(); return; }
        zoom_to(z + diff*0.28);
        frame = requestAnimationFrame(step);
    };
    map.getContainer().addEventListener('wheel', (event) => {
        if(!enabled()) return;  // la page défile
        event.preventDefault();
        let dy = event.deltaY*(event.deltaMode==1 ? 16 : event.deltaMode==2 ? 400 : 1);
        if(event.ctrlKey) dy *= 3;  // pincement sur trackpad : petits deltas
        dy = Math.max(-250, Math.min(250, dy));
        if(target==null) target = map.getZoom();
        target = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), target - dy/WHEEL_PX_PER_LEVEL));
        const point = map.mouseEventToContainerPoint(event);
        if(anchor==null || frame==null || point.distanceTo(anchor)>4) { anchor = point; anchor_ll = map.containerPointToLatLng(point); }
        if(frame==null) frame = requestAnimationFrame(step);
        clearTimeout(timer);
        timer = setTimeout(() => { if(frame!=null) { cancelAnimationFrame(frame); finish(); } }, 900);  // onglet en arrière-plan : finir quand même
    }, {'passive': false});
}

// Entreprises au même endroit (souvent le centre de leur ville) : une fois les regroupements défaits,
// leurs points sont écartés en tournesol autour de cet endroit pour rester tous visibles et cliquables
function spread() {
    const map = STATE.map, zoom = map.getZoom(), stacks = STATE.stacks || [];
    if(stacks.length==0) return;
    const moved = stacks.flatMap((s) => s.markers);
    STATE.groups.companies.removeLayers(moved);
    for(const stack of stacks) {
        const center = map.project([stack.lat, stack.lon], zoom);
        stack.markers.forEach((m, i) => {
            if(zoom<DOTS_ZOOM) { m.setLatLng([stack.lat, stack.lon]); return; }
            const r = 12*Math.sqrt(i + 0.5), angle = i*2.39996;
            m.setLatLng(map.unproject(center.add([r*Math.cos(angle), r*Math.sin(angle)]), zoom));
        });
    }
    STATE.groups.companies.addLayers(moved);
}

const matches = (p) => STATE.query=='' || STATE.query.split(/\s+/).every((w) => p.text.includes(w));

function draw_markers() {
    STATE.groups.companies.clearLayers();
    STATE.groups.labs.clearLayers();
    STATE.markers.clear();
    const companies = STATE.companies.filter(matches), teams = STATE.labs.filter(matches);
    const sel = STATE.selected;
    if(STATE.show.companies) {
        STATE.groups.companies.addLayers(companies.map((p) => {
            const m = L.marker([p.lat, p.lon], {'icon': dot_icon(p, sel?.kind=='company' && sel.k==p.k), 'title': p.name, 'alt': p.name, 'riseOnHover': true});
            m.bindTooltip(`${esc(p.name)}<span class="tip-sub">${esc(p.city)}${p.employees ? ' · ' + size_text(p.employees) : ''}</span>`, {'direction': 'top', 'offset': [0, -8]});
            m.on('click', () => select(p));
            STATE.markers.set(p.id, m);
            return m;
        }));
    }
    const stacks = new Map();
    if(STATE.show.companies) {
        companies.forEach((p) => {
            const key = `${p.lat},${p.lon}`;
            if(!stacks.has(key)) stacks.set(key, {'lat': p.lat, 'lon': p.lon, 'markers': []});
            stacks.get(key).markers.push(STATE.markers.get(p.id));
        });
    }
    STATE.stacks = [...stacks.values()].filter((s) => s.markers.length>1);
    if(STATE.show.labs) {
        const by_site = new Map();
        teams.forEach((p) => { if(!by_site.has(p.site)) by_site.set(p.site, []); by_site.get(p.site).push(p); });
        STATE.groups.labs.addLayers([...by_site.entries()].map(([site, list]) => {
            const names = list.map((p) => p.name).join(', ');
            const selected = sel?.kind=='lab' && (sel.site==site || sel.multi?.[0].site==site);
            const m = L.marker([site.lat, site.lon], {'icon': lab_icon(list.length, selected), 'title': names, 'alt': names, 'teams': list.length, 'zIndexOffset': 1000, 'riseOnHover': true});
            m.bindTooltip(list.map((p) => esc(p.name)).join('<br>') + `<span class="tip-sub">${esc(list[0].city)}</span>`, {'direction': 'top', 'offset': [0, -10]});
            m.on('click', () => select(site_selection(site, list)));
            list.forEach((p) => STATE.markers.set(p.id, m));
            return m;
        }));
    }
    spread();
    $('#count-companies').textContent = new Set(companies.map((p) => p.k)).size;
    $('#count-labs').textContent = teams.length;
}

// ---------------------------------------------------------------------------
// Panneau
// ---------------------------------------------------------------------------

function set_panel(state) { // 'open' | 'closed' | 'expanded' (mobile)
    PANEL.classList.toggle('is-closed', state=='closed');
    PANEL.classList.toggle('is-expanded', state=='expanded');
    $('#panel-toggle').setAttribute('aria-expanded', String(state!='closed'));
    $('#panel-toggle').setAttribute('aria-label', state=='closed' ? 'Afficher le panneau' : 'Masquer le panneau');
}

// Points à moins de 30 km ; une entreprise n'apparaît qu'une fois (son implantation la plus proche).
// Tri par distance, ou par ordre alphabétique (alpha)
function near(center, points, exclude, alpha) {
    const best = new Map();
    for(const p of points) {
        if(exclude(p)) continue;
        const d = km(center, p);
        if(d>RADIUS_KM) continue;
        const key = p.kind=='company' ? 'c' + p.k : p.id;
        if(!best.has(key) || d<best.get(key).d) best.set(key, {p, d});
    }
    const by_name = (a, b) => a.p.name.localeCompare(b.p.name, 'fr', {'sensitivity': 'base'});
    return [...best.values()].sort(alpha ? by_name : (a, b) => a.d - b.d || by_name(a, b));
}

function near_section(title, items, empty) {
    if(items.length==0) return `<section class="section"><h3 class="section-title">${title}</h3><p class="muted">${empty}</p></section>`;
    const row = ({p, d}) => `<li data-id="${esc(p.id)}"><span class="swatch swatch-${p.kind=='lab' ? 'lab' : 'company'}" aria-hidden="true"></span>
        <button type="button" class="goto" data-id="${esc(p.id)}">${esc(p.name)}</button><span class="dist">${km_text(d)}</span>
        ${p.kind=='lab' && p.team?.['Nom'] ? `<span class="sub">${esc(p.team['Nom'])}</span>` : (p.kind=='company' && p.entry['Description'] ? `<span class="sub">${esc(p.entry['Description'])}</span>` : '')}</li>`;
    return `<section class="section"><h3 class="section-title">${title} <span class="n">${items.length}</span></h3><ul class="near">${items.map(row).join('')}</ul></section>`;
}

const back_button = `<button type="button" class="back">${ICON.back}Vue d'ensemble</button>`;

function company_html(p) {
    const e = p.entry;
    const cities = [...new Set(STATE.companies.filter((q) => q.k==p.k).map((q) => q.city))];
    const tags = [...as_list(e['Scientific-domain']), ...as_list(e['Application-domain'])];
    return `<div class="panel-company">${back_button}
        <p class="eyebrow eyebrow-company"><span class="swatch swatch-company" aria-hidden="true"></span>Entreprise</p>
        <h2>${esc(e['Name'])}</h2>
        <p class="where">${esc(cities.join(', '))}${p.employees ? ' · ' + size_text(p.employees) : ''}</p>
        <div class="actions">
            ${e['url'] ? `<a class="action primary" href="${esc(e['url'])}" target="_blank" rel="noopener">${ICON.web}Site web${NEW_TAB}</a>` : ''}
            ${e['Jobs'] ? `<a class="action" href="${esc(e['Jobs'])}" target="_blank" rel="noopener">${ICON.jobs}Offres d'emploi${NEW_TAB}</a>` : ''}
            <button type="button" class="action center-btn">${ICON.center}Centrer</button>
            <button type="button" class="action share-btn">${ICON.link}Copier le lien</button>
        </div>
        ${e['Description'] ? `<p class="desc">${esc(e['Description'])}</p>` : ''}
        ${tags.length ? `<p class="tags">${tags.map((t) => `<span>${esc(t)}</span>`).join('')}</p>` : ''}
        ${near_section(`Équipes de recherche à moins de ${RADIUS_KM} km`, near(p, STATE.labs, () => false), `Aucune équipe de recherche du listing à moins de ${RADIUS_KM} km.`)}
        ${near_section(`Autres entreprises à moins de ${RADIUS_KM} km`, near(p, STATE.companies, (q) => q.k==p.k, true), 'Aucune autre entreprise du listing à proximité.')}
    </div>`;
}

function team_html(p) {
    const team = p.team || {}, lab = p.lab;
    const themes = team['Thèmes'] ?? lab['Thèmes'];
    const url = team['URL'] || lab['URL'];
    const title = p.team_key ? esc(p.team_key) : esc(p.lab_key);
    return `<div class="team"><h3>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${title}${NEW_TAB}</a>` : title}${p.inria ? '<span class="badge">Inria</span>' : ''}</h3>
        ${team['Nom'] ? `<p class="team-name">${esc(team['Nom'])}</p>` : ''}${themes ? `<p class="desc">${esc(themes)}</p>` : ''}</div>`;
}

function lab_html(sel) {
    const teams = sel.multi || [sel], site = teams[0].site, lab = teams[0].lab;
    return `<div class="panel-lab">${back_button}
        <p class="eyebrow eyebrow-lab"><span class="swatch swatch-lab" aria-hidden="true"></span>Recherche${teams.length>1 ? ` · ${teams.length} équipes sur ce site` : ''}</p>
        <h2>${esc(teams[0].lab_key)}</h2>
        <p class="where">${esc(lab['Nom'] || '')}${teams[0].city ? ' · ' + esc(teams[0].city) : ''}</p>
        <div class="actions">
            ${lab['URL'] ? `<a class="action primary" href="${esc(lab['URL'])}" target="_blank" rel="noopener">${ICON.web}Laboratoire${NEW_TAB}</a>` : ''}
            <button type="button" class="action center-btn">${ICON.center}Centrer</button>
            <button type="button" class="action share-btn">${ICON.link}Copier le lien</button>
        </div>
        ${teams.map(team_html).join('')}
        ${near_section(`Entreprises à moins de ${RADIUS_KM} km`, near(site, STATE.companies, () => false, true), `Aucune entreprise du listing à moins de ${RADIUS_KM} km.`)}
        ${near_section(`Autres équipes de recherche à moins de ${RADIUS_KM} km`, near(site, STATE.labs, (q) => q.site==site), 'Aucune autre équipe du listing à proximité.')}
    </div>`;
}

// Villes : les zones du listing des entreprises (ville et sa périphérie), et les villes des équipes de
// recherche hors de ces zones ; chacune est cadrée sur l'ensemble de ses points
function places() {
    const groups = new Map();
    const add = (name, p) => { if(!groups.has(name)) groups.set(name, []); groups.get(name).push([p.lat, p.lon]); };
    for(const p of STATE.companies) add(STATE.zones[p.city] || p.city, p);
    // une équipe dans une ville sans zone (Saclay, Montbonnot...) rejoint la zone de l'entreprise la plus proche (moins de 25 km)
    const lab_place = (p) => {
        const city = String(p.city).split(',')[0].trim();
        if(STATE.zones[city]) return STATE.zones[city];
        let best = null, dmin = 25;
        for(const c of STATE.companies) {
            const zone = STATE.zones[c.city], d = km(p, c);
            if(zone && d<dmin) { dmin = d; best = zone; }
        }
        return best || city;
    };
    const lab_names = new Set();
    for(const p of STATE.labs) { const name = lab_place(p); lab_names.add(name); add(name, p); }
    return [...groups.entries()].filter(([name, pts]) => pts.length>=3 || lab_names.has(name))
        .map(([name, pts]) => ({name, 'bounds': L.latLngBounds(pts)}))
        .sort((x, y) => x.name.localeCompare(y.name, 'fr', {'sensitivity': 'base'}));
}

function overview_html() {
    const N_companies = new Set(STATE.companies.map((p) => p.k)).size;
    STATE.places = places();
    return `<div class="intro">
        <h2>L'informatique graphique en France</h2>
        <p>Les entreprises et les équipes de recherche du domaine. Cliquer une équipe de recherche pour voir les entreprises
            à moins de ${RADIUS_KM} km, ou une entreprise pour voir les équipes proches.</p>
        <div class="stats">
            <div class="stat"><strong>${N_companies}</strong><span>entreprises en France</span></div>
            <div class="stat lab"><strong>${STATE.labs.length}</strong><span>équipes de recherche</span></div>
        </div></div>
        <section class="section"><h3 class="section-title">Régions</h3>
        <div class="place-chips">${REGIONS.map((r, i) => `<button type="button" class="place" data-region="${i}">${esc(r.label)}</button>`).join('')}</div></section>
        <section class="section"><h3 class="section-title">Villes</h3>
        <div class="place-chips">${STATE.places.map((c, i) => `<button type="button" class="place" data-city="${i}">${esc(c.name)}</button>`).join('')}</div></section>
        <p class="footer-note">Données : <a href="${COMPANIES_LISTING}" target="_blank" rel="noopener">listing des entreprises${NEW_TAB}</a>
            et <a href="${LABS_LISTING}" target="_blank" rel="noopener">listing des équipes de recherche${NEW_TAB}</a> de l'AFIG,
            à compléter ou corriger sur GitHub ou par courriel (contact[at]asso-afig.fr).${STATE.updated ? ` Entreprises mises à jour le ${esc(STATE.updated)}.` : ''}</p>`;
}

function render_panel() {
    const sel = STATE.selected;
    BODY.innerHTML = sel==null ? overview_html() : (sel.kind=='company' ? company_html(sel) : lab_html(sel));
    BODY.scrollTop = 0;
}

function select(sel, options = {}) {
    STATE.selected = sel;
    if(STATE.circle) { STATE.circle.remove(); STATE.circle = null; }
    draw_markers();
    render_panel();
    if(sel) {
        const center = sel.kind=='company' ? sel : (sel.site || sel.multi[0].site);
        STATE.circle = L.circle([center.lat, center.lon], {'radius': RADIUS_KM*1000, 'color': sel.kind=='company' ? '#3e5307' : '#6e0d1c',
            'weight': 1.5, 'dashArray': '6 6', 'fillColor': sel.kind=='company' ? '#7fa81a' : '#a3162b', 'fillOpacity': 0.06, 'interactive': false}).addTo(STATE.map);
        if(PANEL.classList.contains('is-closed')) set_panel('open');
        if(options.fly) fly_to(STATE.circle.getBounds());  // seulement depuis la recherche ou un lien direct
    }
    const params = new URLSearchParams();
    if(sel?.kind=='company') params.set('entreprise', sel.name);
    else if(sel?.kind=='lab') params.set('equipe', sel.multi ? sel.multi[0].lab_key : sel.id);
    history.replaceState(null, '', params.toString() ? '?' + params : location.pathname);
}

function find_point(id) {
    return STATE.companies.find((p) => p.id==id) || STATE.labs.find((p) => p.id==id);
}

function highlight(id, on) {
    const icon = STATE.markers.get(id)?._icon;
    if(icon) icon.classList.toggle('is-hover', on);
}

BODY.addEventListener('click', (event) => {
    const go = event.target.closest('.goto');
    if(go) { // la vue ne bouge pas, sauf si le point est hors de l'écran : la carte glisse alors jusqu'à lui, sans changer de zoom
        const p = find_point(go.dataset.id);
        if(!p) return;
        select(p);
        if(!STATE.map.getBounds().contains([p.lat, p.lon])) STATE.map.panTo([p.lat, p.lon]);
        return;
    }
    if(event.target.closest('.back')) { select(null); return; }
    if(event.target.closest('.center-btn') && STATE.circle) { fly_to(STATE.circle.getBounds()); return; }
    const share = event.target.closest('.share-btn');
    if(share) {
        navigator.clipboard?.writeText(location.href).then(() => { share.lastChild.textContent = 'Lien copié'; }, () => {});
        return;
    }
    const place = event.target.closest('.place');
    if(place) {
        if(place.dataset.region!=undefined) fly_to(REGIONS[+place.dataset.region].bounds);
        else {
            const c = STATE.places[+place.dataset.city];
            const center = c.bounds.getCenter();
            fly_to(c.bounds.extend(center.toBounds(16000)));  // au moins ~16 km autour : pas de zoom extrême sur une ville d'un seul point
        }
        if(MOBILE.matches) set_panel('closed');
    }
});
BODY.addEventListener('mouseover', (event) => { const li = event.target.closest('.near li'); if(li) highlight(li.dataset.id, true); });
BODY.addEventListener('mouseout', (event) => { const li = event.target.closest('.near li'); if(li) highlight(li.dataset.id, false); });

$('#panel-toggle').addEventListener('click', () => set_panel(PANEL.classList.contains('is-closed') ? 'open' : 'closed'));
$('#sheet-handle').addEventListener('click', () => {
    if(PANEL.classList.contains('is-closed')) set_panel('open');
    else if(PANEL.classList.contains('is-expanded')) set_panel('closed');
    else set_panel('expanded');
});

// ---------------------------------------------------------------------------
// Recherche (filtre la carte et propose des résultats), couches, régions
// ---------------------------------------------------------------------------

const SEARCH = $('#search'), SUGGEST = $('#suggestions');
let suggestions = [], active = -1;

function show_suggestions() {
    const q = STATE.query;
    if(q=='') { SUGGEST.hidden = true; SEARCH.setAttribute('aria-expanded', 'false'); return; }
    const teams = STATE.labs.filter(matches).slice(0, 5);
    const seen = new Set();
    const companies = STATE.companies.filter((p) => matches(p) && !seen.has(p.k) && seen.add(p.k)).slice(0, 8 - teams.length);
    suggestions = [...teams, ...companies];
    active = -1;
    SUGGEST.innerHTML = suggestions.length==0 ? '<li class="s-empty">Aucun résultat</li>' : suggestions.map((p, i) =>
        `<li role="option" id="s-${i}" data-i="${i}" aria-selected="false"><span class="swatch swatch-${p.kind=='lab' ? 'lab' : 'company'}" aria-hidden="true"></span>
        <span class="s-name">${esc(p.name)}</span><span class="s-sub">${esc(p.kind=='lab' ? (p.team?.['Nom'] || p.lab['Nom'] || '') + ' · ' + p.city : p.city + (p.entry['Description'] ? ' · ' + p.entry['Description'] : ''))}</span></li>`).join('');
    SUGGEST.hidden = false;
    SEARCH.setAttribute('aria-expanded', 'true');
}

function choose(i) {
    const p = suggestions[i];
    if(!p) return;
    SUGGEST.hidden = true;
    SEARCH.setAttribute('aria-expanded', 'false');
    select(p, {'fly': true});
}

let timer = null;
SEARCH.addEventListener('input', () => {
    $('#clear-search').hidden = SEARCH.value=='';
    clearTimeout(timer);
    timer = setTimeout(() => { STATE.query = norm(SEARCH.value.trim()); draw_markers(); show_suggestions(); }, 120);
});
SEARCH.addEventListener('keydown', (event) => {
    if(SUGGEST.hidden) return;
    if(event.key=='ArrowDown' || event.key=='ArrowUp') {
        event.preventDefault();
        active = (active + (event.key=='ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
        SUGGEST.querySelectorAll('li').forEach((li, i) => li.setAttribute('aria-selected', String(i==active)));
        SEARCH.setAttribute('aria-activedescendant', 's-' + active);
    }
    else if(event.key=='Enter') { event.preventDefault(); choose(active>=0 ? active : 0); }
    else if(event.key=='Escape') { SUGGEST.hidden = true; }
});
SEARCH.addEventListener('focus', () => { if(STATE.query) show_suggestions(); });
SUGGEST.addEventListener('mousedown', (event) => { const li = event.target.closest('li[data-i]'); if(li) { event.preventDefault(); choose(+li.dataset.i); } });
document.addEventListener('click', (event) => { if(!event.target.closest('.searchbox')) SUGGEST.hidden = true; });
$('#clear-search').addEventListener('click', () => {
    SEARCH.value = ''; STATE.query = ''; $('#clear-search').hidden = true; SUGGEST.hidden = true; draw_markers(); SEARCH.focus();
});

for(const [chip, layer] of [['#chip-companies', 'companies'], ['#chip-labs', 'labs']]) {
    $(chip).addEventListener('click', () => {
        STATE.show[layer] = !STATE.show[layer];
        $(chip).setAttribute('aria-pressed', String(STATE.show[layer]));
        draw_markers();
    });
}

const REGIONS_BTN = $('#regions-btn'), REGIONS_MENU = $('#regions');
REGIONS_MENU.innerHTML = REGIONS.map((r, i) => `<button type="button" role="menuitem" data-i="${i}">${esc(r.label)}</button>`).join('');
function toggle_regions(open) {
    REGIONS_MENU.hidden = !open;
    REGIONS_BTN.setAttribute('aria-expanded', String(open));
    if(open) {
        const r = REGIONS_BTN.getBoundingClientRect();
        REGIONS_MENU.style.top = `${r.bottom + 6}px`;
        REGIONS_MENU.style.left = `${Math.min(r.left, window.innerWidth - 240)}px`;
        REGIONS_MENU.querySelector('button').focus();
    }
}
REGIONS_BTN.addEventListener('click', (event) => { event.stopPropagation(); toggle_regions(REGIONS_MENU.hidden); });
REGIONS_MENU.addEventListener('click', (event) => {
    const b = event.target.closest('button');
    if(!b) return;
    toggle_regions(false);
    fly_to(REGIONS[+b.dataset.i].bounds);
});
document.addEventListener('click', (event) => { if(!event.target.closest('.chip-menu')) toggle_regions(false); });

document.addEventListener('keydown', (event) => {
    if(event.key!='Escape') return;
    if(!REGIONS_MENU.hidden) { toggle_regions(false); REGIONS_BTN.focus(); }
    else if(STATE.selected && document.activeElement!=SEARCH) select(null);
});

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

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
        else if(lab.length) { // un labo : son site principal (ses coordonnées), sinon le site qui a le plus d'équipes
            const home = lab[0].lab['Coordonnées'];
            const sites = [...new Set(lab.map((q) => q.site))];
            const site = sites.find((s) => home && s.lat==home[0] && s.lon==home[1])
                || sites.sort((a, b) => lab.filter((q) => q.site==b).length - lab.filter((q) => q.site==a).length)[0];
            select(site_selection(site, lab.filter((q) => q.site==site)), {'fly': true});
        }
    }
}

async function start() {
    create_map();
    set_panel(MOBILE.matches ? 'closed' : 'open');
    STATE.map.fitBounds(FRANCE, view_padding());
    BODY.innerHTML = '<p class="muted">Chargement des données…</p>';
    try {
        const [companies, labs] = await Promise.all(Object.values(SOURCES).map((url) => fetch(url).then((r) => {
            if(!r.ok) throw new Error(`HTTP ${r.status} : ${url}`);
            return r.json();
        })));
        STATE.companies = build_companies(companies);
        STATE.labs = build_labs(labs);
        STATE.zones = companies['Zones'] || {};
        STATE.updated = companies['Updated'] || '';
    }
    catch(error) {
        BODY.innerHTML = `<p class="error">Les données n'ont pas pu être chargées (${esc(error.message)}).</p>`;
        return;
    }
    draw_markers();
    render_panel();
    select_from_url();
}

start();
