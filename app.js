// Simple demo app logic for Nations League pronostiek
// - Demo auth (no Firebase required)
// - Mock matches and localStorage predictions
// - Basic navigation and modal/toast helpers

let currentUser = null;
let predictions = JSON.parse(localStorage.getItem('nl_predictions') || '{}');

// Firebase integration flags (firebase-config.js initializes `auth` and `db` when configured)
const useFirebase = typeof db !== 'undefined' && db != null;
const useAuthFirebase = typeof auth !== 'undefined' && auth != null;

// When using Firebase we keep local cache in sync but persist and listen remotely
function setupFirebaseRealtime() {
	if (!useFirebase || !useAuthFirebase) return;

	auth.onAuthStateChanged(async (user) => {
		if (user) {
			currentUser = { id: user.uid, name: user.displayName || (user.email ? user.email.split('@')[0] : (user.isAnonymous ? 'Gast' : 'User')), email: user.email || '' };
			// fetch user metadata (isAdmin) from users collection if present
			try {
				const udocSnap = await db.collection('users').doc(currentUser.id).get();
				let udoc = null;
				if (udocSnap.exists) {
					udoc = udocSnap.data();
					currentUser.isAdmin = udoc.isAdmin === true;
				}
				// If neither auth profile nor users doc has a displayName, prompt for nickname
				const authDisplay = user.displayName || '';
				const usersDisplay = udoc && udoc.displayName ? udoc.displayName : '';
				if (!authDisplay && !usersDisplay) {
					// open profile editor asynchronously (don't block auth flow)
					setTimeout(() => { try { openProfileEditor(currentUser.id); } catch (e) { console.warn(e); } }, 200);
				}
			} catch (e) { console.warn('Failed to load user metadata', e); }
			// show app UI once signed in
			try { onAuthSuccess(); } catch (e) {}
			try { showToast('Aangemeld als ' + (currentUser.name || 'gast'), 'success'); } catch (e) {}
			// load user's predictions from Firestore
			db.collection('predictions').where('userId', '==', currentUser.id)
				.onSnapshot(snap => {
					snap.forEach(doc => {
						const data = doc.data();
						predictions[data.matchId] = { home: String(data.home), away: String(data.away), userId: data.userId };
					});
					localStorage.setItem('nl_predictions', JSON.stringify(predictions));
					try { navigateTo('dashboard'); } catch (e) {}
				});

			// listen for groups where this user is a member
			db.collection('groups').where('memberIds', 'array-contains', currentUser.id)
			.onSnapshot(snap => {
				const remoteGroups = [];
				snap.forEach(doc => {
					const data = doc.data();
					remoteGroups.push({ id: doc.id, ...data });
				});
				let localGroups = [];
				try { localGroups = JSON.parse(localStorage.getItem('nl_groups') || '[]'); } catch (e) { localGroups = []; }
				const map = {};
				localGroups.forEach(g => { if (g && g.id) map[g.id] = g; });
				remoteGroups.forEach(g => { if (g && g.id) map[g.id] = g; });
				const merged = Object.values(map);
				localStorage.setItem('nl_groups', JSON.stringify(merged));
			});
		} else {
			currentUser = null;
		}

		function parseMatchDate(dateStr) {
			// Accepts formats like '2026-09-24 20:45' or ISO strings.
			if (!dateStr) return new Date(NaN);
			// If contains space between date and time, convert to local ISO-like string
			if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(dateStr)) {
				return new Date(dateStr.replace(' ', 'T'));
			}
			const d = new Date(dateStr);
			return d;
		}

		// Modal helpers
		function openPredictionModal(match) {
			// store active match for savePrediction to validate cutoff
			window._activeMatchForPrediction = match;
			const modalHtml = `
				<div class="modal-overlay" id="pred-modal">
					<div class="modal-content">
						<div class="modal-header"><h3>Voorspel: ${localizeCountry(match.home)} — ${localizeCountry(match.away)}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
						<div class="modal-body">
							<div class="modal-match">
								<div class="modal-team"><div class="modal-flag">${match.homeFlag}</div><div class="modal-team-name">${localizeCountry(match.home)}</div></div>
								<div class="modal-score-input"><input type="number" id="pred-home" class="score-input-lg" value="${predictions[match.id] ? predictions[match.id].home : ''}" min="0"> <div class="dash">-</div> <input type="number" id="pred-away" class="score-input-lg" value="${predictions[match.id] ? predictions[match.id].away : ''}" min="0"></div>
								<div class="modal-team"><div class="modal-flag">${match.awayFlag}</div><div class="modal-team-name">${localizeCountry(match.away)}</div></div>
							</div>
							<div class="scoring-info"><div class="scoring-item"><strong>3</strong>Exact</div><div class="scoring-item"><strong>1</strong>Uitkomst</div><div class="scoring-item"><strong>0</strong>Fout</div></div>
						</div>
						<div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Annuleer</button><button class="btn btn-primary" onclick="savePrediction('${match.id}')">Opslaan</button></div>
					</div>
				</div>
			`;
			document.getElementById('modal-container').innerHTML = modalHtml;
		}
		// update header UI when auth state changes
		try { updateHeaderUser(); } catch (e) {}
	});
}

// Expose key functions to `window` so inline `onclick` handlers work on the deployed site
try {
	window.navigateTo = navigateTo;
	window.switchTab = switchTab;
	window.handleLogin = handleLogin;
	window.handleRegister = handleRegister;
	window.openPredictionModal = openPredictionModal;
	window.savePrediction = savePrediction;
	window.closeModal = closeModal;
	window.createGroup = createGroup;
	window.joinGroup = joinGroup;
	window.importFixturesFromTextarea = importFixturesFromTextarea;
	window.loadFixturesFromServer = loadFixturesFromServer;
	window.handleSignOut = handleSignOut;
	window.openResultModal = openResultModal;
	window.saveMatchResultFromModal = saveMatchResultFromModal;
	window.startLiveFromAdmin = typeof startLiveFromAdmin === 'function' ? startLiveFromAdmin : (() => {});
	window.stopLiveTracking = typeof stopLiveTracking === 'function' ? stopLiveTracking : (() => {});
} catch (e) { console.warn('Failed to expose globals on window', e); }

// Initialize firebase realtime wiring if possible
setupFirebaseRealtime();

// Realtime listener for matches/results: sync Firestore `matches` -> localStorage and refresh UI
if (useFirebase) {
	try {
		db.collection('matches').onSnapshot(snap => {
			const fixtures = [];
			snap.forEach(doc => {
				const d = doc.data() || {};
				if (!d.id) d.id = doc.id;
				if (d.date && typeof d.date.toDate === 'function') {
					const dt = d.date.toDate();
					d.date = dt.toISOString().replace('T', ' ').slice(0,16);
				}
				fixtures.push(d);
			});
			try {
				localStorage.setItem('nl_fixtures', JSON.stringify(fixtures));
				try { navigateTo('matches'); } catch (e) {}
			} catch (e) { console.warn('Failed to sync matches snapshot to localStorage', e); }
		});
	} catch (e) { console.warn('Failed to attach realtime listener for matches', e); }
}

function switchTab(tab) {
	document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
	document.querySelectorAll('.auth-tab').forEach(t => { if (t.dataset.tab === tab) t.classList.add('active'); });
	document.getElementById('login-form').style.display = tab === 'login' ? '' : 'none';
	document.getElementById('register-form').style.display = tab === 'register' ? '' : 'none';
}

function handleLogin() {
	const email = document.getElementById('login-email').value.trim();
	const password = document.getElementById('login-password').value;
	if (!email) return showToast('Vul je e-mail in', 'error');
	if (useAuthFirebase) {
		auth.signInWithEmailAndPassword(email, password)
			.catch(err => showToast('Login mislukt: ' + err.message, 'error'));
		return;
	}
	// Demo fallback — accept any credentials and continue as a demo user
	currentUser = { id: 'demo-user', name: email.split('@')[0], email };
	onAuthSuccess();
}

function handleRegister() {
	const email = document.getElementById('reg-email').value.trim();
	const password = document.getElementById('reg-password').value;
	if (!email) return showToast('Vul een e-mail in', 'error');
	if (password.length < 6) return showToast('Wachtwoord te kort', 'error');
	if (useAuthFirebase) {
		auth.createUserWithEmailAndPassword(email, password)
			.then(async cred => {
				const uid = cred.user.uid;
				const userRef = db.collection('users').doc(uid);
				try {
					// create basic user document; nickname will be set after sign-in
					await userRef.set({ displayName: '', isAdmin: false }, { merge: true });
					// onAuthStateChanged will handle post-login nickname prompt
				} catch (err) {
					console.warn('Failed to create user doc', err);
				}
			})
			.catch(err => showToast('Registratie mislukt: ' + err.message, 'error'));
		return;
	}
	// Demo fallback
	currentUser = { id: 'demo-user', name: email.split('@')[0], email };
	onAuthSuccess();
}

