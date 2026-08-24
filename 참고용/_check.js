
/* ---------------- view switching ---------------- */
const titles = {home:['대시보드','홈'],canvas:['파이프라인 편집기','파이프라인 › 고객 마스터 → S3'],
  monitor:['모니터링','실행 이력'],conn:['연결 관리','연결']};
document.getElementById('nav').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b)return;
  document.querySelectorAll('#nav button').forEach(x=>x.classList.remove('active'));
  b.classList.add('active');
  const v=b.dataset.v;
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
  document.getElementById('v-'+v).classList.add('active');
  document.getElementById('vtitle').textContent=titles[v][0];
  document.getElementById('vcrumb').textContent=titles[v][1];
  if(v==='canvas') requestAnimationFrame(drawEdges);
});

/* ---------------- HOME list ---------------- */
const svgs={
  db:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/></svg>',
  cdc:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>',
  sap:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/></svg>'
};
const pipelines=[
  {ic:'db',c:'#3b82f6',nm:'고객 마스터 → S3 (일배치)',ds:'MySDB.customers · 증분(updated_at)',flow:['MySQL','매핑','S3'],tag:'run',tl:'실행중',sc:'매일 02:00'},
  {ic:'sap',c:'#ea4b71',nm:'SAP 자재마스터 수집',ds:'RFC · BAPI_MATERIAL_GETLIST',flow:['SAP','필터','PostgreSQL'],tag:'ok',tl:'성공',sc:'매일 04:30'},
  {ic:'cdc',c:'#12b886',nm:'주문 CDC → DW',ds:'Debezium · orders(binlog) 실시간',flow:['MySQL','Kafka','DW'],tag:'ok',tl:'스트리밍',sc:'상시(CDC)'},
  {ic:'db',c:'#8b5cf6',nm:'재고 스냅샷 → S3',ds:'MSSQL.inventory · 전체 적재',flow:['MSSQL','매핑','S3'],tag:'fail',tl:'실패',sc:'매시 정각'},
  {ic:'db',c:'#3b82f6',nm:'회원 이벤트 로그 적재',ds:'MongoDB.events · change stream',flow:['MongoDB','필터','S3'],tag:'ok',tl:'성공',sc:'10분마다'},
  {ic:'db',c:'#f59e0b',nm:'정산 데이터 → PostgreSQL',ds:'PostgreSQL→PostgreSQL · upsert',flow:['PG','매핑','PG'],tag:'idle',tl:'비활성',sc:'수동'}
];
document.getElementById('homeList').innerHTML=pipelines.map(p=>`
  <div class="prow">
    <div class="picon" style="background:${p.c}">${svgs[p.ic]}</div>
    <div class="pmeta"><div class="nm">${p.nm}</div><div class="ds">${p.ds}</div></div>
    <div class="miniflow">${p.flow.map((f,i)=>`<span class="chip ${'abc'[i]}">${f}</span>`+(i<p.flow.length-1?'<span class="arw">▶</span>':'')).join('')}</div>
    <div class="schedule">🕑 ${p.sc}</div>
    <span class="tag ${p.tag}">${p.tl}</span>
  </div>`).join('');

/* ---------------- MONITOR rows ---------------- */
const runs=[
  ['#8842','고객 마스터 → S3','run','실행중','배치','128,400',72,'—','13:04:11'],
  ['#8841','주문 CDC → DW','ok','성공','CDC','실시간',100,'—','13:00:02'],
  ['#8840','SAP 자재마스터 수집','ok','성공','SAP RFC','42,118',100,'2m 08s','04:30:00'],
  ['#8839','재고 스냅샷 → S3','fail','실패','배치','0',18,'0m 12s','13:00:00'],
  ['#8838','회원 이벤트 로그 적재','ok','성공','CDC','9,022',100,'0m 44s','12:50:00'],
  ['#8837','정산 데이터 → PostgreSQL','ok','성공','배치','311,905',100,'3m 27s','12:00:00'],
  ['#8836','고객 마스터 → S3','ok','성공','배치','126,880',100,'1m 39s','02:00:00'],
];
const barc={ok:'var(--green)',run:'var(--blue)',fail:'var(--red)'};
document.getElementById('runRows').innerHTML=runs.map(r=>`
  <tr>
    <td class="mono" style="color:var(--muted)">${r[0]}</td>
    <td style="font-weight:600">${r[1]}</td>
    <td><span class="tag ${r[2]}">${r[3]}</span></td>
    <td style="color:#5b6070">${r[4]}</td>
    <td class="mono">${r[5]}</td>
    <td><span class="bar"><i style="width:${r[6]}%;background:${barc[r[2]]}"></i></span> <span class="mono" style="font-size:11px;color:var(--muted)">${r[6]}%</span></td>
    <td class="mono" style="color:#5b6070">${r[7]}</td>
    <td class="mono" style="color:var(--muted)">${r[8]}</td>
  </tr>`).join('');

