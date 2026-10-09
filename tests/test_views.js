const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const dir = path.join(__dirname, '../luci-app-tailscale/htdocs/luci-static/resources/view/tailscale');
const E = (tag, attrs, children) => ({tag, attrs: attrs || {}, children, appendChild() {}});
const L = {bind: (fn, ctx, ...args) => fn.bind(ctx, ...args)};
String.prototype.format = function(...args) { let i=0; return this.replace(/%[sd]/g, () => args[i++]); };
let passed=0;
async function check(name, fn) { await fn(); console.log('PASS '+name); passed++; }
function load(name, env) {
 const keys=Object.keys(env);
 return new Function(...keys, fs.readFileSync(path.join(dir,name+'.js'),'utf8'))(...keys.map(k=>env[k]));
}
(async () => {
 let pingCalls=0, pingBtn, notifications=0;
 const nodes={ts_peers:{appendChild(){},textContent:''},ts_peer_count:{}};
 const peers=load('peers', {view:{extend:x=>x},rpc:{declare:s=>s.method==='ping'?ip=>{pingCalls++;assert.equal(ip,'100.74.174.72');return Promise.resolve({output:'pong'});}:()=>Promise.resolve({raw:JSON.stringify({Peer:{home:{TailscaleIPs:['100.74.174.72'],HostName:'Home',Online:true}}})})},poll:{},E:(tag,attrs,ch)=>{const el=E(tag,attrs,ch);if(tag==='button')pingBtn=el;return el;},L,_:x=>x,document:{getElementById:id=>nodes[id]},ui:{addNotification(){notifications++;}},setTimeout:()=>{}});
 await check('peer Ping calls RPC and restores button',async()=>{await peers.updatePeers();await pingBtn.attrs.click({currentTarget:pingBtn});assert.equal(pingCalls,1);assert.equal(pingBtn.disabled,false);assert.equal(notifications,0);});
 let response={success:true}, reloads=0, modal, hides=0, enables=[];
 const status=load('status',{view:{extend:x=>x},rpc:{declare:s=> (...args)=>{if(s.method==='set_enabled')enables.push(args[0]);return Promise.resolve(response);}},uci:{set(){throw Error('No staged UCI writes allowed');},save(){throw Error('No staged UCI writes allowed');}},ui:{showModal:(title,content)=>{modal={title,content};},hideModal(){hides++;},addNotification(){notifications++;}},poll:{},E,L,_:x=>x,window:{location:{reload(){reloads++;}}},qrcode:()=>({addData(){},make(){},createSvgTag:()=>'<svg/>'})});
 await check('enable uses backend committed action',async()=>{const target={checked:true};await status.handleEnable({target});assert.deepEqual(enables,['1']);assert.equal(reloads,1);assert.equal(target.disabled,false);});
 await check('failed enable shows error and restores checkbox',async()=>{response={success:false,output:'start failed'};const target={checked:true};await status.handleEnable({target});assert.equal(target.checked,false);assert.equal(reloads,1);assert.equal(notifications,1);});
 await check('login failure reports error and unlocks button',async()=>{const target={disabled:false};await status.handleLogin({target});assert.equal(status.loginRequested,false);assert.equal(target.disabled,false);assert.equal(notifications,2);});
 await check('closed login modal can reopen',async()=>{status.showLoginModal('https://example.invalid/1');const buttons=modal.content.at(-1).children;buttons.at(-1).attrs.click();assert.equal(status.loginModalShown,false);status.showLoginModal('https://example.invalid/2');assert.equal(status.loginModalShown,true);assert.equal(hides>=1,true);});
 const options={};
 const section={option:(_type,name)=>{const o={value(){},depends(){}};options[name]=o;return o;}};
 const form={Map:function(){this.section=()=>section;this.render=()=>Promise.resolve(E('form'));},NamedSection:{},Flag:{},Value:{},DynamicList:{},ListValue:{}};
 const parseIPv4=s=>/^\d+\.\d+\.\d+\.\d+$/.test(s)&&s.split('.').every(x=>Number(x)<256)?s.split('.').map(Number):null;
 const parseIPv6=s=>s==='fd12::'? [0xfd12,0,0,0,0,0,0,0] : s==='fd12::1'?[0xfd12,0,0,0,0,0,0,1]:null;
 const settings=load('settings',{view:{extend:x=>x},rpc:{declare:()=>()=>Promise.resolve({})},poll:{add(){}},form,uci:{get:()=>null,load:()=>Promise.resolve()},validation:{parseIPv4,parseIPv6},E,_:x=>x});
 await settings.render();
 await check('network address validation IPv4/IPv6',async()=>{const v=options.advertise_routes.validate;assert.equal(v('', '192.168.123.0/24'),true);assert.notEqual(v('', '192.168.123.1/24'),true);assert.equal(v('', 'fd12::/64'),true);assert.notEqual(v('', 'fd12::1/64'),true);assert.notEqual(v('', '1.2.3.4/33'),true);});
 await check('exit and control server input validation',async()=>{assert.notEqual(options.exit_node.validate('', '192.168.123.0/24'),true);assert.equal(options.exit_node.validate('', '100.74.174.72'),true);assert.equal(options.exit_node.validate('', ''),true);assert.notEqual(options.login_server.validate('', 'root'),true);assert.equal(options.login_server.validate('', 'https://headscale.example.com'),true);});
 await check('requested firewall defaults and empty NAT lists',async()=>{assert.equal(options.input.default,'REJECT');assert.equal(options.output.default,'ACCEPT');assert.equal(options.forward.default,'REJECT');assert.equal(options.tailscale_to_lan.default,'0');assert.equal(options.masq_src.default,undefined);assert.equal(options.masq_dest.default,undefined);assert.equal(options.masq_src.placeholder,'192.168.123.0/24');assert.equal(options.masq_dest.placeholder,'192.168.199.0/24');});
 console.log(`${passed} view tests passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