function nameToEmail(name) {
	const local = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_\-\.]/g, '');
	return `${local}@nl-pronostiek.local`;
}

function nameToKey(name) {
	return name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_\-\.]/g, '');
}

function onAuthSuccess() {
	document.getElementById('view-auth').style.display = 'none';
	document.getElementById('app').style.display = '';
	document.getElementById('header-points').textContent = '0 pts';
	document.getElementById('header-rank').textContent = '—';
	navigateTo('dashboard');
}

function updateHeaderUser() {
	const nameEl = document.getElementById('header-username');
	const signoutBtn = document.getElementById('signout-btn');
	if (!nameEl || !signoutBtn) return;
	if (currentUser && currentUser.name) {
		nameEl.textContent = currentUser.name;
		signoutBtn.style.display = '';
	} else {
		nameEl.textContent = '';
		signoutBtn.style.display = 'none';
	}
}

// Remove anonymous guest flow. Guests not allowed.

function handleSignOut() {
	if (useAuthFirebase) {
		auth.signOut().then(() => {
			currentUser = null;
			updateHeaderUser();
			document.getElementById('view-auth').style.display = '';
			document.getElementById('app').style.display = 'none';
		}).catch(err => showToast('Afmelden mislukt: ' + err.message, 'error'));
		return;
	}
	// demo fallback
	currentUser = null;
	updateHeaderUser();
	document.getElementById('view-auth').style.display = '';
	document.getElementById('app').style.display = 'none';
}

function navigateTo(view) {
	document.querySelectorAll('#bottom-nav .nav-btn').forEach(b => b.classList.remove('active'));
	const btn = document.getElementById('nav-' + view);
	if (btn) btn.classList.add('active');

	const main = document.getElementById('main-content');
	main.innerHTML = '';

	if (view === 'dashboard') renderDashboard(main);
	if (view === 'matches') renderMatches(main);
	if (view === 'leaderboard') renderLeaderboard(main);
	if (view === 'groups') renderGroups(main);
	if (view === 'profile') renderProfile(main);
	if (view === 'admin') renderAdmin(main);
}

// Fixtures (sourced from UEFA fixtures/results pages — sample matchday 24-26 Sep 2026)
const mockMatches = [
	{ id: '2048002', league: 'League A', date: '2026-09-24 20:45', home: 'Portugal', away: 'Wales', homeFlag: '🇵🇹', awayFlag: '🏴', locked: false, played: false },
	{ id: '2048003', league: 'League A', date: '2026-09-24 20:45', home: 'Netherlands', away: 'Germany', homeFlag: '🇳🇱', awayFlag: '🇩🇪', locked: false, played: false },
	{ id: '2048004', league: 'League A', date: '2026-09-24 20:45', home: 'Serbia', away: 'Greece', homeFlag: '🇷🇸', awayFlag: '🇬🇷', locked: false, played: false },
	{ id: '2048005', league: 'League A', date: '2026-09-24 20:45', home: 'Norway', away: 'Denmark', homeFlag: '🇳🇴', awayFlag: '🇩🇰', locked: false, played: false },
	{ id: '2048006', league: 'League B', date: '2026-09-24 20:45', home: 'Austria', away: 'Israel', homeFlag: '🇦🇹', awayFlag: '🇮🇱', locked: false, played: false },
	{ id: '2048007', league: 'League B', date: '2026-09-24 20:45', home: 'Kosovo', away: 'Republic of Ireland', homeFlag: '🇽🇰', awayFlag: '🇮🇪', locked: false, played: false },
	{ id: '2048008', league: 'League D', date: '2026-09-24 20:45', home: 'Liechtenstein', away: 'Lithuania', homeFlag: '🇱🇮', awayFlag: '🇱🇹', locked: false, played: false },
	{ id: '2048009', league: 'League D', date: '2026-09-24 20:45', home: 'Andorra', away: 'Malta', homeFlag: '🇦🇩', awayFlag: '🇲🇹', locked: false, played: false },
	{ id: '2048010', league: 'League A', date: '2026-09-25 20:45', home: 'Italy', away: 'Belgium', homeFlag: '🇮🇹', awayFlag: '🇧🇪', locked: false, played: false },
	{ id: '2048011', league: 'League A', date: '2026-09-25 20:45', home: 'Türkiye', away: 'France', homeFlag: '🇹🇷', awayFlag: '🇫🇷', locked: false, played: false },
	{ id: '2048014', league: 'League B', date: '2026-09-25 18:00', home: 'Georgia', away: 'Northern Ireland', homeFlag: '🇬🇪', awayFlag: '🇬🇧', locked: false, played: false },
	{ id: '2048018', league: 'League A', date: '2026-09-26 20:45', home: 'England', away: 'Spain', homeFlag: '🏴', awayFlag: '🇪🇸', locked: false, played: false },
	{ id: '2048022', league: 'League B', date: '2026-09-26 20:45', home: 'North Macedonia', away: 'Switzerland', homeFlag: '🇲🇰', awayFlag: '🇨🇭', locked: false, played: false },
	{ id: '2048023', league: 'League A', date: '2026-09-26 20:45', home: 'Czechia', away: 'Croatia', homeFlag: '🇨🇿', awayFlag: '🇭🇷', locked: false, played: false }
];

// Try to load fixtures from localStorage if the admin imported them
function getMatches() {
	try {
		const stored = localStorage.getItem('nl_fixtures');
		if (stored) {
			const parsed = JSON.parse(stored);
			// ensure flags are present
			return parsed.map(m => ({ ...m, homeFlag: m.homeFlag || countryFlag(m.home), awayFlag: m.awayFlag || countryFlag(m.away) }));
		}
	} catch (e) { console.warn('Invalid fixtures in storage', e); }
	return mockMatches.map(m => ({ ...m, homeFlag: m.homeFlag || countryFlag(m.home), awayFlag: m.awayFlag || countryFlag(m.away) }));
}

// Localize country/team display names to Dutch
function localizeCountry(name) {
	if (!name) return '';
	const map = {
		'Netherlands':'Nederland',
		'England':'Engeland',
		'Scotland':'Schotland',
		'Northern Ireland':'Noord-Ierland',
		'Republic of Ireland':'Ierland',
		'North Macedonia':'Noord-Macedonië',
		'Czechia':'Tsjechië',
		'Bosnia':'Bosnië',
		'Faroe Islands':'Faeröer',
		'San Marino':'San Marino',
		'Turkey':'Turkije',
		'Türkiye':'Turkije',
		'Germany':'Duitsland',
		'Spain':'Spanje',
		'Portugal':'Portugal',
		'Wales':'Wales',
		'Italy':'Italië',
		'Belgium':'België',
		'Sweden':'Zweden',
		'Romania':'Roemenië',
		'Slovakia':'Slowakije',
		'Moldova':'Moldavië',
		'North Macedonia':'Noord-Macedonië'
	};
	return map[name] || name;
}

// If fixtures loaded from server have missing dates, fetch `fixtures.json` from public and update storage
function ensureFixturesHaveDates() {
	try {
		const stored = JSON.parse(localStorage.getItem('nl_fixtures') || '[]');
		const missing = stored.some(m => !m.datetime && !m.date);
		if (!missing) return;
	} catch (e) { /* continue to fetch */ }
	// fetch public fixtures.json and merge
	fetch('fixtures.json', {cache: 'no-store'}).then(r => {
		if (!r.ok) return;
		return r.json();
	}).then(serverFixtures => {
		if (!Array.isArray(serverFixtures)) return;
		const local = JSON.parse(localStorage.getItem('nl_fixtures') || '[]');
		const map = {};
		local.forEach(m => { if (m && m.id) map[m.id] = m; });
		serverFixtures.forEach(m => { if (m && m.id) map[m.id] = { ...map[m.id], ...m }; });
		const merged = Object.values(map).length ? Object.values(map) : serverFixtures;
		localStorage.setItem('nl_fixtures', JSON.stringify(merged));
		try { navigateTo('matches'); } catch (e) {}
	}).catch(() => {});
}

	function formatMatchDate(dateStr) {
		if (!dateStr) return 'Datum onbekend';
		try {
			let d;
			if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(dateStr)) d = new Date(dateStr.replace(' ', 'T'));
			else d = new Date(dateStr);
			if (isNaN(d.getTime())) return 'Datum onbekend';
			const day = String(d.getDate()).padStart(2, '0');
			const monthNames = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];
			const mon = monthNames[d.getMonth()] || '';
			const hh = String(d.getHours()).padStart(2, '0');
			const mm = String(d.getMinutes()).padStart(2, '0');
			return `${day} ${mon} ${hh}:${mm}`;
		} catch (e) { return 'Datum onbekend'; }
	}

