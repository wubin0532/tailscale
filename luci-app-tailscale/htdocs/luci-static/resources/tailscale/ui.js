'use strict';
'require baseclass';

return baseclass.extend({
	wrap: function(title, description, children) {
		if (!document.getElementById('ts-v2-style'))
			document.head.appendChild(E('link', { id: 'ts-v2-style', rel: 'stylesheet', href: L.resource('tailscale/ui-v2-2-0-r2.css') }));
		return E('div', { 'class': 'ts-app' }, [
			E('div', { 'class': 'ts-header' }, [E('div', {}, [E('h2', {}, title), E('p', {}, description)]), E('span', { 'class': 'ts-version' }, 'v2.2.0')])
		].concat(children));
	},
	message: function(res) {
		if (!res.running) return _('Service stopped. Enable it on the status page.');
		if (res.backend_state === 'NeedsLogin') return _('Sign in on the status page to see your devices.');
		if (res.backend_state === 'NeedsMachineAuth') return _('Approve this device in the Tailscale admin console.');
		if (res.success === false || res.stale) return this.output(res.error) || _('Status could not be refreshed.');
		if (!res.online) return _('Control connection is not ready. The device list may be incomplete.');
		return '';
	},
	state: function(value) {
		var states = {
			NoState: _('Initializing'), Starting: _('Starting'),
			NeedsLogin: _('Not logged in'), NeedsMachineAuth: _('Awaiting device approval'),
			Running: _('Running'), Stopped: _('Stopped')
		};
		return Object.prototype.hasOwnProperty.call(states, value) ? states[value] : _('Unknown');
	},
	output: function(value) {
		// Keep core diagnostics intact when no translation is available.
		return String(value || '').split('\n').map(function(line) { return _(line); }).join('\n');
	},
	time: function(value) {
		// LuCI sets this attribute from luci.main.lang (including Auto).
		var locale = document.documentElement.lang || 'en';
		try { return new Date(value).toLocaleTimeString(locale); }
		catch (err) { return new Date(value).toLocaleTimeString('en'); }
	},
	updated: function(value) {
		return value ? _('Updated: %s').format(this.time(Number(value) * 1000)) : _('Waiting for status');
	}
});