/* ---------------- CONNECTIONS ---------------- */
const conns=[
  {ab:'My',c:'#00758f',nm:'운영 MySQL',host:'prod-mysql.internal:3306',kv:['MySQL 8.0','DB: shop','풀 20'],h:'ok',ht:'정상'},
  {ab:'PG',c:'#336791',nm:'분석 PostgreSQL',host:'analytics-pg.internal:5432',kv:['PostgreSQL 16','WAL 활성','풀 15'],h:'ok',ht:'정상'},
  {ab:'MS',c:'#a91d22',nm:'ERP MSSQL',host:'erp-mssql.internal:1433',kv:['SQL Server 2019','CDC on','풀 10'],h:'warn',ht:'지연'},
  {ab:'MG',c:'#12924a',nm:'이벤트 MongoDB',host:'events-mongo.internal:27017',kv:['MongoDB 7','replica set','oplog'],h:'ok',ht:'정상'},
  {ab:'SAP',c:'#ea4b71',nm:'SAP S/4HANA',host:'sap-prd · sysnr 00 · client 100',kv:['RFC','NW RFC SDK','SNC'],h:'ok',ht:'정상'},
  {ab:'S3',c:'#f59e0b',nm:'데이터레이크 S3',host:'s3://eai-datalake-prod',kv:['ap-northeast-2','Parquet','KMS'],h:'err',ht:'인증 필요'},
];
document.getElementById('connGrid').innerHTML=conns.map(c=>`
  <div class="conn">
    <div class="top"><div class="db" style="background:${c.c}">${c.ab}</div>
      <div><div class="nm">${c.nm}</div><div class="host">${c.host}</div></div></div>
    <div class="meta">${c.kv.map(k=>`<span class="kv">${k}</span>`).join('')}</div>
    <div class="foot"><span class="health ${c.h}"><span class="hd"></span>${c.ht}</span>
      <span class="link">테스트 · 편집</span></div>
  </div>`).join('')+`
  <div class="add-conn">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
    새 연결 추가</div>`;

/* ---------------- CANVAS: nodes + edges + drag ---------------- */
const wrap=document.getElementById('canvasWrap');
const svg=document.getElementById('svgEdges');
const cfg=document.getElementById('configPanel');
const nodeData=[
  {id:'trg',x:60,y:150,c:'var(--trig)',t:'스케줄 트리거',s:'매일 02:00 (KST)',foot:'Cron',stc:'var(--muted)',
   cic:svgs.cdc.replace('stroke-width="2"','stroke-width="2"'),
   fields:`<div class="field"><label>실행 주기 (Cron)</label><input value="0 2 * * *"><div class="hint">매일 새벽 2시 KST</div></div>
           <div class="field"><label>타임존</label><select><option>Asia/Seoul</option></select></div>`},
  {id:'src',x:320,y:150,c:'var(--src)',t:'MySQL — customers',s:'운영 MySQL · 증분',foot:'준비',stc:'var(--muted)',
   cic:svgs.db,
   fields:`<div class="field"><label>연결</label><select><option>운영 MySQL (prod)</option></select></div>
           <div class="field"><label>테이블</label><input value="customers"></div>
           <div class="field"><label>적재 모드</label><select><option>증분 (Incremental)</option><option>전체 (Full)</option></select></div>
           <div class="field"><label>증분 키</label><input value="updated_at"><div class="hint">워터마크 기준 컬럼</div></div>`},
  {id:'map',x:560,y:150,c:'var(--tr)',t:'필드 매핑',s:'12개 컬럼 매핑',foot:'준비',stc:'var(--muted)',
   cic:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h5l3-7 4 14 3-7h3"/></svg>',
   fields:`<div class="field"><label>컬럼 매핑</label>
     <div class="map-row"><span class="mi">cust_id</span><span class="ar">→</span><span class="mi">customer_id</span></div>
     <div class="map-row"><span class="mi">cust_nm</span><span class="ar">→</span><span class="mi">name</span></div>
     <div class="map-row"><span class="mi">reg_dt</span><span class="ar">→</span><span class="mi">registered_at</span></div>
     <div class="hint">+ 9개 더</div></div>`},
  {id:'tgt',x:800,y:150,c:'var(--amber)',t:'Amazon S3',s:'Parquet · 일자 파티션',foot:'준비',stc:'var(--muted)',
   cic:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/></svg>',
   fields:`<div class="field"><label>연결</label><select><option>데이터레이크 S3</option></select></div>
           <div class="field"><label>버킷 경로</label><input value="s3://eai-datalake-prod/customers"></div>
           <div class="field"><label>포맷</label><select><option>Parquet</option><option>CSV</option><option>JSON</option></select></div>
           <div class="field"><label>파티션</label><input value="dt=YYYY-MM-DD"></div>`}
];
const edges=[['trg','src'],['src','map'],['map','tgt']];
let selected='src';

