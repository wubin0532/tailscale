'use strict';
'require view';
'require rpc';
'require poll';
'require ui';
'require tailscale.ui-v2-2-0-r2 as tsui';

var callGetStatus = rpc.declare({ object: 'tailscale', method: 'get_status', expect: {} });
var callPing = rpc.declare({ object: 'tailscale', method: 'ping', params: ['host'], expect: {} });

return view.extend({
	render: function() {
		this.peers = []; this.checks = {}; this.query = ''; this.onlyOnline = false;
		var v = tsui.wrap(_('Devices'), _('Devices visible to this router. Access policies can limit visibility.'), [
			E('section', { 'class': 'ts-card' }, [
				E('div', { 'class': 'ts-toolbar' }, [
					E('input', { type: 'text', 'class': 'ts-wide', placeholder: _('Search name or IP'), 'aria-label': _('Search name or IP'), input: L.bind(function(ev) { this.query = ev.target.value.toLowerCase(); this.drawPeers(); }, this) }),
					E('label', {}, [E('input', { type: 'checkbox', change: L.bind(function(ev) { this.onlyOnline = ev.target.checked; this.drawPeers(); }, this) }), ' ', _('Online only')]),
					E('button', { 'class': 'btn cbi-button ts-action', click: L.bind(this.updatePeers, this) }, _('Refresh')),
					E('span', { id: 'ts_peer_count', 'class': 'ts-muted' }),
					E('span', { id: 'ts_peer_updated', 'class': 'ts-muted' })
				]),
				E('div', { id: 'ts_peer_notice', 'class': 'ts-notice', role: 'status', 'aria-live': 'polite' }, _('Loading...')),
				E('table', { 'class': 'table ts-peer-table' }, [
					E('thead', {}, E('tr', {}, [_('Node'), _('Tailscale IP'), _('OS'), _('Status'), _('Connection'), _('Last Seen'), _('Detection')].map(function(t) { return E('th', {}, t); }))),
					E('tbody', { id: 'ts_peers' })
				])
			])
		]);
		poll.add(L.bind(this.updatePeers, this), 5); this.updatePeers();
		return v;
	},
	fmtSeen: function(ts) {
		if (!ts || ts.indexOf('0001-') === 0) return '—';
		var diff = Math.max(0, Math.floor((Date.now() - new Date(ts)) / 1000));
		if (!isFinite(diff)) return '—';
		if (diff < 60) return _('%ds ago').format(diff);
		if (diff < 3600) return _('%dm ago').format(Math.floor(diff / 60));
		if (diff < 86400) return _('%dh ago').format(Math.floor(diff / 3600));
		return _('%dd ago').format(Math.floor(diff / 86400));
	},
	updatePeers: function() {
		if (this.fetching) return Promise.resolve();
		this.fetching = true;
		return callGetStatus().then(L.bind(function(res) {
			var raw;
			if (res.success === false || res.stale) throw new Error(tsui.message(res));
			try { raw = JSON.parse(res.raw || '{}'); } catch (e) { throw new Error(_('Invalid status response.')); }
			if (res.running && !raw.BackendState) throw new Error(_('Invalid status response.'));
			this.peers = Object.keys(raw.Peer || {}).map(function(k) { var p = raw.Peer[k]; p._id = p.ID || k; return p; });
			this.notice(tsui.message(res));
			var stamp = document.getElementById('ts_peer_updated'); if (stamp) stamp.textContent = tsui.updated(res.fetched_at);
			this.drawPeers();
		}, this)).catch(L.bind(function(err) {
			this.notice((err.message || String(err)) + ' ' + _('Previous data is retained.'));
		}, this)).finally(L.bind(function() { this.fetching = false; }, this));
	},
	notice: function(message) {
		var el = document.getElementById('ts_peer_notice');
		if (el) { el.textContent = message; el.style.display = message ? '' : 'none'; }
	},
	drawPeers: function() {
		var tbody = document.getElementById('ts_peers'); if (!tbody) return;
		var peers = (this.peers || []).slice().sort(function(a, b) { return Number(!!b.Online) - Number(!!a.Online) || (a.HostName || '').localeCompare(b.HostName || ''); });
		var count = document.getElementById('ts_peer_count');
		if (count) count.textContent = _('%d online / %d total').format(peers.filter(function(p) { return p.Online; }).length, peers.length);
		peers = peers.filter(L.bind(function(p) { return (!this.onlyOnline || p.Online) && (!this.query || ((p.HostName || '') + ' ' + (p.TailscaleIPs || []).join(' ')).toLowerCase().indexOf(this.query) >= 0); }, this));
		var focused = document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-peer');
		tbody.textContent = '';
		if (!peers.length) tbody.appendChild(E('tr', {}, E('td', { colspan: 7 }, _('No matching devices. If Home is missing, compare the core status and access policy.'))));
		peers.forEach(L.bind(function(p) {
			var ip = (p.TailscaleIPs || [])[0];
			var check = (this.checks || {})[p._id] || {};
			var conn = !p.Online ? '—' : !p.Active ? _('Idle') : p.CurAddr ? _('Direct') : p.PeerRelay ? _('Peer relay') : p.Relay ? _('Relay') + ' (' + p.Relay + ')' : _('Unknown');
			var btn = E('button', { 'class': 'btn cbi-button ts-success', 'data-peer': p._id, click: L.bind(this.handlePing, this, ip, p._id) }, check.pending ? _('Testing connection...') : _('Ping'));
			btn.disabled = !!check.pending || !ip;
			var values = [E('strong', {}, p.HostName || p.DNSName || '—'), (p.TailscaleIPs || []).join('\n') || '—', p.OS || '—', E('span', { 'class': p.Online ? 'ts-good' : 'ts-neutral' }, p.Online ? _('Online') : _('Offline')), conn, p.Online ? _('now') : this.fmtSeen(p.LastSeen), [btn, E('span', { 'class': 'ts-peer-result', 'aria-live': 'polite' }, check.result || '')]];
			var titles = [_('Node'), _('Tailscale IP'), _('OS'), _('Status'), _('Connection'), _('Last Seen'), _('Detection')];
			tbody.appendChild(E('tr', {}, values.map(function(value, i) { return E('td', { 'data-title': titles[i] }, value); })));
			if (focused === p._id && !check.pending) btn.focus();
		}, this));
	},
	handlePing: function(ip, id) {
		this.checks = this.checks || {};
		if (!ip || (this.checks[id] && this.checks[id].pending)) return Promise.resolve();
		var check = this.checks[id] = { pending: true, result: '' }; this.drawPeers();
		return callPing(ip).then(function(res) {
			if (!res || res.success !== true) throw new Error(tsui.output(res && res.output) || _('Detection failed.'));
			check.result = (res.output || '').trim();
		}).catch(function(err) { check.result = _('Failed: %s').format(err.message || String(err)); }).finally(L.bind(function() { check.pending = false; this.drawPeers(); }, this));
	},
	handleSaveApply: null, handleSave: null, handleReset: null
});