function renderDashboard(container) {
	const wrap = document.createElement('div');
	wrap.className = 'dashboard';

	const stats = document.createElement('div');
	stats.className = 'stats-grid';
	stats.innerHTML = `
		<div class="stat-card"><div class="stat-value">${countPredictions()}</div><div class="stat-label">Voorspellingen</div></div>
		<div class="stat-card"><div class="stat-value">${calculatePoints()}</div><div class="stat-label">Punten</div></div>
		<div class="stat-card"><div class="stat-value">${Object.keys(predictions).length ? Object.keys(predictions).length : 0}</div><div class="stat-label">Vriendengroepen</div></div>
		<div class="stat-card"><div class="stat-value">1</div><div class="stat-label">Positie</div></div>
	`;

	wrap.appendChild(stats);

	const upcoming = document.createElement('div');
	upcoming.className = 'section';
	upcoming.innerHTML = '<h2>Komende wedstrijden</h2>';

	const matches = getMatches();
	// Ensure fixtures have dates loaded asynchronously if missing
	ensureFixturesHaveDates();

	for (const m of matches) {
		const card = document.createElement('div');
		card.className = 'match-card ' + (predictions[m.id] ? 'predicted' : '');
		const meta = document.createElement('div');
		meta.className = 'match-meta';
		meta.innerHTML = `<div class="match-league">${m.league}</div><div class="match-date">${formatMatchDate(m.date || m.datetime)}</div>`;

		const content = document.createElement('div');
		content.className = 'match-content';
		content.innerHTML = `
			<div class="team home-team"><div class="team-flag">${m.homeFlag}</div><div class="team-name">${localizeCountry(m.home)}</div></div>
			<div class="match-center"><div class="vs-text">VS</div><div class="pred-indicator">${predictions[m.id] ? `<span class="pred-score-sm">${predictions[m.id].home}-${predictions[m.id].away}</span>` : '<span class="pred-score-sm">Voorspel</span>'}</div></div>
			<div class="team away-team"><div class="team-name">${localizeCountry(m.away)}</div><div class="team-flag">${m.awayFlag}</div></div>
		`;

		card.appendChild(meta);
		card.appendChild(content);
		card.onclick = () => openPredictionModal(m);
		upcoming.appendChild(card);
	}

	wrap.appendChild(upcoming);
	container.appendChild(wrap);
}

function renderMatches(container) {
	const view = document.createElement('div');
	view.className = 'matches-view';
	view.innerHTML = '<h2>Alle wedstrijden</h2>';

	const matches = getMatches();
	// ensure dates present when rendering; will fetch from public/fixtures.json if needed
	ensureFixturesHaveDates();
	matches.forEach(m => {
		const card = document.createElement('div');
		card.className = 'match-card ' + (predictions[m.id] ? 'predicted' : '');
		card.innerHTML = `
			<div class="match-meta"><div class="match-league">${m.league}</div><div class="match-date">${formatMatchDate(m.date || m.datetime)}</div></div>
			<div class="match-content">
				<div class="team home-team"><div class="team-flag">${m.homeFlag}</div><div class="team-name">${localizeCountry(m.home)}</div></div>
				<div class="match-center"><div class="score-value">${predictions[m.id] ? predictions[m.id].home + ' - ' + predictions[m.id].away : '—'}</div><div class="vs-text">VS</div></div>
				<div class="team away-team"><div class="team-name">${localizeCountry(m.away)}</div><div class="team-flag">${m.awayFlag}</div></div>
			</div>
		`;
		card.onclick = () => openPredictionModal(m);
		// actions footer
		const foot = document.createElement('div');
		foot.style.marginTop = '8px';
		const btnPoints = document.createElement('button');
		btnPoints.className = 'btn btn-secondary btn-sm';
		btnPoints.textContent = 'Punten';
		btnPoints.onclick = (e) => { e.stopPropagation(); showMatchPointsBreakdown(m.id); };
		foot.appendChild(btnPoints);
		if (currentUser && currentUser.isAdmin) {
			const btnResult = document.createElement('button');
			btnResult.className = 'btn btn-primary btn-sm';
			btnResult.style.marginLeft = '8px';
			btnResult.textContent = 'Voer resultaat in';
			btnResult.onclick = (e) => { e.stopPropagation(); openResultModal(m); };
			foot.appendChild(btnResult);
		}
		card.appendChild(foot);
		view.appendChild(card);
	});

	container.appendChild(view);
}

function openResultModal(match) {
	const modalHtml = `
		<div class="modal-overlay" id="result-modal">
			<div class="modal-content">
				<div class="modal-header"><h3>Resultaat invoeren: ${match.home} — ${match.away}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
				<div class="modal-body">
							<div style="display:flex;gap:10px;align-items:center"><div>${localizeCountry(match.home)}</div><input id="res-home-${match.id}" type="number" min="0" style="width:80px;padding:6px;border-radius:6px;border:1px solid var(--border)" value="${match.homeScore || ''}"></div>
							<div style="margin:8px 0;display:flex;gap:10px;align-items:center"><div>${localizeCountry(match.away)}</div><input id="res-away-${match.id}" type="number" min="0" style="width:80px;padding:6px;border-radius:6px;border:1px solid var(--border)" value="${match.awayScore || ''}"></div>
				</div>
				<div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Annuleer</button><button class="btn btn-primary" onclick="saveMatchResultFromModal('${match.id}')">Opslaan resultaat</button></div>
			</div>
		</div>
	`;
	document.getElementById('modal-container').innerHTML = modalHtml;
}

async function saveMatchResultFromModal(matchId) {
	const hEl = document.getElementById(`res-home-${matchId}`);
	const aEl = document.getElementById(`res-away-${matchId}`);
	if (!hEl || !aEl) return showToast('Resultaatvelden niet gevonden', 'error');
	const h = Number(hEl.value);
	const a = Number(aEl.value);
	if (isNaN(h) || isNaN(a)) return showToast('Voer geldige scores in', 'error');
	try {
		await persistMatchResult(matchId, h, a);
		closeModal();
		showToast('Resultaat opgeslagen', 'success');
		navigateTo('matches');
	} catch (e) {
		console.warn('Failed to persist match result', e);
		showToast('Opslaan mislukt: ' + e.message, 'error');
	}
}

async function persistMatchResult(matchId, homeScore, awayScore) {
	// update local fixtures
	try {
		const fixtures = JSON.parse(localStorage.getItem('nl_fixtures') || '[]');
		const idx = fixtures.findIndex(f => f.id === matchId);
		if (idx !== -1) {
			fixtures[idx].homeScore = homeScore;
			fixtures[idx].awayScore = awayScore;
			fixtures[idx].played = true;
			localStorage.setItem('nl_fixtures', JSON.stringify(fixtures));
		}
	} catch (e) { console.warn('Failed to update local fixtures', e); }

	// persist to Firestore if available and admin
	if (useFirebase && currentUser && currentUser.isAdmin) {
		const docRef = db.collection('matches').doc(matchId);
		const payload = { homeScore, awayScore, played: true };
		// also keep date if existing
		return docRef.set(payload, { merge: true });
	}
}

function showMatchPointsBreakdown(matchId) {
	const matches = getMatches().slice();
	matches.sort((a,b) => new Date(a.date) - new Date(b.date));
	const idx = matches.findIndex(m => m.id === matchId);
	if (idx === -1) return showToast('Wedstrijd niet gevonden', 'error');
	const prevMatchId = idx > 0 ? matches[idx-1].id : null;

	// collect users from local member predictions and include currentUser
	const allPreds = JSON.parse(localStorage.getItem('nl_member_predictions') || '{}');
	const userIds = new Set(Object.keys(allPreds));
	if (currentUser && currentUser.id) userIds.add(currentUser.id);

	let rowsHtml = '<div style="max-height:60vh;overflow:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>Gebruiker</th><th>Voorspelling</th><th>Punten (deze match)</th><th>Totaal</th></tr></thead><tbody>';
	for (const uid of Array.from(userIds)) {
		const upToPrev = computeUserPointsUpToMatch(uid, prevMatchId);
		const upToThis = computeUserPointsUpToMatch(uid, matchId);
		const thisPoints = upToThis.total - (upToPrev ? upToPrev.total : 0);
		// prediction for this match
		const preds = JSON.parse(localStorage.getItem('nl_member_predictions') || '{}');
		const userPred = (preds[uid] && preds[uid][matchId]) || (predictions[matchId] && uid === (currentUser && currentUser.id) ? predictions[matchId] : null);
		const predText = userPred ? `${userPred.home}-${userPred.away}` : '—';
		const display = (uid === (currentUser && currentUser.id)) ? (currentUser.name || uid) : uid;
		rowsHtml += `<tr style="border-top:1px solid var(--border)"><td style="padding:8px">${display}</td><td style="padding:8px">${predText}</td><td style="padding:8px">${thisPoints}</td><td style="padding:8px">${upToThis.total}</td></tr>`;
	}
	rowsHtml += '</tbody></table></div>';

	const modalHtml = `
		<div class="modal-overlay">
			<div class="modal-content">
				<div class="modal-header"><h3>Punten — wedstrijd</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
				<div class="modal-body">${rowsHtml}</div>
				<div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Sluit</button></div>
			</div>
		</div>
	`;
	document.getElementById('modal-container').innerHTML = modalHtml;
}

