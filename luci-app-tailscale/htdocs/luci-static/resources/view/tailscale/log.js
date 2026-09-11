'use strict';
'require view';
'require rpc';
'require poll';

var callGetLog = rpc.declare({
	object: 'tailscale',
	method: 'get_log',
	expect: { }
});

return view.extend({
	render: function() {
		var v = E('div', {}, [
			E('h2', {}, _('Logs')),
			E('div', { 'class': 'cbi-section-descr' },
				_('Tailscale daemon logs, refreshed every 3 seconds.')),
			E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, [
					'logread · tailscale',
					' ',
					E('button', {
						'class': 'btn cbi-button',
						'style': 'padding:2px 10px',
						'click': L.bind(this.updateLog, this)
					}, _('Refresh'))
				]),
				E('pre', {
					'id': 'ts_log',
					'style': 'max-height:520px;overflow-y:auto;font-size:12px;white-space:pre-wrap;word-break:break-all'
				}, _('Loading...'))
			])
		]);

		poll.add(L.bind(this.updateLog, this), 3);
		this.updateLog();
		return v;
	},

	updateLog: function() {
		return callGetLog().then(function(res) {
			var pre = document.getElementById('ts_log');
			if (!pre) return;
			var nearBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 60;
			pre.textContent = (res && res.log) || _('No log entries.');
			if (nearBottom)
				pre.scrollTop = pre.scrollHeight;
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
