<script type="text/x-dc" data-dc-script="" data-props="{"palette":{"editor":"enum","options":["Purple & Gold","League Red & Blue","Green & Gold"],"default":"Purple & Gold","tsType":"string"},"courtLines":{"editor":"boolean","default":true,"tsType":"boolean"},"alertPace":{"editor":"enum","options":["Live","Calm"],"default":"Live","tsType":"string"}}">
class Component extends DCLogic {
  canvasRef = React.createRef();
  scrollRef = React.createRef();
  aid = 0;
  timers = [];
  D = {
    groups: [
      { name: 'SOCIAL', items: [['instagram','Instagram','IG','DMs, stories, birthdays'],['linkedin','LinkedIn','IN','Job changes and posts'],['x','X','X','Mentions and DMs'],['facebook','Facebook','FB','Birthdays and events'],['threads','Threads','TH','Replies and mentions'],['tiktok','TikTok','TT','DMs and shares']] },
      { name: 'MEETING RECORDINGS', items: [['fathom','Fathom','FA','Call recordings and notes'],['zoom','Zoom','ZM','Meetings and transcripts'],['meet','Google Meet','GM','Transcripts and attendees'],['otter','Otter','OT','Notes and highlights']] },
      { name: 'MAIL & CALENDAR', items: [['gmail','Gmail','GM','Threads and contacts'],['gcal','Google Calendar','GC','Events and invites'],['outlook','Outlook','OL','Mail and calendar'],['icloud','iCloud Contacts','IC','Birthdays and addresses']] },
      { name: 'EVENTS', items: [['partiful','Partiful','PA','Parties and RSVPs'],['luma','Luma','LU','Events and guest lists'],['eventbrite','Eventbrite','EB','Tickets and events'],['calendly','Calendly','CA','Bookings']] }
    ],
    channels: [
      { id:'telegram', name:'Telegram', mono:'TG', handle:'@KobeAgentBot', hasCode:true, cta:"I've sent the code", steps:['Open @KobeAgentBot in Telegram','Send the pairing code below','Kobe confirms and starts answering in your DMs'] },
      { id:'whatsapp', name:'WhatsApp', mono:'WA', handle:'+1 415 555 0142', hasCode:true, cta:"I've sent the code", steps:['Save Kobe as a contact','Send the pairing code on WhatsApp','Forward any chat to Kobe for context'] },
      { id:'teams', name:'Microsoft Teams', mono:'MT', handle:'Kobe for Teams', hasCode:false, cta:'Install app', steps:['Approve the Kobe app in your tenant','Pin Kobe to your Teams sidebar','Kobe reads invites and chats you share'] },
      { id:'slack', name:'Slack', mono:'SL', handle:'Add to workspace', hasCode:false, cta:'Add to Slack', steps:['Pick a workspace','Approve access to DMs and channels you choose','Message @kobe in any thread'] },
      { id:'discord', name:'Discord', mono:'DC', handle:'Invite to server', hasCode:false, cta:'Invite Kobe', steps:['Choose a server you manage','Grant read access in selected channels','Use /kobe brief @name anywhere'] }
    ],
    records: {
      maya: { name:'Maya Chen', role:'College roommate', tier:'STARTING FIVE', score:82, birthday:'Oct 5 · tomorrow · turns 29', last:'Instagram DM · 6 weeks ago', next:'Nothing scheduled', points:['Moved to Brooklyn in August','Training for the NYC Half in March','Favorite spot: Bunna Cafe'], loop:'She asked for your running playlist.', sources:['INSTAGRAM','GMAIL'], action:'Draft birthday message', prompt:'Draft a birthday message for Maya' },
      marcus: { name:'Marcus Reid', role:'Former manager · mentor', tier:'ROTATION', score:74, birthday:'Feb 11', last:'Fathom call · Sep 12', next:'Coffee today 3:30 PM · Blue Bottle', points:['Relocated to Austin in August','Daughter just started kindergarten','Thinking about advising early-stage teams'], loop:'You promised an intro to Lena Ortiz.', sources:['FATHOM','GMAIL','GOOGLE CALENDAR'], action:'Brief me again', prompt:'Brief me on Marcus' },
      jordan: { name:'Jordan Blake', role:'Friend from rec league', tier:'STARTING FIVE', score:88, birthday:'Oct 9', last:'Partiful RSVP · 4 days ago', next:'Dinner Thu 7:00 PM · Nopa', points:['Just adopted a dog named Biscuit','Tore an ACL in June, back on court now','Hosting the dinner for 6'], loop:'Thursday dinner clashes with Product sync.', sources:['PARTIFUL','INSTAGRAM'], action:'Fix Thursday conflict', prompt:'Fix my Thursday conflict' },
      priya: { name:'Priya Nair', role:'Ex-colleague', tier:'BENCH', score:61, birthday:'Oct 13', last:'LinkedIn like · 2 months ago', next:'Nothing scheduled', points:['Started as Head of Design at Northwind','Ran her first marathon last spring','Prefers voice notes over texts'], loop:'You both said "coffee soon" in July.', sources:['LINKEDIN','GMAIL'], action:'Draft congrats', prompt:'Draft congrats to Priya' },
      dev: { name:'Dev Patel', role:'Cousin', tier:'STARTING FIVE', score:79, birthday:'Jan 22', last:'WhatsApp · 9 days ago (unanswered)', next:'Family dinner Oct 18', points:['Asked if you can help him move on the 17th','Started a new job at a robotics lab','Rooting hard for the home team this season'], loop:'Reply about helping him move.', sources:['WHATSAPP','GOOGLE CALENDAR'], action:'Draft reply', prompt:'Draft a reply to Dev' }
    },
    feed: [
      { at:1400, kind:'BIRTHDAY', source:'INSTAGRAM', color:'#F2B63A', title:'Maya Chen turns 29 tomorrow', body:"You last talked 6 weeks ago. She's been posting from Brooklyn.", a1:{label:'Draft message', run:'Draft a birthday message for Maya'}, a2:{label:'Open record', record:'maya'} },
      { at:4200, kind:'PREGAME', source:'FATHOM', color:'#9B6CE0', title:'Coffee with Marcus Reid at 3:30', body:'Last call Sep 12. He moved to Austin, and you owe him an intro.', a1:{label:'Brief me', run:'Brief me on Marcus'}, a2:{label:'Snooze'} },
      { at:8500, kind:'CONFLICT', source:'PARTIFUL × CALENDAR', color:'#E5484D', title:'Double-booked Thursday 7:00 PM', body:'Dinner with Jordan overlaps Product sync.', a1:{label:'Resolve', run:'Fix my Thursday conflict'}, a2:{label:'Keep both'} },
      { at:15000, kind:'FOLLOW UP', source:'WHATSAPP', color:'#E0712A', title:"Dev hasn't heard back in 9 days", body:'He asked if you can help him move on the 17th.', a1:{label:'Draft reply', run:'Draft a reply to Dev'}, a2:{label:'Open record', record:'dev'} },
      { at:24000, kind:'LIFE UPDATE', source:'LINKEDIN', color:'#3DBE8B', title:'Priya Nair started a new role', body:'Head of Design at Northwind. You said "coffee soon" in July.', a1:{label:'Congratulate', run:'Draft congrats to Priya'}, a2:{label:'Open record', record:'priya'} }
    ]
  };
  state = {
    input:'', typing:false, modal:null, record:null, pairing:'telegram', pairBusy:false,
    sources:{ gmail:true, gcal:true, instagram:true, fathom:true },
    channels:{},
    alerts:[],
    messages:[{ id:1, role:'agent', text:"Morning. Three things need you today. They'll pop up as they come in, or ask me about anyone." }]
  };