function computeUserPointsUpToMatch(userId, matchId, groupId) {
	// similar to computeUserPoints but stops at matchId (inclusive)
	const matches = getMatches().slice();
	matches.sort((a,b) => new Date(a.date) - new Date(b.date));

	const userPredsAll = JSON.parse(localStorage.getItem('nl_member_predictions') || '{}');
	const userPreds = userPredsAll[userId] ? Object.assign({}, userPredsAll[userId]) : {};
	if (userId === (currentUser && currentUser.id)) Object.assign(userPreds, predictions);

	let total = 0;
	let consecutiveExact = 0;
	let bonusNext = false;

	for (const m of matches) {
		const final = getMatchFinalScore(m);
		const pred = userPreds[m.id];
		if (!final.played || final.home == null || final.away == null) {
			if (m.id === matchId) break;
			continue;
		}

		if (!pred) {
			consecutiveExact = 0;
			if (m.id === matchId) break;
			continue;
		}

		let pointsThis = 0;
		if (pred) pointsThis += 1; // submit point
		const predHome = Number(pred.home);
		const predAway = Number(pred.away);
		if (!isNaN(predHome) && !isNaN(predAway)) {
			if (predHome === final.home && predAway === final.away) {
				pointsThis += 3;
				consecutiveExact += 1;
				if (consecutiveExact >= 3) bonusNext = true;
			} else {
				const predOutcome = outcomeFromScore(predHome, predAway);
				const actualOutcome = outcomeFromScore(final.home, final.away);
				if (predOutcome && actualOutcome && predOutcome === actualOutcome) {
					pointsThis += 1;
				}
				consecutiveExact = 0;
			}
		}

		// apply red-card halving if applicable for this group
		if (groupId) {
			const rc = getRedCardsForGroup(groupId);
			const hasRC = rc && rc[m.id] && rc[m.id][userId] && rc[m.id][userId].length;
			if (hasRC) {
				// halve only the non-submit part
				const submitPart = 1;
				const nonSubmit = pointsThis - submitPart;
				const halved = Math.floor(nonSubmit / 2);
				pointsThis = submitPart + halved;
			}
		}

		if (bonusNext) {
			pointsThis = pointsThis * 2;
			bonusNext = false;
			consecutiveExact = 0;
		}

		total += pointsThis;
		if (m.id === matchId) break;
	}
	return { total };
}

// Admin: import fixtures JSON (paste) and reset
function renderAdmin(container) {
	const view = document.createElement('div');
	view.className = 'admin-view';
	view.innerHTML = `
		<h2>Admin - Fixtures import</h2>
		<div class="admin-section">
			<p>Plak hier een JSON-array met wedstrijden (veld: id, league, date, home, away). Je kunt ook homeFlag/awayFlag toevoegen.</p>
			<textarea id="fixtures-json" placeholder='[ { "id": "2048002", "league": "League A", "date": "2026-09-24 20:45", "home": "Portugal", "away": "Wales" } ]' style="width:100%;height:140px;padding:10px;border-radius:8px;border:1px solid var(--border)"></textarea>
			<div style="display:flex;gap:10px;margin-top:10px;"><button class="btn btn-primary" onclick="importFixturesFromTextarea()">Laad fixtures</button><button class="btn btn-secondary" onclick="resetFixtures()">Reset naar voorbeeld</button></div>
			<p style="margin-top:10px;color:var(--text-secondary)">Na het laden vernieuwt de lijst automatisch.</p>
		</div>
	`;
	container.appendChild(view);
}

function importFixturesFromTextarea() {
	const t = document.getElementById('fixtures-json').value;
	if (!t) { showToast('Plak JSON in het veld', 'error'); return; }
	try {
		const arr = JSON.parse(t);
		if (!Array.isArray(arr)) throw new Error('Expect array');
		localStorage.setItem('nl_fixtures', JSON.stringify(arr));
		showToast('Fixtures geladen', 'success');
		// If admin and Firebase available, persist matches to Firestore
		if (useFirebase && currentUser && currentUser.isAdmin) {
			const batch = db.batch();
			arr.forEach(m => {
				const docRef = db.collection('matches').doc(m.id);
				// convert date to timestamp if possible
				const d = parseMatchDate(m.date);
				const payload = { id: m.id, league: m.league, date: firebase.firestore.Timestamp.fromDate(d), home: m.home, away: m.away, homeFlag: m.homeFlag || null, awayFlag: m.awayFlag || null };
				batch.set(docRef, payload);
			});
			batch.commit().then(() => { showToast('Fixtures naar Firestore weggeschreven', 'success'); navigateTo('matches'); }).catch(e => { console.warn('Failed to write matches to Firestore', e); navigateTo('matches'); });
		} else {
			navigateTo('matches');
		}
	} catch (e) {
		showToast('Ongeldige JSON: ' + e.message, 'error');
	}
}

function resetFixtures() {
	localStorage.removeItem('nl_fixtures');
	showToast('Fixtures gereset', 'success');
	navigateTo('matches');
}

// Country name -> emoji flag mapping for common teams
function countryFlag(name) {
	// prefer image flags via country codes; fallback to emoji map
	const codes = {
		'Portugal':'pt','Wales':'gb-wls','Netherlands':'nl','Germany':'de','Serbia':'rs','Greece':'gr','Norway':'no','Denmark':'dk','Austria':'at','Israel':'il','Kosovo':'xk','Republic of Ireland':'ie','Liechtenstein':'li','Lithuania':'lt','Andorra':'ad','Malta':'mt','Italy':'it','Belgium':'be','Türkiye':'tr','Turkey':'tr','France':'fr','Georgia':'ge','Northern Ireland':'gb-nir','England':'gb-eng','Spain':'es','North Macedonia':'mk','Switzerland':'ch','Czechia':'cz','Croatia':'hr','Poland':'pl','Sweden':'se','Romania':'ro','Hungary':'hu','Ukraine':'ua','Scotland':'gb-sct','Slovenia':'si','Iceland':'is','Estonia':'ee','Finland':'fi','San Marino':'sm','Albania':'al','Belarus':'by','Slovakia':'sk','Moldova':'md','Bulgaria':'bg','Luxembourg':'lu','Faroe Islands':'fo','Kazakhstan':'kz','Armenia':'am','Latvia':'lv','Montenegro':'me','Cyprus':'cy','Gibraltar':'gi','Azerbaijan':'az','Bosnia':'ba','Bosnia and Herzegovina':'ba'
	};
	const emoji = {
		'Portugal':'🇵🇹','Wales':'🏴','Netherlands':'🇳🇱','Germany':'🇩🇪','Serbia':'🇷🇸','Greece':'🇬🇷','Norway':'🇳🇴','Denmark':'🇩🇰','Austria':'🇦🇹','Israel':'🇮🇱','Kosovo':'🇽🇰','Republic of Ireland':'🇮🇪','Liechtenstein':'🇱🇮','Lithuania':'🇱🇹','Andorra':'🇦🇩','Malta':'🇲🇹','Italy':'🇮🇹','Belgium':'🇧🇪','Türkiye':'🇹🇷','France':'🇫🇷','Georgia':'🇬🇪','Northern Ireland':'🇬🇧','England':'🏴','Spain':'🇪🇸','North Macedonia':'🇲🇰','Switzerland':'🇨🇭','Czechia':'🇨🇿','Croatia':'🇭🇷','Poland':'🇵🇱','Sweden':'🇸🇪','Romania':'🇷🇴','Hungary':'🇭🇺','Ukraine':'🇺🇦','Scotland':'🏴','Slovenia':'🇸🇮','Iceland':'🇮🇸','Estonia':'🇪🇪','Finland':'🇫🇮','San Marino':'🇸🇲','Albania':'🇦🇱','Belarus':'🇧🇾','Slovakia':'🇸🇰','Moldova':'🇲🇩','Bulgaria':'🇧🇬','Luxembourg':'🇱🇺','Faroe Islands':'🇫🇴','Kazakhstan':'🇰🇿','Armenia':'🇦🇲','Latvia':'🇱🇻','Montenegro':'🇲🇪','Cyprus':'🇨🇾','Gibraltar':'🇬🇮','Azerbaijan':'🇦🇿','Bosnia':'🇧🇦','Bosnia and Herzegovina':'🇧🇦'
	};
	const key = name.trim();
	const code = codes[key];
	if (code) {
		const url = `https://flagcdn.com/w40/${code.toLowerCase()}.png`;
		return `<img src="${url}" alt="${key} flag" class="flag-img"/>`;
	}
	return emoji[key] || '🏳️';
}

