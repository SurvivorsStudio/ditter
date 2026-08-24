
/* ------- data ------- */
const conns=[
  {ab:'My',c:'#00758f',nm:'운영 MySQL',type:'MySQL',cat:'RDB',host:'prod-mysql.internal:3306 · shop',h:'ok',ht:'정상',pool:'14 / 20',pp:70,used:'8개 파이프라인',cdc:true,test:'2분 전'},
  {ab:'PG',c:'#336791',nm:'분석 PostgreSQL',type:'PostgreSQL',cat:'RDB',host:'analytics-pg.internal:5432 · dw',h:'ok',ht:'정상',pool:'6 / 15',pp:40,used:'5개 파이프라인',cdc:true,test:'5분 전'},
  {ab:'MS',c:'#a91d22',nm:'ERP MSSQL',type:'MSSQL',cat:'RDB',host:'erp-mssql.internal:1433 · erp',h:'warn',ht:'응답 지연',pool:'9 / 10',pp:90,used:'3개 파이프라인',cdc:true,test:'11분 전'},
  {ab:'MG',c:'#12924a',nm:'이벤트 MongoDB',type:'MongoDB',cat:'NoSQL',host:'events-mongo.internal:27017',h:'ok',ht:'정상',pool:'4 / 12',pp:33,used:'2개 파이프라인',cdc:false,test:'1분 전'},
  {ab:'SAP',c:'#ea4b71',nm:'SAP S/4HANA',type:'SAP RFC',cat:'SAP',host:'sap-prd · sysnr 00 · client 100',h:'ok',ht:'정상',pool:'5 / 8',pp:63,used:'4개 파이프라인',cdc:false,test:'8분 전'},
  {ab:'S3',c:'#f59e0b',nm:'데이터레이크 S3',type:'Amazon S3',cat:'Object',host:'s3://eai-datalake-prod · ap-northeast-2',h:'err',ht:'인증 필요',pool:'—',pp:0,used:'9개 파이프라인',cdc:false,test:'실패'},
];
const eye='<svg class="eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
document.getElementById('rows').innerHTML=conns.map((c,i)=>`
  <tr onclick="openDrawer(${i})">
    <td><div class="cn"><div class="db" style="background:${c.c}">${c.ab}</div>
      <div><div class="nm">${c.nm}</div><div class="host">${c.host}</div></div></div></td>
    <td><span class="typebadge">${c.type}</span>${c.cdc?'<span class="cdc-chip">CDC</span>':''}</td>
    <td><span class="health ${c.h}"><span class="hd"></span>${c.ht}</span></td>
    <td>${c.pool==='—'?'<span class="pool">—</span>':`<div class="pool">${c.pool}</div><div class="poolbar"><i style="width:${c.pp}%;background:${c.pp>85?'var(--red)':'var(--blue)'}"></i></div>`}</td>
    <td><span class="usedby">${c.used}</span></td>
    <td><span class="pool">${c.test}</span></td>
    <td onclick="event.stopPropagation()"><div class="rowacts">
      <div class="iact" title="테스트" onclick="openDrawer(${i})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></div>
      <div class="iact" title="편집" onclick="openDrawer(${i})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></div>
      <div class="iact danger" title="삭제"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></div>
    </div></td>
  </tr>`).join('');

/* ------- drawer + dynamic form ------- */
const types=[
  {k:'MySQL',ab:'My',c:'#00758f',d:'RDB · 배치+CDC'},
  {k:'PostgreSQL',ab:'PG',c:'#336791',d:'RDB · 배치+CDC'},
  {k:'MSSQL',ab:'MS',c:'#a91d22',d:'RDB · 배치+CDC'},
  {k:'MongoDB',ab:'MG',c:'#12924a',d:'NoSQL · 배치+CDC'},
  {k:'SAP RFC',ab:'SAP',c:'#ea4b71',d:'ERP · RFC/BAPI'},
  {k:'Amazon S3',ab:'S3',c:'#f59e0b',d:'Object · 타깃'},
];
let curType='MySQL';
document.getElementById('typegrid').innerHTML=types.map(t=>`
  <div class="typecard" data-k="${t.k}" onclick="pickType('${t.k}')">
    <div class="ti" style="background:${t.c}">${t.ab}</div><div class="tn">${t.k}</div><div class="td">${t.d}</div></div>`).join('');

