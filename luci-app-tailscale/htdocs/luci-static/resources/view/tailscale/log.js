'use strict';
'require view';
'require rpc';
'require poll';
'require ui';
'require tailscale.ui-v2-2-0-r2 as tsui';
var callGetLog = rpc.declare({ object: 'tailscale', method: 'get_log', expect: {} });
return view.extend({
	render: function() {
		this.paused = false; this.log = ''; this.query = '';
		var v = tsui.wrap(_('Logs'), _('Recent Tailscale activity. Pause before reviewing or copying.'), [E('section', { 'class': 'ts-card' }, [
			E('div', { 'class': 'ts-toolbar' }, [
				E('button', { 'class': 'btn cbi-button ts-warning', click: L.bind(function(ev) { this.paused = !this.paused; ev.currentTarget.textContent = this.paused ? _('Resume') : _('Pause'); this.drawLog(); if (!this.paused) return this.updateLog(); }, this) }, _('Pause')),
				E('button', { 'class': 'btn cbi-button ts-action', click: L.bind(function() { return this.updateLog(true); }, this) }, _('Refresh')),
				E('button', { 'class': 'btn cbi-button ts-action', click: L.bind(function() {
					if (!navigator.clipboard) { ui.addNotification(null, E('p', _('Copy is unavailable. Select the log text to copy.'))); return; }
					return navigator.clipboard.writeText(document.getElementById('ts_log').textContent).catch(function() { ui.addNotification(null, E('p', _('Copy is unavailable. Select the log text to copy.'))); });
				}, this) }, _('Copy')),
				E('input', { type: 'text', 'class': 'ts-wide', placeholder: _('Filter logs'), 'aria-label': _('Filter logs'), input: L.bind(function(ev) { this.query = ev.target.value.toLowerCase(); this.drawLog(); }, this) }),
				E('span', { id: 'ts_log_status', 'class': 'ts-muted' }, _('Loading...'))
			]), E('pre', { id: 'ts_log', tabindex: 0 }, _('Loading...'))
		])]);
		poll.add(L.bind(this.updateLog, this), 5); this.updateLog(); return v;
	},
	updateLog: function(force) {
		if ((this.paused && force !== true) || this.fetching) return Promise.resolve();
		this.fetching = true;
		return callGetLog().then(L.bind(function(res) { this.log = (res && res.log) || ''; this.drawLog(); }, this)).catch(function(err) {
			var el = document.getElementById('ts_log_status'); if (el) el.textContent = err.message || _('Status could not be refreshed.');
		}).finally(L.bind(function() { this.fetching = false; }, this));
	},
	drawLog: function() {
		var pre = document.getElementById('ts_log'); if (!pre) return;
		var nearBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 60;
		pre.textContent = (this.log || '').split('\n').filter(L.bind(function(line) { return !this.query || line.toLowerCase().indexOf(this.query) >= 0; }, this)).join('\n') || _('No matching log entries.');
		if (nearBottom) pre.scrollTop = pre.scrollHeight;
		var el = document.getElementById('ts_log_status'); if (el) el.textContent = (this.paused ? _('Paused') : nearBottom ? _('Following latest entries') : _('Auto-follow paused while scrolling')) + ' · ' + tsui.time(Date.now());
	},
	handleSaveApply: null, handleSave: null, handleReset: null
});