function renderLeaderboard(container) {
	const view = document.createElement('div');
	view.className = 'leaderboard-view';
	view.innerHTML = `
		<div class="leaderboard-header"><h2>Klassement</h2><p>Demo-klassement op basis van voorspellingen</p></div>
		<div class="leaderboard-list"></div>
	`;

	const list = view.querySelector('.leaderboard-list');
	const rows = [
		{ name: (currentUser && currentUser.name) || 'Jij', points: calculatePoints() },
		{ name: 'Jan', points: Math.max(0, calculatePoints() - 1) },
		{ name: 'Lisa', points: Math.max(0, calculatePoints() - 2) }
	];

	rows.forEach((r, i) => {
		const row = document.createElement('div');
		row.className = 'leaderboard-row ' + (r.name === (currentUser.name || 'Jij') ? 'current-user' : '');
		row.innerHTML = `
			<div class="rank-badge">${i+1}</div>
			<div class="player-info"><div class="player-name">${r.name}</div><div class="player-stats">${r.points} pts</div></div>
			<div class="points-value">${r.points}</div>
		`;
		list.appendChild(row);
	});

	container.appendChild(view);
}

function renderGroups(container) {
	const view = document.createElement('div');
	view.className = 'groups-view';
	view.innerHTML = `
		<div class="groups-header"><h2>Vriendengroepen</h2></div>
		<div class="group-actions">
			<button class="btn btn-primary" onclick="createGroup()">Nieuwe groep</button>
			<button class="btn btn-secondary" onclick="joinGroup()">Join groep</button>
		</div>
	`;
	// list existing groups
	const groups = JSON.parse(localStorage.getItem('nl_groups') || '[]');
	if (!groups.length) {
		const empty = document.createElement('div');
		empty.className = 'empty-groups';
		empty.innerHTML = '<div class="empty-icon">👥</div><div>Geen groepen yet — maak er één.</div>';
		view.appendChild(empty);
	} else {
		groups.forEach(g => {
			const card = document.createElement('div');
			card.className = 'group-card';
			const isMember = currentUser && g.members && g.members.find(m => m.id === currentUser.id);
			card.innerHTML = `
				<div style="display:flex;justify-content:space-between;align-items:center"><div><strong>${g.name}</strong><div style="font-size:0.85rem;color:var(--text-secondary)">Code: ${g.code}</div></div><div>${isMember ? '<span style="font-weight:700;color:var(--primary)">Lid</span>' : ''}</div></div>
			`;
			const actions = document.createElement('div');
			actions.style.marginTop = '8px';
			const viewBtn = document.createElement('button');
			viewBtn.className = 'btn btn-secondary btn-sm';
			viewBtn.textContent = 'Bekijk klassement';
			viewBtn.onclick = () => {
				// render leaderboard in a modal-like area
				const modal = document.getElementById('modal-container');
				modal.innerHTML = '';
				const box = document.createElement('div');
				box.className = 'modal-overlay';
				box.innerHTML = `<div class="modal-content"><div class="modal-header"><h3>Klassement: ${g.name}</h3><button class="modal-close" onclick="document.getElementById('modal-container').innerHTML=''">✕</button></div><div class="modal-body" id="group-leaderboard-body"></div><div class="modal-footer"><button class="btn btn-secondary" onclick="document.getElementById('modal-container').innerHTML=''">Sluit</button></div></div>`;
				modal.appendChild(box);
				const body = document.getElementById('group-leaderboard-body');
				renderGroupLeaderboard(body, g);
			};
			const copyBtn = document.createElement('button');
			copyBtn.className = 'btn btn-primary btn-sm';
			copyBtn.textContent = 'Kopieer code';
			copyBtn.onclick = () => { navigator.clipboard.writeText(g.code); showToast('Code gekopieerd'); };
			actions.appendChild(viewBtn);
			actions.appendChild(copyBtn);
			card.appendChild(actions);
			view.appendChild(card);
		});
	}
	container.appendChild(view);
}

function renderProfile(container) {
	const view = document.createElement('div');
	view.className = 'profile-view';
	view.innerHTML = `
		<div class="profile-header">
			<div class="profile-avatar">${(currentUser.name || 'U').charAt(0).toUpperCase()}</div>
			<h2>${currentUser.name || 'Demo'}</h2>
			<p>${currentUser.email || ''}</p>
		</div>
		<div class="profile-stats">
			<div class="stat-row"><div class="stat-name">Voorspellingen</div><div class="stat-val">${countPredictions()}</div></div>
			<div class="stat-row"><div class="stat-name">Punten</div><div class="stat-val">${calculatePoints()}</div></div>
		</div>
		<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
			<button class="btn btn-primary" onclick="openProfileEditor((currentUser&&currentUser.id)?currentUser.id:'')">Bewerk naam</button>
			<button class="btn btn-secondary" onclick="loadFixturesFromServer()">Herlaad wedstrijden</button>
			<button class="btn btn-secondary" onclick="resetFixtures()">Reset wedstrijden</button>
		</div>
	`;
	container.appendChild(view);
}

function renderAdmin(container) {
	const view = document.createElement('div');
	view.className = 'admin-view';
	view.innerHTML = `
		<h2>Admin - Fixtures import & Live tracking</h2>
		<div class="admin-section">
			<p>Plak hier een JSON-array met wedstrijden (veld: id, league, date, home, away). Je kunt ook homeFlag/awayFlag toevoegen.</p>
			<textarea id="fixtures-json" placeholder='[ { "id": "2048002", "league": "League A", "date": "2026-09-24 20:45", "home": "Portugal", "away": "Wales" } ]' style="width:100%;height:140px;padding:10px;border-radius:8px;border:1px solid var(--border)"></textarea>
			<div style="display:flex;gap:10px;margin-top:10px;"><button class="btn btn-primary" onclick="importFixturesFromTextarea()">Laad fixtures</button><button class="btn btn-secondary" onclick="resetFixtures()">Reset naar voorbeeld</button></div>
			<p style="margin-top:10px;color:var(--text-secondary)">Na het laden vernieuwt de lijst automatisch.</p>
		</div>
		<div class="admin-section" style="margin-top:18px">
			<h3>Live score tracking</h3>
			<p>Voer hier een JSON-endpoint in dat een array met wedstrijden retourneert (velden: id, homeScore, awayScore, played). De app pollt dit endpoint en werkt scores bij in de app en (indien admin + Firebase) in Firestore.</p>
			<div style="display:flex;gap:8px;align-items:center">
				<input id="live-feed-url" placeholder="https://example.com/live_scores.json" style="flex:1;padding:8px;border-radius:6px;border:1px solid var(--border)">
				<input id="live-feed-interval" placeholder="poll ms (default 15000)" style="width:160px;padding:8px;border-radius:6px;border:1px solid var(--border);margin-left:8px">
			</div>
			<div style="margin-top:8px;display:flex;gap:8px">
				<button class="btn btn-primary" onclick="startLiveFromAdmin()">Start live tracking</button>
				<button class="btn btn-secondary" onclick="stopLiveTracking()">Stop live tracking</button>
			</div>
			<p id="live-status" style="margin-top:8px;color:var(--text-secondary)">Status: uit</p>
		</div>
	`;
	container.appendChild(view);
}

// Live tracking helpers (client side polling)
window._liveFeedUrl = null;
window._liveFeedInterval = null;
window._liveFeedTimer = null;

function setLiveStatus(text) {
	const el = document.getElementById('live-status');
	if (el) el.textContent = 'Status: ' + text;
}

