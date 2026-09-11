'use strict';
'require form';
'require view';

return view.extend({
	render: function() {
		var m, s, o;

		m = new form.Map('tailscale', _('Tailscale'), [
			_('Tailscale connects your devices so you can securely access remote resources. For details, please visit '),
			E('a', { 'href': 'https://tailscale.com', 'target': '_blank' }, 'tailscale')
		]);

		s = m.section(form.NamedSection, 'settings', 'settings', _('Global Settings'));

		o = s.option(form.Flag, 'accept_routes', _('Accept routes'),
			_('Accept subnet routes advertised by other nodes.'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'hostname', _('Device Name'),
			_('Leave empty to use the device name.'));
		o.rmempty = true;

		o = s.option(form.DynamicList, 'advertise_routes', _('Advertise routes'),
			_('Subnets allowed to be accessed through this node, e.g. 192.168.100.0/24.'));
		o.datatype = 'cidr';
		o.rmempty = true;

		o = s.option(form.Value, 'auth_key', _('Auth Key'),
			_('Optional. Use an auth key to log in automatically without browser interaction.'));
		o.password = true;
		o.rmempty = true;

		s = m.section(form.NamedSection, 'auto', 'firewall', _('Firewall Settings'));

		o = s.option(form.Flag, 'fw_enabled', _('Auto configure firewall'),
			_('Automatically create the tailscale firewall zone and forwarding rules.'));
		o.ucioption = 'enabled';
		o.default = '0';
		o.rmempty = false;

		o = s.option(form.ListValue, 'input', _('Input policy'),
			_('Policy for traffic from the Tailscale network to this router.'));
		o.value('ACCEPT', _('Accept'));
		o.value('REJECT', _('Reject'));
		o.value('DROP', _('Drop'));
		o.default = 'ACCEPT';
		o.depends('fw_enabled', '1');

		o = s.option(form.Flag, 'lan_forward', _('Allow LAN forwarding'),
			_('Allow traffic forwarding between the LAN and Tailscale zones.'));
		o.default = '1';
		o.rmempty = false;
		o.depends('fw_enabled', '1');

		o = s.option(form.Flag, 'masq', _('NAT masquerading'),
			_('Enable NAT masquerading on the Tailscale zone. Required when this node acts as an exit node or subnet router.'));
		o.default = '1';
		o.rmempty = false;
		o.depends('fw_enabled', '1');

		return m.render();
	}
});
