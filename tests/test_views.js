const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const dir = path.join(__dirname, '../luci-app-tailscale/htdocs/luci-static/resources/view/tailscale');
const nodes = {};
function E(tag, attrs, children) {
 const el={tag,attrs:attrs||{},children:[],style:{},disabled:Object.hasOwn(attrs||{},'disabled'),focus(){},addEventListener(){},appendChild(c){this.children.push(c);},getAttribute(k){return this.attrs[k];}};
 let value='';Object.defineProperty(el,'textContent',{get(){return value;},set(v){value=v;this.children=[];}});
 if (typeof children==='string')el.textContent=children;
 else if (Array.isArray(children))el.children=children;
 else if(children)el.children=[children];
 if(el.attrs.id)nodes[el.attrs.id]=el;
 return el;
}
const L = {bind:(fn,ctx,...args)=>fn.bind(ctx,...args),resource:s=>s};
String.prototype.format = function(...args) {let i=0;return this.replace(/%[sd]/g,()=>args[i++]);};
const tsui={time:t=>String(t),output:t=>t||'',state:t=>t,wrap:(t,d,c)=>E('div',{},c),updated:t=>String(t||''),message:r=>!r.running?'stopped':r.success===false?'read failed':!r.online?'disconnected':''};
const document={getElementById:id=>nodes[id],activeElement:null,head:{appendChild(){}}};
let passed=0;
async function check(name,fn){await fn();console.log('PASS '+name);passed++;}
function load(name,env){const e={E,L,_:x=>x,document,tsui,...env};return new Function(...Object.keys(e),fs.readFileSync(path.join(dir,name+'.js'),'utf8'))(...Object.values(e));}
function findButton(root){if(root.tag==='button')return root;for(const c of root.children||[]){if(c&&typeof c==='object'){const r=findButton(c);if(r)return r;}}}
(async()=>{
 let resolvePing,pingCalls=0;
 let response={success:true,running:true,online:true,raw:JSON.stringify({BackendState:'Running',Peer:{home:{ID:'home',TailscaleIPs:['100.74.174.72'],HostName:'Home',Online:true},old:{ID:'old',TailscaleIPs:['100.90.0.1'],HostName:'Offline',Online:false}}})};
 const peers=load('peers',{view:{extend:x=>x},rpc:{declare:s=>s.method==='ping'?()=>{pingCalls++;return new Promise(r=>resolvePing=r);}:()=>Promise.resolve(response)},poll:{add(){}},ui:{}});
 peers.render();await peers.updatePeers();await new Promise(r=>setImmediate(r));
 await check('offline peers remain visible and Home matches core',async()=>{assert.equal(peers.peers.length,2);assert.equal(nodes.ts_peers.children.length,2);});
 await check('Ping stays pending across two refreshes and prevents duplicates',async()=>{
  const p=peers.handlePing('100.74.174.72','home');await peers.updatePeers();await peers.updatePeers();await peers.handlePing('100.74.174.72','home');
  assert.equal(pingCalls,1);assert.equal(findButton(nodes.ts_peers).disabled,true);
  resolvePing({success:true,output:'pong from Home in 16ms'});await p;assert.equal(peers.checks.home.result,'pong from Home in 16ms');
  await peers.updatePeers();assert.equal(peers.checks.home.result,'pong from Home in 16ms');assert.equal(findButton(nodes.ts_peers).disabled,false);
 });
 await check('CLI nonzero reports failure',async()=>{const p=peers.handlePing('100.74.174.72','home');resolvePing({success:false,exit_code:1,output:'timeout'});await p;assert.match(peers.checks.home.result,/Failed: timeout/);});
 await check('bad JSON retains last device data with error',async()=>{response={success:true,running:true,raw:'bad'};await peers.updatePeers();assert.equal(peers.peers.length,2);assert.match(nodes.ts_peer_notice.textContent,/Invalid status/);});
 await check('stale RPC never becomes empty device success',async()=>{response={success:false,running:true,stale:true};await peers.updatePeers();assert.equal(peers.peers.length,2);assert.match(nodes.ts_peer_notice.textContent,/Previous data/);});
 await check('stopped service clears old device identity',async()=>{response={success:true,running:false,raw:''};await peers.updatePeers();assert.equal(peers.peers.length,0);assert.match(nodes.ts_peer_notice.textContent,/stopped/);});
 let result={success:true},reloads=0,modal,hides=0,enables=[],notifications=0;
 const status=load('status',{view:{extend:x=>x},rpc:{declare:s=>(...a)=>{if(s.method==='set_enabled')enables.push(a[0]);return Promise.resolve(result)}},uci:{get:()=>null,load:()=>Promise.resolve()},ui:{showModal:(t,c)=>modal={title:t,content:c},hideModal(){hides++;},addNotification(){notifications++;}},poll:{add(){}},window:{location:{reload(){reloads++;}}},qrcode:()=>({addData(){},make(){},createSvgTag:()=>'<svg/>'})});
 status.updateStatus=()=>Promise.resolve();
 await check('enable commits backend action and refreshes without reload',async()=>{const t={checked:true};await status.handleEnable({target:t});assert.deepEqual(enables,['1']);assert.equal(reloads,0);assert.equal(t.disabled,false);});
 await check('failed enable restores checkbox',async()=>{result={success:false,output:'start failed'};const t={checked:true};await status.handleEnable({target:t});assert.equal(t.checked,false);assert.equal(notifications,1);});
 await check('login failure unlocks operation',async()=>{const t={disabled:false};await status.handleLogin({target:t});assert.equal(status.accountBusy,false);assert.equal(status.loginRequested,false);assert.equal(notifications,2);});
 await check('closed login modal can reopen',async()=>{status.showLoginModal('https://example.invalid/1');modal.content.at(-1).children.at(-1).attrs.click();assert.equal(status.loginModalShown,false);status.showLoginModal('https://example.invalid/2');assert.equal(status.loginModalShown,true);});
 const options={};const section={tab(){},option(_type,name){return options[name]={value(){},depends(){}};},taboption(tab,type,name){return this.option(type,name);}};
 const form={Map:function(){this.section=()=>section;this.render=()=>Promise.resolve(E('form'));},NamedSection:{},Flag:{},Value:{},DynamicList:{},ListValue:{}};
 const parseIPv4=s=>/^\d+\.\d+\.\d+\.\d+$/.test(s)&&s.split('.').every(x=>Number(x)<256)?s.split('.').map(Number):null;
 const parseIPv6=s=>s==='fd12::'?[0xfd12,0,0,0,0,0,0,0]:s==='fd12::1'?[0xfd12,0,0,0,0,0,0,1]:null;
 const settings=load('settings',{view:{extend:x=>x},rpc:{declare:()=>()=>Promise.resolve({})},poll:{add(){}},form,uci:{get:()=>null,load:()=>Promise.resolve()},validation:{parseIPv4,parseIPv6}});await settings.render();
 await check('IPv4 and IPv6 route validation rejects host bits',async()=>{const v=options.advertise_routes.validate;assert.equal(v('','192.168.199.0/24'),true);assert.notEqual(v('','192.168.199.1/24'),true);assert.equal(v('','fd12::/64'),true);assert.notEqual(v('','fd12::1/64'),true);});
 await check('route datatype preserves input for the LuCI custom validator',async()=>{
  // LuCI cidr4() calls apply(ip4prefix, prefix), which changes Validator.value.
  // Validator.validate() then passes that changed value to the custom callback.
  const o=options.advertise_routes;
  const throughWidget=value=>o.validate('',o.datatype==='cidr'?value.split('/')[1]:value);
  assert.equal(o.datatype,'string');
  for(const value of ['192.168.123.0/24','192.168.199.0/24','100.90.126.80/32','0.0.0.0/0','fd12::/64','fd12::1/128'])assert.equal(throughWidget(value),true,value);
  for(const value of ['192.168.123.1/24','192.168.123.0/33','192.168.001.0/24','999.168.123.0/24','24','fd12::1/64'])assert.notEqual(throughWidget(value),true,value);
 });
 await check('exit and control server input validation',async()=>{assert.notEqual(options.exit_node.validate('','192.168.123.0/24'),true);assert.equal(options.exit_node.validate('','100.74.174.72'),true);assert.notEqual(options.login_server.validate('','root'),true);assert.equal(options.login_server.validate('','https://headscale.example.com'),true);});
 await check('invalid server hosts, ports and credentials are rejected',async()=>{
  const v=options.login_server.validate;
  for(const value of ['https://:','https://headscale.example.com:99999','https://user:pass@headscale.example.com','http://headscale.example.com','https://headscale.example.com/#fragment'])assert.notEqual(v('',value),true,value);
  for(const value of ['', 'https://headscale.example.com:8443/path','https://[fd12::1]:443'])assert.equal(v('',value),true,value);
 });
 await check('exit addresses reject invalid IPs and retain device names',async()=>{
  const v=options.exit_node.validate;
  for(const value of [':','999.90.126.80','-Home','Home..example','192.168.199.0/24'])assert.notEqual(v('',value),true,value);
  for(const value of ['','Home','Home.example.ts.net','123','fd12::1','100.90.126.80','auto:any','auto:legacy'])assert.equal(v('',value),true,value);
 });
 await check('requested firewall defaults and empty NAT lists',async()=>{assert.equal(options.input.default,'REJECT');assert.equal(options.output.default,'ACCEPT');assert.equal(options.forward.default,'REJECT');assert.equal(options.tailscale_to_lan.default,'0');assert.equal(options.masq_src.default,undefined);assert.equal(options.masq_dest.default,undefined);});
 let logCalls=0;const logs=load('log',{view:{extend:x=>x},rpc:{declare:()=>()=>{logCalls++;return Promise.resolve({log:'first\nerror Home'})}},poll:{add(){}},ui:{addNotification(){}},navigator:{}});logs.render();await new Promise(r=>setImmediate(r));
 await check('paused log skips poll and retains text',async()=>{logs.paused=true;const before=logCalls;await logs.updateLog();assert.equal(logCalls,before);assert.match(nodes.ts_log.textContent,/first/);});
 await check('log filter and explicit refresh while paused',async()=>{logs.query='home';logs.drawLog();assert.equal(nodes.ts_log.textContent,'error Home');await logs.updateLog(true);assert.match(nodes.ts_log_status.textContent,/Paused/);});

 const translations={};
 const po=fs.readFileSync(path.join(__dirname,'../luci-app-tailscale/po/zh_Hans/tailscale.po'),'utf8');
 for(const match of po.matchAll(/^msgid (".*")\nmsgstr (".*")$/gm))translations[JSON.parse(match[1])]=JSON.parse(match[2]);
 const text=root=>typeof root==='string'?root:[root?.textContent||'',root?.attrs?.placeholder||'',...(root?.children||[]).map(text)].join(' ');
 for(const lang of ['en','zh-cn']){
  const translate=key=>lang==='zh-cn'?(translations[key]||key):key;
  const doc={...document,documentElement:{lang}};
  const shared=new Function('baseclass','E','L','_','document',fs.readFileSync(path.join(dir,'../../tailscale/ui.js'),'utf8'))({extend:x=>x},E,L,translate,doc);
  const env={_:translate,document:doc,tsui:shared,view:{extend:x=>x},poll:{add(){}},ui:{},uci:{get:()=>null,load:()=>Promise.resolve()}};
  await check(lang+' status, devices and logs render selected language',async()=>{
   const state={success:true,running:true,online:true,backend_state:'Starting',raw:JSON.stringify({BackendState:'Starting'})};
   const view=load('status',{...env,rpc:{declare:()=>()=>Promise.resolve(state)}});
   const rendered=view.render();await view.updateStatus();
   assert.ok(text(rendered).includes(translate('Enable service')));
   assert.ok(text(rendered).includes(translate('Tailscale IP')));
   assert.equal(nodes.ts_running.textContent,translate('Running'));
   assert.equal(nodes.ts_login_desc.textContent,translate('Starting'));
   for(const name of ['peers','log']){
    const v=load(name,{...env,rpc:{declare:()=>()=>Promise.resolve({...state,log:'core original log'})},navigator:{}});
    const r=v.render();await new Promise(resolve=>setImmediate(resolve));
    assert.ok(text(r).includes(translate(name==='peers'?'Search name or IP':'Pause'))||r.children.some(c=>c.attrs?.placeholder===translate('Search name or IP')));
    if(name==='peers')assert.equal(nodes.ts_peer_updated.textContent,translate('Waiting for status'));
    else assert.equal(nodes.ts_log.textContent,'core original log');
   }
  });
  await check(lang+' settings labels and validation retain system language',async()=>{
   const labels=[],opts={};
   const section={option(type,name,title){labels.push(title);return opts[name]={value(){}};}};
   const form={Map:function(){this.section=(type,name,kind,title)=>{labels.push(title);return section;};this.render=()=>Promise.resolve(E('form',{},labels));}};
   const v=load('settings',{...env,form,rpc:{declare:()=>()=>Promise.resolve({})},validation:{parseIPv4,parseIPv6}});
   const r=await v.render();
   assert.ok(text(r).includes(translate('Connection and subnets')));
   assert.ok(labels.includes(translate("Share this router's local subnets")));
   assert.equal(opts.advertise_routes.validate('','192.168.123.0/24'),true);
   assert.equal(opts.advertise_routes.validate('','192.168.123.1/24'),translate('Enter a network address, for example 192.168.123.0/24, not 192.168.123.1/24.'));
  });
  await check(lang+' common backend errors translate without rewriting core diagnostics',async()=>{
   assert.equal(shared.output('Another Tailscale operation is still running.\nraw 100.90.126.80'),translate('Another Tailscale operation is still running.')+'\nraw 100.90.126.80');
   assert.equal(shared.state('NeedsMachineAuth'),translate('Awaiting device approval'));
   assert.equal(shared.state('future-core-state'),translate('Unknown'));
   assert.equal(shared.state('constructor'),translate('Unknown'));
   assert.equal(shared.message({running:true,success:false,error:'Status refresh is in progress.'}),translate('Status refresh is in progress.'));
  });
 }
 await check('time formatting follows LuCI language instead of browser default',async()=>{
  let locale;const doc={documentElement:{lang:'zh-cn'}};
  function DateMock(){this.toLocaleTimeString=value=>{locale=value;return '12:30';};}
  const shared=new Function('baseclass','E','L','_','document','Date',fs.readFileSync(path.join(dir,'../../tailscale/ui.js'),'utf8'))({extend:x=>x},E,L,x=>x,doc,DateMock);
  assert.equal(shared.updated(1),'Updated: 12:30');assert.equal(locale,'zh-cn');
  doc.documentElement.lang='en';shared.time(1);assert.equal(locale,'en');
  doc.documentElement.lang='';shared.time(1);assert.equal(locale,'en');
 });

 console.log(passed+' view tests passed.');
})().catch(e=>{console.error(e);process.exit(1);});