async function processLiveFeedData(data) {
	if (!Array.isArray(data)) return;
	const matches = getMatches();
	const byId = {};
	matches.forEach(m => { if (m && m.id) byId[m.id] = m; });

	for (const m of data) {
		if (!m.id) continue;
		const local = byId[m.id];
		const h = (typeof m.homeScore !== 'undefined') ? Number(m.homeScore) : null;
		const a = (typeof m.awayScore !== 'undefined') ? Number(m.awayScore) : null;
		const played = typeof m.played !== 'undefined' ? !!m.played : (h !== null && a !== null);
		if (!local) continue;
		const localH = typeof local.homeScore !== 'undefined' ? Number(local.homeScore) : null;
		const localA = typeof local.awayScore !== 'undefined' ? Number(local.awayScore) : null;
		if ((h !== null && a !== null) && (localH !== h || localA !== a || local.played !== played)) {
			try {
				await persistMatchResult(m.id, h, a);
				showToast(`Live: resultaat bijgewerkt voor ${local.home} - ${local.away}`, 'success');
			} catch (e) { console.warn('Failed to persist live result', e); }
		}
	}
}

async function _livePollOnce() {
	if (!window._liveFeedUrl) return;
	try {
		const resp = await fetch(window._liveFeedUrl, { cache: 'no-store' });
		if (!resp.ok) { setLiveStatus('fout bij ophalen'); return; }
		const json = await resp.json();
		await processLiveFeedData(json);
		setLiveStatus('actief');
	} catch (e) { console.warn('Live poll failed', e); setLiveStatus('fout'); }
}

function startLiveTracking(url, intervalMs = 15000) {
	if (!url) return showToast('Voer een live feed URL in', 'error');
	window._liveFeedUrl = url;
	window._liveFeedInterval = Math.max(1000, Number(intervalMs) || 15000);
	_livePollOnce();
	if (window._liveFeedTimer) clearInterval(window._liveFeedTimer);
	window._liveFeedTimer = setInterval(_livePollOnce, window._liveFeedInterval);
	setLiveStatus('actief');
}

function stopLiveTracking() {
	if (window._liveFeedTimer) { clearInterval(window._liveFeedTimer); window._liveFeedTimer = null; }
	window._liveFeedUrl = null;
	window._liveFeedInterval = null;
	setLiveStatus('uit');
}

function startLiveFromAdmin() {
	const url = document.getElementById('live-feed-url').value.trim();
	const iv = document.getElementById('live-feed-interval').value.trim();
	startLiveTracking(url, Number(iv) || 15000);
}

function countPredictions() {
	return Object.keys(predictions).length;
}

function calculatePoints() {
	if (!currentUser || !currentUser.id) return 0;
	return computeUserPoints(currentUser.id).total;
}

// Determine match final score if available. Supports multiple field names.
function getMatchFinalScore(match) {
	if (!match) return { played: false };
	// common fields: match.homeScore/match.awayScore or match.scoreHome/scoreAway or match.homeGoals/awayGoals
	const candidates = [
		['homeScore', 'awayScore'],
		['scoreHome', 'scoreAway'],
		['homeGoals', 'awayGoals'],
		['finalHome', 'finalAway'],
		['home', 'away']
	];
	for (const [hKey, aKey] of candidates) {
		if (hKey in match && aKey in match && typeof match[hKey] !== 'undefined' && typeof match[aKey] !== 'undefined') {
			const h = Number(match[hKey]);
			const a = Number(match[aKey]);
			if (!isNaN(h) && !isNaN(a)) return { played: true, home: h, away: a };
		}
	}
	// fallback: if match.played === true but no scores, consider played false for scoring purposes
	return { played: !!match.played && (match.played === true), home: null, away: null };
}

function outcomeFromScore(home, away) {
	if (home == null || away == null) return null;
	if (home === away) return 'draw';
	return home > away ? 'home' : 'away';
}

// Compute points for a single user across all matches (chronological by match.date)
function computeUserPoints(userId) {
	const matches = getMatches().slice();
	// parse and sort by date
	matches.sort((a,b) => {
		const da = new Date(a.date);
		const db = new Date(b.date);
		return da - db;
	});

	const userPredsAll = JSON.parse(localStorage.getItem('nl_member_predictions') || '{}');
	const userPreds = userPredsAll[userId] || {};
	// also include top-level predictions object for current user
	if (userId === (currentUser && currentUser.id)) {
		Object.assign(userPreds, predictions);
	}

	let total = 0;
	let consecutiveExact = 0;
	let bonusNext = false; // set when user hits 3 exacts in a row
	let exactCount = 0;

	for (const m of matches) {
		const final = getMatchFinalScore(m);
		const pred = userPreds[m.id];
		// only score if match is marked as played and has final numeric scores
		if (!final.played || final.home == null || final.away == null) continue;

		if (!pred) {
			// missed prediction resets exact streak
			consecutiveExact = 0;
			if (bonusNext) {
				// bonus still awaits next match with a prediction; if skipped, bonus is consumed? We'll consider bonus consumed only when applied to a match with a prediction
			}
			continue;
		}

		const submitted = true; // since pred exists and match played
		let pointsThis = 0;
		// submit point
		if (submitted) pointsThis += 1;

		const predHome = Number(pred.home);
		const predAway = Number(pred.away);
		if (!isNaN(predHome) && !isNaN(predAway)) {
			if (predHome === final.home && predAway === final.away) {
				// exact
				pointsThis += 3;
				consecutiveExact += 1;
				exactCount += 1;
				if (consecutiveExact >= 3) {
					// award bonus for next match
					bonusNext = true;
				}
			} else {
				// check outcome
				const predOutcome = outcomeFromScore(predHome, predAway);
				const actualOutcome = outcomeFromScore(final.home, final.away);
				if (predOutcome && actualOutcome && predOutcome === actualOutcome) {
					pointsThis += 1;
				}
				consecutiveExact = 0;
			}
		}

		// apply bonus if active for this match
		if (bonusNext) {
			pointsThis = pointsThis * 2;
			bonusNext = false; // consume
			consecutiveExact = 0; // reset streak after bonus applies
		}

		total += pointsThis;
	}

	return { total, exactCount };
}

// Modal helpers
function openPredictionModal(match) {
	// store active match for savePrediction to validate cutoff
	window._activeMatchForPrediction = match;
	const modalHtml = `
		<div class="modal-overlay" id="pred-modal">
			<div class="modal-content">
				<div class="modal-header"><h3>Voorspel: ${localizeCountry(match.home)} — ${localizeCountry(match.away)}</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
				<div class="modal-body">
					<div class="modal-match">
						<div class="modal-team"><div class="modal-flag">${match.homeFlag}</div><div class="modal-team-name">${localizeCountry(match.home)}</div></div>
						<div class="modal-score-input"><input type="number" id="pred-home" class="score-input-lg" value="${predictions[match.id] ? predictions[match.id].home : ''}" min="0"> <div class="dash">-</div> <input type="number" id="pred-away" class="score-input-lg" value="${predictions[match.id] ? predictions[match.id].away : ''}" min="0"></div>
						<div class="modal-team"><div class="modal-flag">${match.awayFlag}</div><div class="modal-team-name">${localizeCountry(match.away)}</div></div>
					</div>
					<div class="scoring-info"><div class="scoring-item"><strong>3</strong>Exact</div><div class="scoring-item"><strong>1</strong>Uitkomst</div><div class="scoring-item"><strong>0</strong>Fout</div></div>
				</div>
				<div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Annuleer</button><button class="btn btn-primary" onclick="savePrediction('${match.id}')">Opslaan</button></div>
			</div>
		</div>
	`;
	document.getElementById('modal-container').innerHTML = modalHtml;
}

function closeModal() {
	document.getElementById('modal-container').innerHTML = '';
}

// MEMBER PREDICTIONS: store predictions per user so group leaderboards can aggregate
function saveMemberPrediction(userId, matchId, home, away) {
	try {
		const all = JSON.parse(localStorage.getItem('nl_member_predictions') || '{}');
		all[userId] = all[userId] || {};
		all[userId][matchId] = { home: String(home), away: String(away) };
		localStorage.setItem('nl_member_predictions', JSON.stringify(all));
		// Persist to Firestore if available and it's the current user
		if (useFirebase && currentUser && currentUser.id === userId) {
			const docId = `${userId}_${matchId}`;
			db.collection('predictions').doc(docId).set({ userId, matchId, home: String(home), away: String(away), updatedAt: Date.now() })
				.catch(e => console.warn('Failed to persist prediction', e));
		}
	} catch (e) { console.warn('Failed to save member prediction', e); }
}