  componentDidMount() { this.onResize = () => this.setState({ vw: window.innerWidth }); window.addEventListener('resize', this.onResize); this.onResize(); this.initGL(); const k = this.props.alertPace === 'Calm' ? 2.5 : 1; this.D.feed.forEach(f => this.later(() => this.pushAlert(f), f.at * k)); }
  componentWillUnmount() { clearInterval(this.recInt); window.removeEventListener('resize', this.onResize); cancelAnimationFrame(this.raf); this.timers.forEach(clearTimeout); }
  componentDidUpdate(pp, ps) {
    if (ps.messages.length !== this.state.messages.length || ps.typing !== this.state.typing) {
      const el = this.scrollRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }
  later(fn, ms) { this.timers.push(setTimeout(fn, ms)); }
  pushAlert(a) {
    const id = ++this.aid;
    this.setState(s => ({ alerts: [...s.alerts, { ...a, id, visible: true }] }));
    if (a.auto) this.later(() => this.dismiss(id), 4200);
  }
  dismiss(id) { this.setState(s => ({ alerts: s.alerts.map(x => x.id === id ? { ...x, visible: false } : x) })); }
  act(a, act) {
    this.dismiss(a.id);
    if (!act) return;
    if (act.run) this.runAgent(act.run);
    if (act.record) this.setState({ record: act.record });
  }
  sync(title, body, source) { this.pushAlert({ kind:'SYNCED', source, color:'#3DBE8B', title, body, auto:true }); }

  runAgent(text) {
    if (!text || !text.trim()) return;
    const id = Date.now();
    this.setState(s => ({ input:'', typing:true, messages:[...s.messages, { id, role:'user', text }] }));
    this.later(() => {
      const r = this.reply(text);
      this.setState(s => ({ typing:false, messages:[...s.messages, { id:id + 1, role:'agent', ...r }] }));
    }, 900 + Math.random() * 600);
  }
  person(id, meta, right) { const r = this.D.records[id]; return { id, name:r.name, initials:r.name.split(' ').map(w => w[0]).join(''), meta, right }; }
  reply(text) {
    const t = text.toLowerCase();
    const R = this.D.records;
    if (/maya/.test(t) && /(draft|message|write)/.test(t)) return { text:'Kept it warm and specific. She posted from a Brooklyn run club last week.', draft:{ to:'Maya Chen', channel:'Instagram', body:'Happy birthday Maya! 29 looks good on you. Hope Brooklyn is treating you right. Send me that half marathon training plan, I want in.' } };
    if (/\bdev\b/.test(t)) return { text:'He asked about the 17th. Your calendar is open that morning.', draft:{ to:'Dev Patel', channel:'WhatsApp', body:"Sorry for the slow reply! I'm free the morning of the 17th, count me in for the move. I'll bring the truck playlist." } };
    if (/priya/.test(t)) return { text:'She prefers voice notes, but here is a text version.', draft:{ to:'Priya Nair', channel:'LinkedIn', body:'Huge congrats on Head of Design at Northwind! Well deserved. Coffee soon for real this time? My treat.' } };
    if (/(thursday|conflict|double|resolve)/.test(t)) return { text:'Thursday 7:00 PM has Dinner with Jordan (Partiful) and Product sync (Google Calendar). The sync has a free 5:30 slot. I can ask Jordan to keep 7:00 and move the sync, or push dinner to 8:00.', draft:{ to:'Jordan Blake', channel:'WhatsApp', body:"Hey! Still on for Thursday. Any chance we push to 8? Work thing ran over. I'll bring dessert for Biscuit's welcome party." } };
    if (/birthday/.test(t)) return { text:'Three birthdays in the next 10 days.', people:[this.person('maya','College roommate · Instagram','TOMORROW'), this.person('jordan','Rec league · Partiful','OCT 9'), this.person('priya','Ex-colleague · LinkedIn','OCT 13')] };
    if (/(marcus|brief|coffee|pregame)/.test(t)) { const m = R.marcus; return { text:"Here's your pregame for 3:30. Pulled from your Sep 12 Fathom call and Gmail.", brief:{ id:'marcus', name:m.name, next:m.next, points:m.points, loop:m.loop } }; }
    if (/(lately|haven|talk|lost touch|catch up)/.test(t)) return { text:'These people are cooling off.', people:[this.person('dev','Unanswered WhatsApp','9 DAYS'), this.person('priya','Last LinkedIn like','2 MO'), this.person('maya','Last Instagram DM','6 WK')] };
    const names = this.connectedNames();
    return { text:`I checked ${names.join(', ')} and found nothing new on that. Connect more sources in Integrations to widen what I can see.` };
  }
  connectedNames() {
    const out = [];
    this.D.groups.forEach(g => g.items.forEach(([id, name]) => { if (this.state.sources[id]) out.push(name); }));
    return out;
  }
  startRec() {
    this.setState({ rec: true, recSec: 0 });
    this.recInt = setInterval(() => this.setState(s => ({ recSec: s.recSec + 1 })), 1000);
  }
  stopRec(send) {
    clearInterval(this.recInt);
    this.setState({ rec: false, recSec: 0 });
    if (send) {
      const lines = ['Who should I check in with this week?', 'Brief me on Marcus before coffee', 'Any birthdays coming up?', 'Do I have conflicts on Thursday?'];
      this.runAgent('🎙 ' + lines[(this.vi = ((this.vi ?? -1) + 1) % lines.length)]);
    }
  }
  sendDraft(mid) {
    const m = this.state.messages.find(x => x.id === mid);
    this.setState(s => ({ messages: s.messages.map(x => x.id === mid ? { ...x, sent:true } : x) }));
    if (m) this.pushAlert({ kind:'SENT', source:m.draft.channel.toUpperCase(), color:'#3DBE8B', title:`Message sent to ${m.draft.to}`, body:'Logged to their record. Rapport +3.', auto:true });
  }
  toggleSource(id, name) {
    const on = !this.state.sources[id];
    this.setState(s => ({ sources: { ...s.sources, [id]: on } }));
    if (on) this.sync(`${name} connected`, 'Backfilling the last 12 months. New context will show up on records.', name.toUpperCase());
  }
  pair() {
    const id = this.state.pairing;
    const ch = this.D.channels.find(c => c.id === id);
    this.setState({ pairBusy:true });
    this.later(() => {
      this.setState(s => ({ pairBusy:false, channels: { ...s.channels, [id]: true } }));
      this.sync(`Kobe joined ${ch.name}`, 'Message Kobe there anytime. Alerts will follow you.', ch.name.toUpperCase());
    }, 1500);
  }

  initGL() {
    if (this.glOn) return;
    const c = this.canvasRef.current;
    if (!c) { this.raf = requestAnimationFrame(() => this.initGL()); return; }
    const gl = c.getContext('webgl'); if (!gl) return;
    this.glOn = true;
    const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
    const fs = `precision highp float;
uniform vec2 r;uniform float t;uniform vec3 A;uniform vec3 B;uniform float L;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(p);p=p*2.03+1.7;a*=.5;}return v;}
float ln(float d,float w){return 1.-smoothstep(w,w+1.5/r.y,abs(d));}
void main(){
 vec2 s=gl_FragCoord.xy/r;float asp=r.x/r.y;vec2 uv=vec2(s.x*asp,s.y);
 vec2 p=uv*14.;float row=floor(p.y);
 float px=p.x/4.+h(vec2(row,3.1));float col=floor(px);vec2 id=vec2(col,row);
 vec2 lp=vec2(fract(px),fract(p.y));
 float g=fbm(vec2(p.x*.45,p.y*9.)+id*13.7);
 float rings=.5+.5*sin(p.y*30.+g*9.+h(id)*30.);
 vec3 c=mix(vec3(.47,.27,.13),vec3(.80,.55,.31),.35+.5*h(id+.3));
 c*=.82+.3*g;c=mix(c,c*.86,rings*.35);
 float seam=smoothstep(0.,.05,lp.y)*smoothstep(1.,.95,lp.y)*smoothstep(0.,.006,lp.x)*smoothstep(1.,.994,lp.x);
 c*=mix(.6,1.,seam);
 vec2 q=vec2(uv.x-asp*.5,uv.y);
 float paint=step(abs(q.x),.24)*step(q.y,.58);
 c=mix(c,c*.5+A*.5,paint*.55*L);
 float li=ln(length(q-vec2(0.,-.02))-.86,.003);
 li=max(li,ln(length(q-vec2(0.,.58))-.24,.003)*step(.58,q.y));
 li=max(li,ln(abs(q.x)-.24,.003)*step(q.y,.58));
 li=max(li,ln(q.y-.58,.003)*step(abs(q.x),.24));
 c=mix(c,vec3(.95,.92,.85),li*.55*L);
 float g1=exp(-3.2*length(s-vec2(.18+.06*sin(t*.21),.92)));
 float g2=exp(-3.*length(s-vec2(.88,.12+.05*cos(t*.17))));
 float sw=exp(-pow((s.x+s.y*.3-fract(t*.025)*2.2+.4)*5.,2.))*.06;
 c*=.48;c+=A*g2*.6+B*g1*.38+sw;
 c*=1.-.55*pow(length(s-.5)*1.2,2.);
 gl_FragColor=vec4(c,1.);}`;
    const mk = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); return sh; };
    const pr = gl.createProgram();
    gl.attachShader(pr, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { console.warn('Kobe shader link failed', gl.getProgramInfoLog(pr)); return; }
    gl.useProgram(pr);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = k => gl.getUniformLocation(pr, k);
    const uR = U('r'), uT = U('t'), uA = U('A'), uB = U('B'), uL = U('L');
    const P = { 'Purple & Gold':[[.42,.2,.72],[1,.72,.15]], 'League Red & Blue':[[.11,.26,.62],[.85,.08,.2]], 'Green & Gold':[[0,.5,.25],[.95,.75,.2]] };
    const t0 = performance.now();
    const loop = () => {
      const d = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.floor((c.clientWidth || window.innerWidth) * d)), hh = Math.max(1, Math.floor((c.clientHeight || window.innerHeight) * d));
      if (c.width !== w || c.height !== hh) { c.width = w; c.height = hh; gl.viewport(0, 0, w, hh); }
      const pal = P[this.props.palette] || P['Purple & Gold'];
      gl.uniform2f(uR, w, hh); gl.uniform1f(uT, (performance.now() - t0) / 1000);
      gl.uniform3fv(uA, pal[0]); gl.uniform3fv(uB, pal[1]); gl.uniform1f(uL, this.props.courtLines === false ? 0 : 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  }

  renderVals() {
    const s = this.state, D = this.D;
    const connectedCount = Object.values(s.sources).filter(Boolean).length;
    const channelCount = Object.values(s.channels).filter(Boolean).length;
    const visible = s.alerts.filter(a => a.visible).length;
    const wide = (s.vw || 1200) >= 1000;
    const lane = wide
      ? { chatTop:'68px', chatRight:'380px', laneTop:'76px', laneBottom:'104px', laneRight:'20px', laneW:'340px', laneMask:'linear-gradient(#000 calc(100% - 24px), transparent)' }
      : { chatTop:'284px', chatRight:'0px', laneTop:'72px', laneBottom:'calc(100vh - 280px)', laneRight:'16px', laneW:'calc(100vw - 32px)', laneMask:'none' };
    const ordered = [...s.alerts].reverse();
    let shown = 0;
    const laneAlerts = ordered.map(a => { const v = a.visible && (wide || shown++ < 1); return { ...a, visible: v }; });
    const pcRaw = D.channels.find(c => c.id === s.pairing) || D.channels[0];
    const added = !!s.channels[pcRaw.id];
    const rr = s.record ? D.records[s.record] : null;
    const tab = (on) => ({ bg: on ? '#F4F1EC' : 'transparent', fg: on ? '#15110D' : '#D3CBC0' });
    const ts = tab(s.modal === 'sources'), tc = tab(s.modal === 'channels');
    return {
      canvasRef: this.canvasRef, scrollRef: this.scrollRef,
      connectedCount, channelCount, hasChannels: channelCount > 0,
      chips: ['Who has a birthday this week?','Brief me on Marcus','Any conflicts this week?',"Who haven't I talked to lately?"].map(label => ({ label, run: () => this.runAgent(label) })),
      messages: s.messages.map(m => ({
        ...m, isAgent: m.role === 'agent', isUser: m.role === 'user',
        hasPeople: !!m.people, hasBrief: !!m.brief, hasDraft: !!m.draft,
        people: (m.people || []).map(p => ({ ...p, onOpen: () => this.setState({ record: p.id }) })),
        onBrief: () => m.brief && this.setState({ record: m.brief.id }),
        draftOpen: !m.sent, draftSent: !!m.sent,
        onSend: () => this.sendDraft(m.id),
        onEdit: () => this.setState({ input: m.draft ? m.draft.body : '' })
      })),
      typing: s.typing,
      input: s.input,
      onInput: e => this.setState({ input: e.target.value }),
      onKey: e => { if (e.key === 'Enter') this.runAgent(s.input); },
      onSend: () => this.runAgent(s.input),
      ...lane,
      isRec: !!s.rec, notRec: !s.rec,
      recTime: `0:${String(s.recSec || 0).padStart(2, '0')}`,
      bars: this.bars || (this.bars = Array.from({ length: 28 }, (_, i) => ({ dur: (0.6 + ((i * 37) % 9) / 12).toFixed(2) + 's', delay: (-((i * 53) % 10) / 10).toFixed(2) + 's' }))),
      toggleRec: () => s.rec ? this.stopRec(true) : this.startRec(),
      cancelRec: () => this.stopRec(false),
      micTitle: s.rec ? 'Stop and send' : 'Voice message',
      micBg: s.rec ? '#E5484D' : 'rgba(255,255,255,.06)',
      micBorder: s.rec ? '#E5484D' : 'rgba(255,255,255,.14)',
      micFg: s.rec ? '#fff' : '#F4F1EC',
      micAnim: s.rec ? 'kring 1.2s ease-out infinite' : 'none',
      alerts: laneAlerts.map(a => ({
        ...a, a1: a.a1 && a.a1.label, a2: a.a2 && a.a2.label, hasActions: !!a.a1, hasA2: !!a.a2,
        onA1: () => this.act(a, a.a1), onA2: () => this.act(a, a.a2), onDismiss: () => this.dismiss(a.id)
      })),
      showClear: visible > 1, visibleCount: visible,
      clearAlerts: () => this.setState(st => ({ alerts: st.alerts.map(a => ({ ...a, visible: false })) })),
      modalOpen: !!s.modal, isSources: s.modal === 'sources', isChannels: s.modal === 'channels',
      openSources: () => this.setState({ modal: 'sources' }),
      openChannels: () => this.setState({ modal: 'channels' }),
      closeModal: () => this.setState({ modal: null }),
      stop: e => e.stopPropagation(),
      tabSrcBg: ts.bg, tabSrcFg: ts.fg, tabChBg: tc.bg, tabChFg: tc.fg,
      sourceGroups: D.groups.map(g => ({ name: g.name, items: g.items.map(([id, name, mono, desc]) => {
        const on = !!s.sources[id];
        return { id, name, mono, desc, toggle: () => this.toggleSource(id, name),
          border: on ? 'rgba(242,182,58,.45)' : 'rgba(255,255,255,.08)',
          monoBg: on ? '#F2B63A' : 'rgba(255,255,255,.07)', monoFg: on ? '#15110D' : '#CFC7BB',
          trackBg: on ? '#F2B63A' : 'rgba(255,255,255,.16)', knob: on ? '18px' : '2px' };
      }) })),
      channelList: D.channels.map(c => {
        const sel = c.id === s.pairing, on = !!s.channels[c.id];
        return { ...c, select: () => this.setState({ pairing: c.id, pairBusy: false }),
          bg: sel ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.025)',
          border: sel ? 'rgba(242,182,58,.5)' : 'rgba(255,255,255,.07)',
          status: on ? 'LIVE' : 'ADD', statusFg: on ? '#3DBE8B' : '#A39A8E' };
      }),
      pc: { ...pcRaw, code: 'KB-4821', steps: pcRaw.steps.map((text, i) => ({ n: i + 1, text })) },
      pairIdle: !added && !s.pairBusy, pairBusy: s.pairBusy, pairAdded: added,
      pair: () => this.pair(),
      unpair: () => this.setState(st => ({ channels: { ...st.channels, [pcRaw.id]: false } })),
      hasRecord: !!rr,
      rec: rr ? { ...rr, onDraft: () => { this.setState({ record: null }); this.runAgent(rr.prompt); } } : {},
      closeRecord: () => this.setState({ record: null })
    };
  }
}
</script>