function fieldsFor(t){
  const P=(l,ph,req,val='',half=false)=>`<div class="field${half?' half':''}"><label>${l}${req?' <span class="req">*</span>':''}</label><input placeholder="${ph}" value="${val}"></div>`;
  const PW=`<div class="field"><label>비밀번호 <span class="req">*</span></label><div class="pw"><input type="password" value="············">${eye}</div><div class="hint">🔒 KMS로 암호화되어 저장됩니다</div></div>`;
  if(t==='SAP RFC') return P('App Server (ashost)','sap-prd.internal',true)+P('System No (sysnr)','00',true,'',true)+P('Client (mandt)','100',true,'',true)+P('사용자','RFC_USER',true)+PW+`<div class="field"><label>보안</label><select><option>SNC (권장)</option><option>기본 (평문)</option></select></div>`;
  if(t==='Amazon S3') return `<div class="field"><label>리전</label><select><option>ap-northeast-2 (서울)</option><option>us-east-1</option></select></div>`+P('버킷','eai-datalake-prod',true)+P('기본 경로(Prefix)','raw/','',)+`<div class="field"><label>인증</label><select><option>IAM Role (권장)</option><option>Access Key</option></select></div>`;
  if(t==='MongoDB') return P('호스트','events-mongo.internal',true,'',true)+P('포트','27017',true,'27017',true)+P('데이터베이스','events',true)+P('사용자','app_user',true)+PW+P('Replica Set','rs0','');
  // RDB default
  const defPort=t==='PostgreSQL'?'5432':t==='MSSQL'?'1433':'3306';
  return P('호스트','db.internal',true,'',true)+P('포트',defPort,true,defPort,true)+P('데이터베이스','shop',true)+P('사용자','app_user',true)+PW;
}
function pickType(k){
  curType=k;
  document.querySelectorAll('.typecard').forEach(c=>c.classList.toggle('on',c.dataset.k===k));
  document.getElementById('dynFields').innerHTML=fieldsFor(k);
  const cdcOn=['MySQL','PostgreSQL','MSSQL','MongoDB'].includes(k);
  document.getElementById('cdcSection').classList.toggle('hidden',!cdcOn);
  const hints={MySQL:'binlog 기반 변경 이벤트 스트리밍',PostgreSQL:'WAL(logical decoding) 기반',MSSQL:'CDC 테이블 기반',MongoDB:'oplog / change stream 기반'};
  if(cdcOn) document.getElementById('cdcHint').textContent=hints[k];
  resetTest();
}
function openDrawer(i){
  if(typeof i==='number'){const c=conns[i];document.getElementById('dtt').textContent=c.nm+' 편집';
    document.getElementById('dss').textContent=c.type+' 연결 · '+c.used;pickType(c.type);document.getElementById('f_name').value=c.nm;}
  else{document.getElementById('dtt').textContent='새 연결 추가';document.getElementById('dss').textContent='소스/타깃 저장소 연결 정보를 등록합니다';pickType('MySQL');document.getElementById('f_name').value='';}
  document.getElementById('scrim').classList.add('open');document.getElementById('drawer').classList.add('open');
}
function closeDrawer(){document.getElementById('scrim').classList.remove('open');document.getElementById('drawer').classList.remove('open');resetTest();}
function resetTest(){const b=document.getElementById('testbox');b.className='testbox';b.innerHTML='';}
function runTest(){
  const b=document.getElementById('testbox');
  b.className='testbox load show';b.innerHTML='<span class="ic"><span class="spin"></span></span><div><b>연결 확인 중…</b>호스트 도달성 · 인증 · 권한 검사</div>';
  setTimeout(()=>{
    if(curType==='Amazon S3'){b.className='testbox err show';
      b.innerHTML='<span class="ic"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg></span><div><b>인증 실패 (403 AccessDenied)</b>IAM 권한을 확인하세요. s3:PutObject 필요</div>';
    }else{b.className='testbox ok show';
      const lat=(18+Math.floor(Math.random()*40));
      b.innerHTML=`<span class="ic"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg></span><div><b>연결 성공 · ${lat}ms</b>인증 OK · 스키마 조회 권한 OK${['MySQL','PostgreSQL','MSSQL','MongoDB'].includes(curType)?' · CDC 로그 접근 OK':''}</div>`;
    }
  },1100);
}