function savePrediction(matchId) {
	const h = document.getElementById('pred-home').value;
	const a = document.getElementById('pred-away').value;
	if (h === '' || a === '') { showToast('Vul beide scores in', 'error'); return; }
	// Check cutoff: predictions must be made at least 1 hour before match start
	const match = window._activeMatchForPrediction || null;
	if (match) {
		const matchDate = parseMatchDate(match.date);
		const cutoff = new Date(matchDate.getTime() - 60 * 60 * 1000);
		if (Date.now() > cutoff.getTime()) {
			showToast('Voorspellingen sluiten 1 uur voor de match', 'error');
			closeModal();
			return;
		}
	}
	predictions[matchId] = { home: String(h), away: String(a), userId: currentUser && currentUser.id ? currentUser.id : 'demo-user' };
	localStorage.setItem('nl_predictions', JSON.stringify(predictions));
	// persist to Firestore when available (doc id: userId_matchId)
	if (useFirebase && currentUser && currentUser.id) {
		const docId = `${currentUser.id}_${matchId}`;
		db.collection('predictions').doc(docId).set({ userId: currentUser.id, matchId, home: String(h), away: String(a), updatedAt: Date.now() })
			.then(() => {
				closeModal();
				showToast('Voorspelling opgeslagen', 'success');
				navigateTo('dashboard');
			})
			.catch(err => showToast('Opslaan mislukt: ' + err.message, 'error'));
	} else {
		// also persist under member predictions for group leaderboards
		if (currentUser && currentUser.id) saveMemberPrediction(currentUser.id, matchId, h, a);
		closeModal();
		showToast('Voorspelling opgeslagen', 'success');
		navigateTo('dashboard');
	}
}

function showToast(text, type = 'default') {
	const container = document.getElementById('toast-container');
	const t = document.createElement('div');
	t.className = 'toast' + (type === 'success' ? ' toast-success' : type === 'error' ? ' toast-error' : '');
	t.textContent = text;
	container.appendChild(t);
	setTimeout(() => { t.classList.add('toast-fade-out'); setTimeout(() => t.remove(), 350); }, 2200);
}

// Group helpers
function _generateCode() {
	return Math.random().toString(36).substring(2,8).toUpperCase();
}

function createGroup() {
	if (!currentUser || !currentUser.id) {
		// allow a quick demo/local owner when not logged in
		const ownerName = prompt('Je naam (wordt groeps-eigenaar)') || 'Gast';
		currentUser = { id: 'guest_' + Date.now().toString(36), name: ownerName, email: nameToEmail(ownerName) };
		try { updateHeaderUser(); } catch (e) {}
		showToast('Aangemeld als tijdelijk gebruiker ' + currentUser.name, 'success');
	}
	const name = prompt('Naam voor je vriendengroep? (bijv. "Kantoorpoule")');
	if (!name) return showToast('Groepsnaam vereist', 'error');
	const groups = JSON.parse(localStorage.getItem('nl_groups') || '[]');
	const code = _generateCode();
	const id = Date.now().toString(36);
	const ownerId = (currentUser && currentUser.id) ? currentUser.id : ('guest_' + Date.now().toString(36));
	const ownerName = (currentUser && currentUser.name) ? currentUser.name : 'Jij';
	const members = [{ id: ownerId, name: ownerName }];
	const memberIds = members.map(m => m.id);
	const group = { id, code, name, ownerId: ownerId, members };
	groups.push(group);
	localStorage.setItem('nl_groups', JSON.stringify(groups));
	// persist to Firestore if available so group survives reloads and other devices
	if (useFirebase) {
		try {
			db.collection('groups').doc(id).set({ id, code, name, ownerId: currentUser.id, members, memberIds })
				.then(() => showToast('Groep aangemaakt en gesynchroniseerd. Deel code: ' + code, 'success'))
				.catch(e => { console.warn('Failed to persist group', e); showToast('Groep aangemaakt (lokal), sync mislukt', 'warning'); });
		} catch (e) { console.warn('Failed to persist group', e); }
	} else {
		showToast('Groep aangemaakt. Deel code: ' + code, 'success');
	}
	navigateTo('groups');
}

function joinGroup() {
	if (!currentUser || !currentUser.id) {
		const guestName = prompt('Je naam (wordt je groepsnaam)') || 'Gast';
		currentUser = { id: 'guest_' + Date.now().toString(36), name: guestName, email: nameToEmail(guestName) };
		try { updateHeaderUser(); } catch (e) {}
		showToast('Aangemeld als tijdelijk gebruiker ' + currentUser.name, 'success');
	}
	const code = prompt('Voer groepscode in om te joinen');
	if (!code) return;
	const name = prompt('Jouw naam in de groep (bijv. Piet)') || (currentUser.name || 'Speler');
	const groups = JSON.parse(localStorage.getItem('nl_groups') || '[]');
	const g = groups.find(x => x.code === code.trim().toUpperCase());
	if (!g) return showToast('Groep niet gevonden', 'error');
	if (!g.members.find(m => m.id === currentUser.id)) {
		g.members.push({ id: currentUser.id, name });
		localStorage.setItem('nl_groups', JSON.stringify(groups));
		// also persist membership to Firestore if group exists there
		if (useFirebase) {
			try {
				// try to find group doc by code
				db.collection('groups').where('code', '==', g.code).limit(1).get().then(q => {
					if (!q.empty) {
						const doc = q.docs[0];
						doc.ref.update({ members: firebase.firestore.FieldValue.arrayUnion({ id: currentUser.id, name }), memberIds: firebase.firestore.FieldValue.arrayUnion(currentUser.id) }).catch(e => console.warn('Failed to update group members', e));
					} else {
						// create new doc
						db.collection('groups').doc(g.id).set({ id: g.id, code: g.code, name: g.name, ownerId: g.ownerId || currentUser.id, members: g.members, memberIds: g.members.map(m=>m.id) }).catch(e => console.warn('Failed to create group doc', e));
					}
				}).catch(e => console.warn('Failed to query group by code', e));
			} catch (e) { console.warn('Failed to persist join to Firestore', e); }
		}
	}
	showToast('Je bent lid van ' + g.name, 'success');
	navigateTo('groups');
}

function renderGroupLeaderboard(container, group) {
	// Build a richer leaderboard table with predictions per match and red-card controls
	const matches = getMatches().slice();
	matches.sort((a,b) => new Date(a.date) - new Date(b.date));

	// try to fetch redcards from Firestore for this group and cache locally, then rerender
	if (useFirebase) {
		db.collection('groupRedCards').doc(group.id).get().then(doc => {
			if (doc.exists) {
				try { const all = JSON.parse(localStorage.getItem('nl_redcards') || '{}'); all[group.id] = doc.data(); localStorage.setItem('nl_redcards', JSON.stringify(all)); } catch (e) { console.warn(e); }
				// rerender now that we have fresh data
				try { renderGroupLeaderboard(container, group); } catch (e) { console.warn(e); }
			}
		}).catch(e => console.warn('Failed to fetch redcards for group', e));
		// continue rendering with cached/local data while fetch completes
	}

	// helper to get display name for uid
	async function getDisplayName(uid) {
		if (currentUser && uid === currentUser.id) return currentUser.name || uid;
		// try local group member name
		const member = group.members.find(x => x.id === uid);
		if (member) return member.name;
		// try users in firestore
		if (useFirebase) {
			try { const doc = await db.collection('users').doc(uid).get(); if (doc.exists && doc.data().displayName) return doc.data().displayName; } catch (e) {}
		}
		return uid;
	}

	// collect rows data
	const rows = group.members.map(m => ({ id: m.id, name: m.name }));
	// compute totals (consider redcards in this group)
	const totals = {};
	for (const r of rows) {
		totals[r.id] = computeUserPointsUpToMatch(r.id, matches[matches.length-1].id, group.id).total;
	}
	// sort members by total desc
	rows.sort((a,b) => (totals[b.id] || 0) - (totals[a.id] || 0));

	const view = document.createElement('div');
	view.className = 'group-leaderboard';
	view.innerHTML = `<h3>Klassement — ${group.name}</h3>`;

	// create table header
	const table = document.createElement('table');
	table.style.width = '100%';
	table.style.borderCollapse = 'collapse';
	const thead = document.createElement('thead');
	let headRow = '<tr><th>Speler</th>';
	for (const m of matches) headRow += `<th style="min-width:80px">${localizeCountry(m.home)}<br/>vs<br/>${localizeCountry(m.away)}</th>`;
	headRow += '<th>Totaal</th></tr>';
	thead.innerHTML = headRow;
	table.appendChild(thead);

	const tbody = document.createElement('tbody');
	rows.forEach((r, idx) => {
		const tr = document.createElement('tr');
		tr.style.borderTop = '1px solid var(--border)';
		const nameCell = document.createElement('td');
		nameCell.style.padding = '8px';
		const crown = idx === 0 ? ' 👑' : '';
		nameCell.innerHTML = `<strong>${r.name}${crown}</strong>`;
		tr.appendChild(nameCell);
		// predictions per match
		const allPreds = JSON.parse(localStorage.getItem('nl_member_predictions') || '{}');
		const userPreds = allPreds[r.id] || {};
		for (const m of matches) {
			const cell = document.createElement('td');
			cell.style.padding = '6px';
			cell.style.textAlign = 'center';
			const p = userPreds[m.id] || null;
			const predText = p ? `${p.home}-${p.away}` : '—';
			cell.innerHTML = `<div>${predText}</div>`;
			// red card control (if current user can give and not self)
			if (currentUser && currentUser.id && currentUser.id !== r.id) {
				const giverCount = countRedCardsGivenInGroup(currentUser.id, group.id);
				const hasGiven = hasGivenRedCard(currentUser.id, group.id, m.id, r.id);
				const btn = document.createElement('button');
				btn.className = 'btn btn-sm';
				btn.style.marginTop = '6px';
				btn.textContent = hasGiven ? 'Rode kaart (gegeven)' : 'Geef rode kaart';
				btn.disabled = (!hasGiven && giverCount >= 2);
				btn.onclick = (e) => { e.stopPropagation(); toggleRedCard(group.id, m.id, currentUser.id, r.id); renderGroupLeaderboard(container, group); };
				cell.appendChild(btn);
			}
			// mark if target has red card against them for this match
			const rc = getRedCardsForGroup(group.id);
			if (rc && rc[m.id] && rc[m.id][r.id] && rc[m.id][r.id].length) {
				const mark = document.createElement('div');
				mark.style.color = 'red';
				mark.style.fontWeight = '700';
				mark.textContent = '🔴';
				cell.appendChild(mark);
			}
			tr.appendChild(cell);
		}
		const totalCell = document.createElement('td');
		totalCell.style.padding = '8px';
		totalCell.textContent = totals[r.id] || 0;
		tr.appendChild(totalCell);
		tbody.appendChild(tr);
	});
	table.appendChild(tbody);
	view.appendChild(table);
	container.appendChild(view);
}