function renderNodes(){
  nodeData.forEach(n=>{
    const el=document.createElement('div');
    el.className='node'+(n.id===selected?' sel':'');
    el.id='node-'+n.id;
    el.style.left=n.x+'px'; el.style.top=n.y+'px';
    el.innerHTML=`
      <span class="port in"></span><span class="port out"></span>
      <div class="nhd"><div class="nic" style="background:${n.c}">${n.cic}</div>
        <div><div class="ntt">${n.t}</div><div class="nsub">${n.s}</div></div></div>
      <div class="nfoot"><span class="st" style="background:${n.stc}"></span>${n.foot}</div>`;
    wrap.appendChild(el);
    makeDraggable(el,n);
    el.addEventListener('click',ev=>{ if(el.dataset.moved==='1'){el.dataset.moved='0';return;}
      selected=n.id; document.querySelectorAll('.node').forEach(x=>x.classList.remove('sel'));
      el.classList.add('sel'); renderConfig(); });
  });
  drawEdges();
}
function nodeCenter(id){const n=nodeData.find(x=>x.id===id);return {x:n.x,y:n.y};}
function drawEdges(){
  const W=172,H=78;
  svg.innerHTML=edges.map(([a,b])=>{
    const na=nodeData.find(x=>x.id===a),nb=nodeData.find(x=>x.id===b);
    const x1=na.x+W,y1=na.y+H/2, x2=nb.x,y2=nb.y+H/2;
    const dx=Math.max(40,Math.abs(x2-x1)*0.5);
    return `<path d="M${x1},${y1} C${x1+dx},${y1} ${x2-dx},${y2} ${x2},${y2}" fill="none" stroke="#b9bece" stroke-width="2.5"/>
            <circle cx="${(x1+x2)/2}" cy="${(y1+y2)/2}" r="10" fill="#fff" stroke="#d7dae4"/>
            <path d="M${(x1+x2)/2-3},${(y1+y2)/2-4} l5,4 -5,4" fill="none" stroke="#9aa0af" stroke-width="1.6"/>`;
  }).join('');
}
function makeDraggable(el,n){
  let sx,sy,ox,oy,drag=false;
  el.addEventListener('mousedown',e=>{
    if(e.target.classList.contains('port'))return;
    drag=true; sx=e.clientX; sy=e.clientY; ox=n.x; oy=n.y; el.style.cursor='grabbing'; el.dataset.moved='0';
    e.preventDefault();
  });
  window.addEventListener('mousemove',e=>{
    if(!drag)return;
    const nx=ox+(e.clientX-sx), ny=oy+(e.clientY-sy);
    if(Math.abs(e.clientX-sx)+Math.abs(e.clientY-sy)>3) el.dataset.moved='1';
    n.x=Math.max(0,nx); n.y=Math.max(0,ny);
    el.style.left=n.x+'px'; el.style.top=n.y+'px'; drawEdges();
  });
  window.addEventListener('mouseup',()=>{ if(drag){drag=false; el.style.cursor='grab';} });
}
function renderConfig(){
  const n=nodeData.find(x=>x.id===selected);
  cfg.innerHTML=`
    <div class="ch"><div class="cic" style="background:${n.c}">${n.cic}</div>
      <div><div class="ct">${n.t}</div><div class="csub">노드 설정</div></div></div>
    ${n.fields}
    <div class="cfoot"><button class="btn primary" style="width:100%;justify-content:center">저장</button></div>`;
}
renderNodes(); renderConfig();