function getRedCardsForGroup(groupId) {
	try { const all = JSON.parse(localStorage.getItem('nl_redcards') || '{}'); return all[groupId] || {}; } catch (e) { return {}; }
}

function saveRedCardsForGroup(groupId, data) {
	try {
		const all = JSON.parse(localStorage.getItem('nl_redcards') || '{}');
		all[groupId] = data;
		localStorage.setItem('nl_redcards', JSON.stringify(all));
		// persist to Firestore for group synchronization (all members should be able to read)
		if (useFirebase) {
			try {
				db.collection('groupRedCards').doc(groupId).set(data).catch(e => console.warn('Failed to persist redcards to Firestore', e));
			} catch (e) { console.warn('Failed to persist redcards to Firestore', e); }
		}
	} catch (e) { console.warn('Failed to save redcards', e); }
}

function countRedCardsGivenInGroup(giverId, groupId) {
	const rc = getRedCardsForGroup(groupId);
	let count = 0;
	for (const matchId in rc) {
		const perMatch = rc[matchId];
		for (const targetId in perMatch) {
			const givers = perMatch[targetId] || [];
			if (givers.includes(giverId)) count += 1;
		}
	}
	return count;
}

function hasGivenRedCard(giverId, groupId, matchId, targetId) {
	const rc = getRedCardsForGroup(groupId);
	return !!(rc[matchId] && rc[matchId][targetId] && rc[matchId][targetId].includes(giverId));
}

function toggleRedCard(groupId, matchId, giverId, targetId) {
	if (giverId === targetId) return showToast('Je kunt jezelf geen rode kaart geven', 'error');
	const rc = getRedCardsForGroup(groupId);
	rc[matchId] = rc[matchId] || {};
	rc[matchId][targetId] = rc[matchId][targetId] || [];
	const idx = rc[matchId][targetId].indexOf(giverId);
	if (idx === -1) {
		// give card
		const givenCount = countRedCardsGivenInGroup(giverId, groupId);
		if (givenCount >= 2) return showToast('Je hebt al 2 rode kaarten uitgedeeld in deze groep', 'error');
		rc[matchId][targetId].push(giverId);
		saveRedCardsForGroup(groupId, rc);
		showToast('Rode kaart gegeven', 'success');
	} else {
		// remove card
		rc[matchId][targetId].splice(idx,1);
		if (rc[matchId][targetId].length === 0) delete rc[matchId][targetId];
		if (Object.keys(rc[matchId]).length === 0) delete rc[matchId];
		saveRedCardsForGroup(groupId, rc);
		showToast('Rode kaart verwijderd', 'default');
	}
}

// Init: wire tab defaults and nav
(function init() {
	// default auth tab
	switchTab('login');
	// Load fixtures into localStorage for immediate use
	ensureFixturesLoaded();
	try { updateHeaderUser(); } catch (e) {}
	// If there's no signed-in user yet, show the app so anonymous visitors see matches
	if (!currentUser) {
		try { document.getElementById('view-auth').style.display = 'none'; document.getElementById('app').style.display = ''; } catch (e) {}
		try { navigateTo('matches'); } catch (e) {}
	}
})();

// Prompt user for nickname if none set
async function askForNickname(uid) {
	// deprecated: use openProfileEditor(uid)
	openProfileEditor(uid);
}

function openProfileEditor(uid) {
	const current = (currentUser && currentUser.id === uid) ? currentUser.name || '' : '';
	const modalHtml = `
		<div class="modal-overlay" id="profile-edit-modal">
			<div class="modal-content">
				<div class="modal-header"><h3>Bewerk profiel</h3><button class="modal-close" onclick="closeModal()">✕</button></div>
				<div class="modal-body">
					<label>Nickname</label>
					<input id="profile-nick-input" type="text" placeholder="Bijv. Piet" value="${current}">
				</div>
				<div class="modal-footer"><button class="btn btn-secondary" onclick="closeModal()">Annuleer</button><button class="btn btn-primary" onclick="saveProfileFromModal('${uid}')">Opslaan</button></div>
			</div>
		</div>
	`;
	document.getElementById('modal-container').innerHTML = modalHtml;
}

async function saveProfileFromModal(uid) {
	const input = document.getElementById('profile-nick-input');
	if (!input) return showToast('Veld niet gevonden', 'error');
	const displayName = input.value.trim();
	if (!displayName) return showToast('Voer een nickname in', 'error');
	try {
		// update auth profile
		if (useAuthFirebase && auth.currentUser && auth.currentUser.uid === uid) {
			try { await auth.currentUser.updateProfile({ displayName }); } catch (e) { console.warn('Auth profile update failed', e); }
		}
		// update users doc
		if (useFirebase) {
			try { await db.collection('users').doc(uid).set({ displayName }, { merge: true }); } catch (e) { console.warn('Failed to write displayName to users doc', e); }
		}
		if (currentUser && currentUser.id === uid) {
			currentUser.name = displayName;
			updateHeaderUser();
		}
		closeModal();
		showToast('Nickname opgeslagen', 'success');
	} catch (e) { console.warn('saveProfileFromModal failed', e); showToast('Opslaan mislukt', 'error'); }
}

async function loadFixturesFromServer() {
	try {
		// Force network (avoid cached SW responses) to get latest fixtures
		// Use relative path so it works on GitHub Pages under a repo subpath
		const resp = await fetch('fixtures.json', { cache: 'no-store' });
		if (!resp.ok) return;
		const data = await resp.json();
		if (Array.isArray(data) && data.length) {
				localStorage.setItem('nl_fixtures', JSON.stringify(data));
				// refresh matches view so imported fixtures appear immediately
				try { navigateTo('matches'); } catch (e) {}
				showToast('Fixtures automatisch geladen (' + data.length + ')', 'success');
		}
	} catch (e) {
		console.warn('No fixtures.json on server or failed to load', e);
		showToast('Fixtures ophalen mislukt', 'error');
	}
}

// Ensure we have a reasonable number of fixtures locally; try to fetch if not
function ensureFixturesLoaded(minCount = 5) {
	try {
		const stored = JSON.parse(localStorage.getItem('nl_fixtures') || '[]');
		if (!Array.isArray(stored) || stored.length < minCount) {
			// async fetch in background; will navigate to matches when done
			loadFixturesFromServer().catch(() => {});
		}
	} catch (e) { loadFixturesFromServer().catch(() => {}); }
}
