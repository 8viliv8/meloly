import { vM, pv, LYRIC_WORDS, dict, loadDict } from './modules/dict.js';
import { showAboutModal } from './modules/about.js';
import { aud, audBlob, recState, fmt, toggleMenu, importAudio, onFile, startRec, toggleRecording, togglePlay, toggleRepeat, seekAudio, setVol, delAudio, restoreAudio, exportAudio } from './modules/audio.js';
import { initFloppyModal } from './modules/floppy.js';

// Firebase（ログイン・クラウド保存）は、ネットワーク環境によって読み込みに失敗することがある。
// ここが失敗してもアプリ本体（歌詞編集など）が止まらないよう、動的importで読み込み、
// 失敗時は安全なダミー関数にフォールバックする。
let initAuth=()=>{};
let signInWithGoogle=async()=>{alert('ログイン機能を読み込めませんでした。インターネット接続をご確認のうえ、もう一度お試しください。');};
let signOutUser=async()=>{};
let saveToCloud=async()=>false;
let loadFromCloud=async()=>null;
let loadGhDataFromCloud=async()=>null;
let saveGhDataToCloud=async()=>false;
const firebaseModulePromise=import('./modules/firebase.js').then(mod=>{
    initAuth=mod.initAuth;
    signInWithGoogle=mod.signInWithGoogle;
    signOutUser=mod.signOutUser;
    saveToCloud=mod.saveToCloud;
    loadFromCloud=mod.loadFromCloud;
    loadGhDataFromCloud=mod.loadGhDataFromCloud;
    saveGhDataToCloud=mod.saveGhDataToCloud;
    return mod;
}).catch(e=>{
    console.warn('Firebase機能の読み込みに失敗しました。ログイン・クラウド保存は今回無効になりますが、他の機能は通常通り使えます。',e);
    return null;
});

// --- ハミングモード ---
let hummingMode=false;
let hummingChar='ら';
const HUM_ANY='*N*'; // 「ん」用：「ー」以外なら何でも可、を表す特別マーカー

// 1文字ずつ走査して、ハミングモード用の母音配列（finalVowels相当）を作る
// kuroReading：kuromojiの読み変換済みテキスト（ひらがな化済み） / clean：元の選択テキスト
function buildHumVowels(clean,kuroReading,romajiVowelMap){
    const finalVowels=[];
    let kuroIdx=0;
    const kuroVowels=kuroReading.split('').map(c=>vM[c]).filter(Boolean);
    for(let i=0;i<clean.length;i++){
        const c=clean[i];
        if(c==='○'){finalVowels.push('*');}
        else if(romajiVowelMap[c]!==undefined){finalVowels.push(romajiVowelMap[c]);}
        else if(c===hummingChar){if(kuroIdx<kuroVowels.length)kuroIdx++;finalVowels.push('*');}
        else if(c==='ん'){if(kuroIdx<kuroVowels.length)kuroIdx++;finalVowels.push(HUM_ANY);}
        else if(c==='ー'){
            if(kuroIdx<kuroVowels.length)kuroIdx++;
            finalVowels.push(finalVowels.length?finalVowels[finalVowels.length-1]:'*');
        }
        else if(c==='っ'||c==='ッ'){/* 常に無視（拍に含めない） */}
        else{if(kuroIdx<kuroVowels.length)finalVowels.push(kuroVowels[kuroIdx++]);}
    }
    return finalVowels;
}

// 候補マッチング時の母音比較（HUM_ANYは「ー」以外なら何でも可）
function posMatches(dv,vowel){
    if(vowel===HUM_ANY)return dv!=='-';
    return !dv||dv===vowel;
}

// セグメント単体（漢字混在もOK）からfinalVowels配列を作る
function humVowelsForSegment(seg){
    const romajiVowelMap={
        'a':'a','i':'i','u':'u','e':'e','o':'o',
        'k':'a','g':'a','s':'a','z':'a','t':'a','d':'a',
        'n':'a','h':'a','b':'a','p':'a','m':'a','r':'a','y':'a','w':'a',
        'A':'a','I':'i','U':'u','E':'e','O':'o',
        'K':'a','G':'a','S':'a','Z':'a','T':'a','D':'a',
        'N':'a','H':'a','B':'a','P':'a','M':'a','R':'a','Y':'a','W':'a'
    };
    const kuroReading=getReading(seg).replace(/[ァ-ン]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
    return buildHumVowels(seg,kuroReading,romajiVowelMap);
}

// finalVowels配列から、優先順位（life memo→LYRIC_WORDS→辞書全体）でマッチする言葉をランダムに1つ選ぶ
// opts.preferPos: LYRIC_WORDS層でこの品詞を優先（無ければ全候補にフォールバック）
// opts.exclude: 1回の一括変換内で使用済みの単語（重複除去）
// opts.avoid: 振り直し時、他候補があればこの単語を返さない
function pickRandomHumMatch(finalVowels,opts){
    opts=opts||{};
    const exclude=opts.exclude||null;
    const syl=finalVowels.length;
    if(syl===0)return null;
    const iv=[];
    for(let i=0;i<finalVowels.length;i++){
        const v=finalVowels[i];
        if(v&&v!=='*')iv.push({pos:i,vowel:v});
    }
    function matchOk(d){
        const dSyl=d.s!==undefined?d.s:d.v.length;
        if(dSyl!==syl)return false;
        for(const x of iv){if(!posMatches(d.v[x.pos],x.vowel))return false;}
        return true;
    }
    function pick(cands){
        if(cands.length===0)return null;
        if(opts.avoid&&cands.length>1){
            const rest=cands.filter(d=>d.word!==opts.avoid);
            if(rest.length>0)cands=rest;
        }
        return cands[Math.floor(Math.random()*cands.length)].word;
    }
    const tiers=[ghDict,lyricDict,dict];
    for(const tier of tiers){
        let candidates=tier.filter(matchOk);
        if(exclude)candidates=candidates.filter(d=>!exclude.has(d.word));
        if(candidates.length===0)continue;
        // 品詞優先（posを持つ候補がある層でのみ効く。無ければ全候補から）
        if(opts.preferPos&&opts.preferPos.length){
            const preferred=candidates.filter(d=>d.pos&&opts.preferPos.includes(d.pos));
            if(preferred.length>0)return pick(preferred);
        }
        return pick(candidates);
    }
    return null;
}

// 「、」または空白区切りのハミングテキストを一括で言葉に変換して置き換える
let lastHumOriginalText=null;
let lastHumResultText=null;

function handleHummingMultiSegment(cleanText){
    if(!savedRange)return;
    const originalText=savedRange.toString();
    const segments=cleanText.split(/[、\s　]+/).filter(s=>s.length>0);
    const isReroll=(cleanText===lastHumOriginalText&&lastHumResultText!==null);
    const prevWords=isReroll?lastHumResultText.split('、'):[];
    // 品詞でフレーズの形をつくる：最後の区切りは動詞・形容詞、それ以外は名詞を優先
    // （合う拍数の言葉が無ければ従来通り全候補から。拍数・母音ルールは不変）
    const used=new Set();
    const results=segments.map((seg,i)=>{
        const vowels=humVowelsForSegment(seg);
        const isLast=(i===segments.length-1);
        const match=pickRandomHumMatch(vowels,{
            preferPos:segments.length>1?(isLast?['動詞','形容詞']:['名詞']):null,
            exclude:used,
            avoid:isReroll?prevWords[i]:null
        });
        if(match)used.add(match);
        return match||seg;
    });
    const replacement=results.join('、');
    savedRange.deleteContents();
    const newNode=document.createTextNode(replacement);
    savedRange.insertNode(newNode);
    const newRange=document.createRange();
    newRange.selectNode(newNode);
    const sel=window.getSelection();
    sel.removeAllRanges();
    sel.addRange(newRange);
    savedRange=newRange;
    lastHumOriginalText=cleanText;
    lastHumResultText=replacement;
    recordConvertUndo(newNode,originalText);
    document.getElementById('inlinePopup').classList.remove('open');
}

// 「一括変換」ボタンから呼ばれる。savedRangeを優先し、無ければ今のライブ選択も見る
// 直前の変換結果と同じ場所をもう一度押した場合は、元のハミング文字列で振り直す
function runHummingBatchConvert(){
    let range=drumActive&&drumRange?drumRange:savedRange;
    if(!range||range.collapsed){
        const sel=window.getSelection();
        if(sel&&sel.rangeCount>0&&!sel.isCollapsed)range=sel.getRangeAt(0);
    }
    if(!range||range.collapsed){alert('歌詞エリアで、変換したい範囲を選択してください。');return;}
    const txt=range.toString();
    if(!txt.trim()){alert('歌詞エリアで、変換したい範囲を選択してください。');return;}
    savedRange=range;
    const sourceText=(txt===lastHumResultText&&lastHumOriginalText)?lastHumOriginalText:txt;
    handleHummingMultiSegment(sourceText);
}

// 「選択変換」：区切らず、選択範囲全体を1つのフレーズとして変換する
function runHummingSingleConvert(){
    let range=drumActive&&drumRange?drumRange:savedRange;
    if(!range||range.collapsed){
        const sel=window.getSelection();
        if(sel&&sel.rangeCount>0&&!sel.isCollapsed)range=sel.getRangeAt(0);
    }
    if(!range||range.collapsed){alert('歌詞エリアで、変換したい範囲を選択してください。');return;}
    const txt=range.toString();
    if(!txt.trim()){alert('歌詞エリアで、変換したい範囲を選択してください。');return;}
    savedRange=range;
    const sourceText=(txt===lastHumResultText&&lastHumOriginalText)?lastHumOriginalText:txt;
    const isReroll=(sourceText===lastHumOriginalText&&lastHumResultText!==null);
    const cleanSource=sourceText.replace(/[、\s　]/g,'');
    const vowels=humVowelsForSegment(cleanSource);
    const match=pickRandomHumMatch(vowels,{avoid:isReroll?lastHumResultText:null});
    const replacement=match||sourceText;
    savedRange.deleteContents();
    const newNode=document.createTextNode(replacement);
    savedRange.insertNode(newNode);
    const newRange=document.createRange();
    newRange.selectNode(newNode);
    const sel2=window.getSelection();
    sel2.removeAllRanges();
    sel2.addRange(newRange);
    savedRange=newRange;
    lastHumOriginalText=sourceText;
    lastHumResultText=replacement;
    recordConvertUndo(newNode,txt);
    document.getElementById('inlinePopup').classList.remove('open');
}

// --- BPM/KEY ピッカー ---
const BPM_VALUES=Array.from({length:200},(_,i)=>i+40);
const KEY_VALUES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B','Cm','C#m','Dm','D#m','Em','Fm','F#m','Gm','G#m','Am','A#m','Bm'];
let openPicker=null;
function buildPickerList(listEl,values,currentVal,inputId){
    listEl.innerHTML='';
    values.forEach(v=>{
        const d=document.createElement('div');
        d.className='drum-picker-item'+(String(v)===String(currentVal)?' active':'');
        d.textContent=v;
        d.onclick=()=>{document.getElementById(inputId).value=v;closeDrumPicker();saveProject();};
        listEl.appendChild(d);
    });
    const active=listEl.querySelector('.active');
    if(active)setTimeout(()=>active.scrollIntoView({block:'center'}),50);
}
function openDrumPicker(type){
    closeDrumPicker();
    if(type==='bpm'){buildPickerList(document.getElementById('bpmList'),BPM_VALUES,document.getElementById('bpmInput').value,'bpmInput');document.getElementById('bpmPicker').classList.add('open');}
    else{buildPickerList(document.getElementById('keyList'),KEY_VALUES,document.getElementById('keyInput').value,'keyInput');document.getElementById('keyPicker').classList.add('open');}
    openPicker=type;
}
function closeDrumPicker(){document.getElementById('bpmPicker').classList.remove('open');document.getElementById('keyPicker').classList.remove('open');openPicker=null;}
document.addEventListener('click',e=>{if(openPicker&&!e.target.closest('.drum-input-wrap'))closeDrumPicker();});

// --- Projects ---
const DEFAULT_DB={
    1:{title:"",bpm:"120",key:"C",blocks:[{name:"",text:""}],blocksRight:[]},
    2:{title:"うわのそら(demo)",bpm:"90",key:"B",
        blocks:[
            {name:"A",text:"窓の外に浮かぶ雲を　ただ目で追っていた\n誰かの声が遠くなる　上の空のまま"},
            {name:"B",text:"気がつけば夕暮れで　時間だけが流れてく\nそれでもいいと思ってた　あの頃の話"},
            {name:"サビ",text:"上の空　君のことを考えてた\n届かない言葉だけが　風に溶けていく"}
        ],
        blocksRight:[
            {name:"A2",text:"朝になってまた同じ　夢の続きを探して\nいつの間にか慣れていた　この距離の感覚"},
            {name:"B2",text:"忘れようとするほどに　鮮明になっていく\n笑い方も泣き方も　全部覚えてる"},
            {name:"サビ2",text:"上の空　また君のことを考えてた\n終わらない物語を　今も抱えたまま"}
        ]
    }
};

let curId=1;
let db={};
let nextId=3;
let isDuplicating=false;
let projectFolders=[{id:'root',open:true,folders:[],projects:[1,2]}];

const LS_KEY='clicklyric_db';
const LS_CUR='clicklyric_cur';
const LS_NEXTID='clicklyric_nextid';
const LS_GHDATA='clicklyric_ghdata';

function lsSave(){
    try{
        localStorage.setItem(LS_KEY,JSON.stringify(db));
        localStorage.setItem(LS_CUR,String(curId));
        localStorage.setItem(LS_NEXTID,String(nextId));
    }catch(e){}
}
function lsSaveGhData(){
    try{
        localStorage.setItem(LS_GHDATA,JSON.stringify(ghData));
    }catch(e){}
}
function lsLoad(){
    try{
        const raw=localStorage.getItem(LS_KEY);
        if(raw){
            db=JSON.parse(raw);
            curId=parseInt(localStorage.getItem(LS_CUR)||'1');
            nextId=parseInt(localStorage.getItem(LS_NEXTID)||'3');
            return true;
        }
    }catch(e){}
    return false;
}
function lsLoadGhData(){
    try{
        const raw=localStorage.getItem(LS_GHDATA);
        if(raw){
            ghData=JSON.parse(raw);
            return true;
        }
    }catch(e){}
    return false;
}

function getAllProjectIds(){
    const ids=[];
    function collect(node){
        if(node.projects)node.projects.forEach(id=>ids.push(id));
        if(node.folders)node.folders.forEach(f=>collect(f));
    }
    collect(projectFolders[0]);
    return ids;
}

function removeProjectFromTree(node,id){
    if(node.projects){const i=node.projects.indexOf(id);if(i>=0)node.projects.splice(i,1);}
    if(node.folders)node.folders.forEach(f=>removeProjectFromTree(f,id));
}

function renderProjects(){
    const tree=document.getElementById('projectTree');
    if(!tree)return;
    tree.innerHTML='';
    renderProjectNode(projectFolders[0],tree,0);
}

function renderProjectNode(node,container,depth){
    // プロジェクトを先に表示
    if(node.projects)node.projects.forEach(id=>{
        const p=db[id];if(!p)return;
        const row=document.createElement('div');
        row.style.cssText=`display:flex;align-items:center;gap:4px;padding:3px 4px;padding-left:${depth*10+4}px;border-radius:3px;cursor:pointer;${id==curId?'background:var(--bg-input);':''}`;
        row.addEventListener('mouseenter',()=>row.style.background='var(--bg-input)');
        row.addEventListener('mouseleave',()=>{if(id!=curId)row.style.background='';});
        const dot=document.createElement('span');
        dot.style.cssText=`color:${id==curId?'var(--accent)':'var(--dim)'};flex-shrink:0;display:inline-flex;align-items:center;`;
        dot.innerHTML='<svg width="5" height="5" viewBox="0 0 5 5" fill="currentColor"><circle cx="2.5" cy="2.5" r="2"/></svg>';
        const nameSpan=document.createElement('span');
        nameSpan.style.cssText=`flex:1;font-size:11px;color:${id==curId?'var(--accent)':'var(--text-muted)'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${id==curId?'font-weight:700;':''}`;
        nameSpan.textContent=p.title||'（無題）';
        nameSpan.onclick=()=>loadProject(id);
        nameSpan.ondblclick=e=>{
            e.stopPropagation();e.preventDefault();
            const inp=document.createElement('input');
            inp.value=p.title;
            inp.style.cssText='font-size:11px;border:none;border-bottom:1px solid var(--accent);background:transparent;color:var(--text-main);outline:none;width:120px;';
            nameSpan.replaceWith(inp);inp.focus();inp.select();
            const done=()=>{
                if(inp.value.trim()){p.title=inp.value.trim();if(id==curId)document.getElementById('projectTitle').value=p.title;}
                renderProjects();lsSave();
            };
            inp.onblur=done;
            inp.onkeydown=ev=>{if(ev.key==='Enter')inp.blur();if(ev.key==='Escape')renderProjects();};
        };
        const pMove=document.createElement('button');
        pMove.innerHTML='<svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,2 7,5 4,8"/><line x1="2" y1="5" x2="7" y2="5"/><line x1="8" y1="2" x2="8" y2="8"/></svg>';
        pMove.style.cssText='background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:1px;opacity:0;transition:opacity .15s;display:flex;align-items:center;flex-shrink:0;';
        pMove.onclick=e=>{
            e.stopPropagation();
            const existing=document.getElementById('ctx-menu');if(existing)existing.remove();
            const menu=document.createElement('div');
            menu.id='ctx-menu';
            menu.style.cssText='position:fixed;left:-9999px;top:-9999px;background:var(--bg-surface);border:1px solid var(--border);border-radius:5px;box-shadow:0 4px 12px rgba(0,0,0,.1);z-index:9999;overflow:hidden;min-width:140px;';
            const label=document.createElement('div');
            label.style.cssText='padding:4px 12px;font-size:9px;color:var(--text-muted);letter-spacing:1px;border-bottom:1px solid var(--border);';
            label.textContent='フォルダへ移動';menu.appendChild(label);
            const folders=projectFolders[0].folders;
            if(folders.length===0){
                const item=document.createElement('div');item.style.cssText='padding:8px 12px;font-size:11px;color:var(--text-muted);';
                item.textContent='フォルダがありません';menu.appendChild(item);
            }else{
                folders.forEach(f=>{
                    const item=document.createElement('div');
                    item.style.cssText='padding:7px 12px;font-size:11px;color:var(--text-main);cursor:pointer;transition:background .1s;';
                    item.textContent=f.name;
                    item.addEventListener('mouseenter',()=>item.style.background='var(--bg-input)');
                    item.addEventListener('mouseleave',()=>item.style.background='');
                    item.onclick=()=>{removeProjectFromTree(projectFolders[0],id);f.projects.push(id);menu.remove();renderProjects();lsSave();};
                    menu.appendChild(item);
                });
            }
            document.body.appendChild(menu);
            const mRect=menu.getBoundingClientRect();
            const rect=pMove.getBoundingClientRect();
            menu.style.left=Math.min(rect.left,window.innerWidth-mRect.width-8)+'px';
            menu.style.top=Math.min(rect.bottom+4,window.innerHeight-mRect.height-8)+'px';
            setTimeout(()=>document.addEventListener('click',()=>menu.remove(),{once:true}),0);
        };
        const pDel=document.createElement('button');
        pDel.innerHTML='<svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/></svg>';
        pDel.style.cssText='background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:1px;opacity:0;transition:opacity .15s;display:flex;align-items:center;';
        pDel.onclick=e=>{e.stopPropagation();deleteProject(id);};
        row.addEventListener('mouseenter',()=>{pMove.style.opacity='1';pDel.style.opacity='1';});
        row.addEventListener('mouseleave',()=>{pMove.style.opacity='0';pDel.style.opacity='0';});
        row.appendChild(dot);row.appendChild(nameSpan);row.appendChild(pMove);row.appendChild(pDel);
        container.appendChild(row);
    });

    // フォルダを後に表示
    if(node.folders)node.folders.forEach(f=>{
        const fDiv=document.createElement('div');
        const hd=document.createElement('div');
        hd.style.cssText=`display:flex;align-items:center;gap:4px;padding:3px 4px;padding-left:${depth*10+4}px;border-radius:3px;cursor:pointer;`;
        hd.addEventListener('mouseenter',()=>hd.style.background='var(--bg-input)');
        hd.addEventListener('mouseleave',()=>hd.style.background='');
        const arrow=document.createElement('span');
        arrow.style.cssText=`font-size:8px;color:var(--text-muted);display:inline-flex;align-items:center;transition:transform .15s;transform:${f.open?'rotate(90deg)':'none'};`;
        arrow.innerHTML='<svg width="6" height="6" viewBox="0 0 6 6" fill="currentColor"><polygon points="1,0 5,3 1,6"/></svg>';
        const nameSpan=document.createElement('span');
        nameSpan.style.cssText='flex:1;font-size:11px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        nameSpan.textContent=f.name;
        nameSpan.onclick=()=>{f.open=!f.open;renderProjects();};
        nameSpan.ondblclick=e=>{
            e.stopPropagation();e.preventDefault();
            const inp=document.createElement('input');
            inp.value=f.name;
            inp.style.cssText='font-size:11px;border:none;border-bottom:1px solid var(--accent);background:transparent;color:var(--text-main);outline:none;width:100px;';
            nameSpan.replaceWith(inp);inp.focus();inp.select();
            const done=()=>{if(inp.value.trim())f.name=inp.value.trim();renderProjects();lsSave();};
            inp.onblur=done;
            inp.onkeydown=ev=>{if(ev.key==='Enter')inp.blur();if(ev.key==='Escape')renderProjects();};
        };
        const fDel=document.createElement('button');
        fDel.innerHTML='<svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/></svg>';
        fDel.style.cssText='background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:1px;opacity:0;transition:opacity .15s;display:flex;align-items:center;';
        fDel.onclick=e=>{
            e.stopPropagation();
            if(!confirm(`「${f.name}」を削除しますか？`))return;
            const idx=projectFolders[0].folders.indexOf(f);
            if(idx>=0)projectFolders[0].folders.splice(idx,1);
            renderProjects();lsSave();
        };
        hd.addEventListener('mouseenter',()=>fDel.style.opacity='1');
        hd.addEventListener('mouseleave',()=>fDel.style.opacity='0');
        hd.appendChild(arrow);hd.appendChild(nameSpan);hd.appendChild(fDel);
        fDiv.appendChild(hd);
        if(f.open){
            const sub=document.createElement('div');
            renderProjectNode(f,sub,depth+1);
            fDiv.appendChild(sub);
        }
        container.appendChild(fDiv);
    });

    // +ボタン右寄り（ルートレベルのみ常時表示、フォルダ内は開いているときのみ表示）
    const btns=document.createElement('div');
    btns.style.cssText='display:flex;gap:6px;margin-top:6px;justify-content:flex-end;padding-right:4px;';
    const addProj=document.createElement('button');
    addProj.className='btn-tree';
    addProj.setAttribute('data-tip-down','プロジェクトを追加');
    addProj.innerHTML='<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="5" y1="1" x2="5" y2="9"/><line x1="1" y1="5" x2="9" y2="5"/></svg>';
    addProj.onclick=()=>{
        saveProject();
        const id=nextId++;
        db[id]={title:'',bpm:'120',key:'C',blocks:[{name:'',text:''}],blocksRight:[]};
        node.projects.push(id);
        loadProject(id);
    };
    const addFol=document.createElement('button');
    addFol.className='btn-tree';
    addFol.setAttribute('data-tip-down','フォルダを追加');
    addFol.innerHTML='<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M1 3 Q1 2 2 2 L4 2 L5 3 L9 3 Q9 3 9 4 L9 8 Q9 9 8 9 L2 9 Q1 9 1 8Z"/><line x1="5" y1="5" x2="5" y2="8"/><line x1="3.5" y1="6.5" x2="6.5" y2="6.5"/></svg>';
    addFol.onclick=()=>{
        if(!node.folders)node.folders=[];
        node.folders.push({id:'pf'+Date.now(),name:'新規フォルダ',open:true,folders:[],projects:[]});
        renderProjects();lsSave();
    };
    btns.appendChild(addProj);btns.appendChild(addFol);
    const dupProj=document.createElement('button');
    dupProj.className='btn-tree';
    dupProj.setAttribute('data-tip-down','このプロジェクトを複製して保存');
    dupProj.innerHTML='<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="1" y="3" width="6" height="6" rx="1"/><path d="M3 3 L3 1.5 Q3 1 3.5 1 L8.5 1 Q9 1 9 1.5 L9 6.5 Q9 7 8.5 7 L7 7"/></svg>';
    dupProj.onclick=()=>duplicateProject();
    btns.appendChild(dupProj);
    container.appendChild(btns);
}

function loadProject(id){
    if(curId!=id)saveProject();
    curId=parseInt(id);
    const p=db[id];if(!p)return;
    document.getElementById('projectTitle').value=p.title;
    document.getElementById('bpmInput').value=p.bpm;
    document.getElementById('keyInput').value=p.key;
    const bl=document.getElementById('blocksLeft');bl.innerHTML='';
    p.blocks.forEach(b=>bl.appendChild(makeBlock(b.name,b.text)));
    // 右パネルの読み込み
   if(p.blocksRight&&p.blocksRight.length>0){
        if(!splitOn)toggleSplit();
        const br=document.getElementById('blocksRight');br.innerHTML='';
        p.blocksRight.forEach(b=>br.appendChild(makeBlock(b.name,b.text)));
    }else{
        if(splitOn){splitOn=false;document.getElementById('panelRight').style.display='none';document.getElementById('divider').classList.remove('open');}
        document.getElementById('blocksRight').innerHTML='';
    }
    renderProjects();
    lsSave();
}

function saveProject(){
    if(isDuplicating)return;
    const p=db[curId];if(!p)return;
    p.title=document.getElementById('projectTitle').value;
    p.bpm=document.getElementById('bpmInput').value;
    p.key=document.getElementById('keyInput').value;
    const blocks=[];
    document.querySelectorAll('#blocksLeft .section-block').forEach(el=>{
        blocks.push({
            name:el.querySelector('.section-badge').textContent,
            text:el.querySelector('.lyric-editor').innerHTML.replace(/<br\s*\/?>/g,'\n').replace(/<[^>]*>?/gm,'')
        });
    });
    p.blocks=blocks;
    const blocksRight=[];
    document.querySelectorAll('#blocksRight .section-block').forEach(el=>{
        blocksRight.push({
            name:el.querySelector('.section-badge').textContent,
            text:el.querySelector('.lyric-editor').innerHTML.replace(/<br\s*\/?>/g,'\n').replace(/<[^>]*>?/gm,'')
        });
    });
    p.blocksRight=blocksRight;
    lsSave();
    renderProjects();
}

function deleteProject(id){
    const allIds=getAllProjectIds();
    if(allIds.length<=1){alert('最後のプロジェクトは削除できません');return;}
    if(!confirm(`「${db[id].title}」を削除しますか？`))return;
    delete db[id];
    removeProjectFromTree(projectFolders[0],id);
    if(curId==id){
        curId=parseInt(getAllProjectIds()[0]);
        loadProject(curId);
    }
    renderProjects();lsSave();
}

function duplicateProject(){
    isDuplicating=true;
    const origData=JSON.parse(JSON.stringify(db[curId]));
    const currentBlocks=[];
    document.querySelectorAll('#blocksLeft .section-block').forEach(el=>{
        currentBlocks.push({
            name:el.querySelector('.section-badge').textContent,
            text:el.querySelector('.lyric-editor').innerHTML.replace(/<br\s*\/?>/g,'\n').replace(/<[^>]*>?/gm,'')
        });
    });
    const newId=nextId++;
    db[newId]=JSON.parse(JSON.stringify(origData));
    db[newId].title=document.getElementById('projectTitle').value+'_コピー';
    db[newId].bpm=document.getElementById('bpmInput').value;
    db[newId].key=document.getElementById('keyInput').value;
    db[newId].blocks=currentBlocks;
    db[curId]=origData;
    projectFolders[0].projects.push(newId);
    lsSave();
    curId=newId;
    document.getElementById('projectTitle').value=db[newId].title;
    document.getElementById('bpmInput').value=db[newId].bpm;
    document.getElementById('keyInput').value=db[newId].key;
    const bl=document.getElementById('blocksLeft');bl.innerHTML='';
    db[newId].blocks.forEach(b=>bl.appendChild(makeBlock(b.name,b.text)));
    isDuplicating=false;
    renderProjects();
}

// --- Blocks ---
let bc=0;
function makeBlock(name,text){
    const id='b'+(++bc);const d=document.createElement('div');d.className='section-block';
    d.innerHTML=`
<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
  <div class="section-badge" contenteditable="true" spellcheck="false">${name||''}</div>
  <button class="ruby-toggle-btn a-btn" data-tip-up="ルビを確認" style="padding:2px 5px;font-size:8px;letter-spacing:.5px;flex-shrink:0;">ルビ</button>
</div>
<div class="block-body">
  <div class="lyric-editor" contenteditable="true" placeholder="ここに歌詞を入力...2分割モードもあるよ...このエリアの右側で録音もできるよ...制作に行き詰ったときは上のモードを使ってね...">${text?text.replace(/\n/g,'<br>'):''}</div>
  <div class="audio-area">
    <div class="audio-trigger" id="t-${id}" style="position:relative;">
      <button class="note-btn" id="nb-${id}" data-tip-up="オーディオ">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M6 12 L6 4 L13 2 L13 10"/><circle cx="4.5" cy="12.5" r="2"/><circle cx="11.5" cy="10.5" r="2"/></svg>
      </button>
      <div class="note-menu" id="m-${id}">
        <button class="note-menu-item" id="imp-${id}"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11 Q3 14 8 14 Q13 14 13 11"/><line x1="8" y1="2" x2="8" y2="10"/><polyline points="5,7 8,10 11,7"/></svg>インポート</button>
        <button class="note-menu-item" id="rec-${id}"><svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="8" cy="8" r="3.5" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="6.5"/></svg>録音</button>
      </div>
    </div>
    <div class="audio-playing-wrap" id="pw-${id}">
      <div class="wave-bars"><div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div><div class="wave-bar"></div></div>
      <div class="vol-vert-wrap" data-tip-up="音量"><div class="vol-lbl">+</div><input type="range" class="vol-vert" id="v-${id}" min="0" max="100" value="80"><div class="vol-lbl">−</div></div>
    </div>
    <div class="audio-expanded" id="ex-${id}">
      <div class="playbar-row">
        <button class="a-btn" id="play-${id}" data-tip-up="再生 / 停止">
          <svg id="pi-${id}" width="13" height="13" viewBox="0 0 16 16" fill="currentColor" stroke="none"><polygon points="4,2 13,8 4,14"/></svg>
          <svg id="pau-${id}" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" style="display:none;"><line x1="5" y1="3" x2="5" y2="13"/><line x1="11" y1="3" x2="11" y2="13"/></svg>
        </button>
        <div class="seek-wrap">
          <div class="fname" id="fn-${id}" data-tip-up="">—</div>
          <input type="range" class="seek-bar" id="sk-${id}" min="0" max="100" value="0">
          <div class="time-disp" id="td-${id}">0:00 / 0:00</div>
        </div>
      </div>
      <div class="ctrl-row">
        <button class="a-btn" id="rp-${id}" data-tip-up="リピート"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="11,1 14,4 11,7"/><path d="M3 4 L3 7 Q3 11 7 11 L14 11"/><polyline points="5,15 2,12 5,9"/><path d="M13 12 L13 9 Q13 5 9 5 L2 5"/></svg></button>
        <button class="a-btn rec" id="rc-${id}" data-tip-up="録音"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><circle cx="8" cy="8" r="3.5" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="6.5"/></svg></button>
        <button class="a-btn" id="overimp-${id}" data-tip-up="上書きインポート"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11 Q3 14 8 14 Q13 14 13 11"/><line x1="8" y1="2" x2="8" y2="10"/><polyline points="5,7 8,10 11,7"/></svg></button>
        <button class="a-btn" id="exp-${id}" data-tip-up="エクスポート"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11 Q3 14 8 14 Q13 14 13 11"/><line x1="8" y1="10" x2="8" y2="2"/><polyline points="5,5 8,2 11,5"/></svg></button>
        <button class="a-btn del" id="del-${id}" data-tip-up="削除"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,5 4,14 12,14 13,5"/><line x1="1" y1="5" x2="15" y2="5"/><path d="M6,5 L6,3 L10,3 L10,5"/><line x1="6" y1="8" x2="6" y2="12"/><line x1="10" y1="8" x2="10" y2="12"/></svg></button>
      </div>
    </div>
    <input type="file" id="f-${id}" accept="audio/*" style="display:none;">
  </div>
</div>`;
    d.querySelector(`#nb-${id}`).onclick=()=>toggleMenu(id);
    d.querySelector(`#imp-${id}`).onclick=()=>importAudio(id);
    d.querySelector(`#rec-${id}`).onclick=()=>startRec(id);
    d.querySelector(`#play-${id}`).onclick=()=>togglePlay(id);
    d.querySelector(`#rp-${id}`).onclick=()=>toggleRepeat(id);
    d.querySelector(`#rc-${id}`).onclick=()=>toggleRecording(id);
    d.querySelector(`#overimp-${id}`).onclick=()=>importAudio(id);
    d.querySelector(`#exp-${id}`).onclick=()=>exportAudio(id);
    d.querySelector(`#del-${id}`).onclick=()=>delAudio(id);
    d.querySelector(`#v-${id}`).oninput=function(){setVol(id,this.value);};
    d.querySelector(`#sk-${id}`).oninput=function(){seekAudio(id,this.value);};
    d.querySelector(`#f-${id}`).onchange=function(){onFile(id,this);};
    d.querySelector('.ruby-toggle-btn').onclick=()=>toggleBlockRuby(d);
    return d;
}

function addBlock(side){
    const t=side==='right'?'blocksRight':'blocksLeft';
    const b=makeBlock('','');document.getElementById(t).appendChild(b);
    b.querySelector('.lyric-editor').focus();saveProject();
}

// --- Split ---
let splitOn=false;
function toggleSplit(){
    splitOn=!splitOn;
    document.getElementById('panelRight').style.display=splitOn?'flex':'none';
    document.getElementById('divider').classList.toggle('open',splitOn);
    
}
const dv=document.getElementById('divider');
const ea=document.getElementById('editorArea');
let drag=false;
dv.addEventListener('mousedown',e=>{drag=true;dv.classList.add('dragging');e.preventDefault();});
window.addEventListener('mousemove',e=>{
    if(!drag)return;
    const r=ea.getBoundingClientRect();
    const lw=e.clientX-r.left;const rw=r.width-lw-5;
    if(lw>100&&rw>100){document.getElementById('panelLeft').style.flex=`0 0 ${lw}px`;document.getElementById('panelRight').style.flex=`0 0 ${rw}px`;}
});
window.addEventListener('mouseup',()=>{if(drag){drag=false;dv.classList.remove('dragging');}});

// --- Sidebar ---
let sidebarOpen=false;
function toggleSidebar(){
    sidebarOpen=!sidebarOpen;
    document.getElementById('sidebar').classList.toggle('open',sidebarOpen);
    document.getElementById('sidebarOverlay').classList.toggle('open',sidebarOpen);
}
function closeSidebar(){
    sidebarOpen=false;
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('open');
}

// --- Tree (life memo) ---
let treeOpen=false;
function toggleTreeSide(){
    treeOpen=!treeOpen;
    document.getElementById('treeSide').classList.toggle('open',treeOpen);
    if(treeOpen)renderTree();
}

// --- Dictionary ---
let lyricDict=[];
function buildLyricDict(){
    if(!tokenizer)return;
    lyricDict=LYRIC_WORDS.map(entry=>{
        const w=entry&&entry.word!==undefined?entry.word:entry;
        try{
            const tokens=tokenizer.tokenize(w);
            const reading=tokens.map(t=>t.reading||t.surface_form).join('').replace(/[ァ-ン]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
            return{word:w,pos:entry&&entry.pos,v:pv(reading)};
        }catch(e){return{word:w,pos:entry&&entry.pos,v:pv(w)};}
    }).filter(d=>d.v.length>0);
}

function morphFindRandom(vowels){
    const vStr=vowels.join('');
    const ghM=ghDict.filter(d=>d.v.join('')===vStr);
    if(ghM.length>0)return ghM[Math.floor(Math.random()*ghM.length)].word;
    const lyricM=lyricDict.filter(d=>d.v.join('')===vStr);
    if(lyricM.length>0)return lyricM[Math.floor(Math.random()*lyricM.length)].word;
    const skkM=dict.filter(d=>d.v.join('')===vStr);
    if(skkM.length>0)return skkM[Math.floor(Math.random()*skkM.length)].word;
    return null;
}

// --- MORPH ---
const JOSHI=['が','を','は','に','で','と','も','から','まで','より','へ','や','か','の'];
const FUSE_POS=['助動詞'];
const FUSE_SURFACE=['て','で','ない','ます','です','た','だ','ば','たら','なら','けど','けれど','ても','でも','から','し'];

function fuseTokens(tokens){
    const fused=[];
    let i=0;
    while(i<tokens.length){
        const t=tokens[i];
        let surface=t.surface_form;
        let reading=(t.reading||t.surface_form).replace(/[ァ-ン]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
        let j=i+1;
        while(j<tokens.length){
            const next=tokens[j];
            if(FUSE_POS.includes(next.pos)||FUSE_SURFACE.includes(next.surface_form)){
                surface+=next.surface_form;
                reading+=(next.reading||next.surface_form).replace(/[ァ-ン]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
                j++;
            }else{break;}
        }
        fused.push({...t,surface_form:surface,_reading:reading,_fused:(j>i+1)});
        i=j;
    }
    return fused;
}

async function morphText(input,joshiRate){
    if(!tokenizer)return input;
    const lines=input.split('\n');
    const outputLines=[];
    for(const line of lines){
        if(!line.trim()){outputLines.push('');continue;}
        const tokens=tokenizer.tokenize(line);
        const fused=fuseTokens(tokens);
        let result='';
        for(const t of fused){
            const pos=t.pos;
            const surface=t.surface_form;
            const reading=t._reading||(t.reading||surface).replace(/[ァ-ン]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
            if(pos==='助詞'){
                if(Math.random()<joshiRate){
                    const alt=JOSHI.filter(j=>j!==surface);
                    result+=alt[Math.floor(Math.random()*alt.length)];
                }else{result+=surface;}
            }else if(pos==='名詞'||pos==='動詞'||pos==='形容詞'||pos==='副詞'){
                const vowels=pv(reading);
                if(vowels.length>0&&vowels.length<=10){
                    const replaced=morphFindRandom(vowels);
                    result+=replaced||surface;
                }else{result+=surface;}
            }else{result+=surface;}
        }
        outputLines.push(result);
    }
    return outputLines.join('\n');
}

// あいまい変換強度（助詞変換率）
let morphJoshiRate=0.5;

let lastMorphAllUndo=null; // 全体一括あいまい変換をEnterで戻すための記録 [{ed,prev}]
async function doMorphAll(){
    if(!tokenizer){alert('辞書読み込み中です。少し待ってからお試しください。');return;}
    const btn=document.getElementById('morphAllBtn');
    btn.style.opacity='0.4';btn.disabled=true;
    const editors=document.querySelectorAll('.lyric-editor');
    const undoList=[];
    for(const ed of editors){
        const input=ed.innerText.trim();
        if(!input)continue;
        undoList.push({ed,prev:ed.innerText});
        const result=await morphText(input,morphJoshiRate);
        ed.innerText=result;
    }
    lastMorphAllUndo=undoList.length?undoList:null;
    btn.style.opacity='';btn.disabled=false;
    saveProject();
}

async function doMorphSel(){
    if(!tokenizer){alert('辞書読み込み中です。少し待ってからお試しください。');return;}
    // ドラムロール中はdrumRangeを優先して使う
    let range=drumActive&&drumRange?drumRange:savedRange;
    if(!range){
        const sel=window.getSelection();
        if(!sel||sel.isCollapsed)return;
        range=sel.getRangeAt(0);
    }
    const selectedText=range.toString().trim();
    if(!selectedText||selectedText.length<1)return;
    const morphed=await morphText(selectedText,morphJoshiRate);
    try{
        range.deleteContents();
        const newNode=document.createTextNode(morphed);
        range.insertNode(newNode);
        const newRange=document.createRange();
        newRange.selectNode(newNode);
        const sel2=window.getSelection();
        sel2.removeAllRanges();
        sel2.addRange(newRange);
        savedRange=newRange;
        recordConvertUndo(newNode,selectedText);
        // ドラムロール中なら候補を更新して再表示
        if(drumActive){
            unmountDrum();
            const rect=newRange.getBoundingClientRect();
            drumRange=newRange.cloneRange();
            mountDrum(rect,[{word:morphed}],morphed);
        }
    }catch(e){}
}

// 9. ドラムロール確定後にルビを自動振り直し
function reRubyNode(node){
    if(!tokenizer)return;
    const blockEl=node.parentElement&&node.parentElement.closest('.section-block');
    if(!blockEl||blockEl.dataset.rubyOn!=='true')return;
    const word=node.textContent;
    if(!word)return;
    try{
        // 親エディタ内の既存rubyタグをすべて除去してからルビを振り直す
        const editor=blockEl.querySelector('.lyric-editor');
        if(!editor)return;
        // 既存rubyをプレーンテキストに戻す
        editor.querySelectorAll('ruby').forEach(r=>{
            const text=document.createTextNode(r.querySelector('rt')?r.childNodes[0].textContent:r.textContent);
            r.replaceWith(text);
        });
        editor.normalize();
        // エディタ全体をkuromojiで振り直す
        const fullText=editor.textContent;
        const tokens=tokenizer.tokenize(fullText);
        const rubyHtml=tokens.map(t=>{
            const surface=t.surface_form;
            const reading=(t.reading||surface).replace(/[ァ-ン]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
            if(surface===reading||/^[ぁ-んー]+$/.test(surface))return surface;
            return `<ruby>${surface}<rt class="auto-ruby" style="font-size:9px;color:var(--accent);cursor:pointer;">${reading}</rt></ruby>`;
        }).join('');
        editor.innerHTML=rubyHtml;
        // rtクリックでポップアップ編集（既存のイベント再登録）
        editor.querySelectorAll('rt.auto-ruby').forEach(rt=>{
            rt.addEventListener('click',e=>{
                e.stopPropagation();
                const existing=document.getElementById('ruby-edit-popup');
                if(existing)existing.remove();
                const popup=document.createElement('div');
                popup.id='ruby-edit-popup';
                const rtRect=rt.getBoundingClientRect();
                popup.style.cssText=`position:fixed;left:${rtRect.left}px;top:${rtRect.bottom+2}px;background:var(--bg-surface);border:1px solid var(--border);border-radius:4px;padding:4px 6px;z-index:5000;display:flex;gap:4px;align-items:center;box-shadow:0 2px 8px rgba(0,0,0,.12);`;
                const inp=document.createElement('input');
                inp.value=rt.textContent;
                inp.style.cssText='width:80px;border:1px solid var(--border);border-radius:3px;padding:2px 4px;font-size:11px;background:var(--bg-input);color:var(--text-main);outline:none;';
                const okBtn=document.createElement('button');
                okBtn.textContent='確定';
                okBtn.style.cssText='border:1px solid var(--border);background:transparent;color:var(--accent);font-size:9px;padding:2px 6px;border-radius:3px;cursor:pointer;';
                okBtn.onclick=()=>{rt.textContent=inp.value;popup.remove();};
                inp.addEventListener('keydown',e2=>{if(e2.key==='Enter'){rt.textContent=inp.value;popup.remove();}if(e2.key==='Escape')popup.remove();});
                popup.appendChild(inp);popup.appendChild(okBtn);
                document.body.appendChild(popup);
                inp.focus();inp.select();
                setTimeout(()=>document.addEventListener('mousedown',function h(e3){if(!popup.contains(e3.target)){popup.remove();document.removeEventListener('mousedown',h);}},{once:false}),0);
            });
        });
    }catch(e){}
}
// --- Greenhouse (life memo) ---
let ghData={
    folders:[{
    "id": "fwords",
    "name": "words...",
    "open": false,
    "notes": [
        {
            "id": "nw1",
            "name": "SR",
            "text": "風景、正午、高架下、藍二乗、まま、白紙、人生、拍手、音、一つ、自分、今日、君、主役、プロット、ノート、中、ガス、水道、世間、ニュース、他人事、インク、頃、頭、夢、大人、時効、雲、視界、夜、花、春、下、妥協、心、運命、ラブソング、全部、無駄、今、目蓋、裏側、夜隅、僕、目、連続、こと、エルマ、音楽、詩、八十字、価値、終わり方、空、藍、ほど、木陰、氷菓、口、風、世の中、嘘、本当、二人、歴史、顔、想い出、呼吸、汗、匂い、さよなら、時間、貴方、夕暮れ、ビイドロ、晴れ、せい、雨、胸、凪、海、通り雨、草、羊雲、青色、土、春荒れ、春風、時計、昨日、風邪、予報、外、傘、靴、度胸、訳、夕飯、人間、手、ラップランド、納屋、ガムラスタンの古通り、古通り、夏草、灰色、言葉、カプチーノ、色、言い訳、窓辺、数、海岸、窓、反射、八月、ヴィスビー、潮騒、待ちぼうけ、海風、白さ、宵、内側、生き方、半分、街、青春、爆弾、片手、人類、みんな、ナイトショー、ワンシーン、日々、部屋、やつ、優しさ、星、百日紅、将来、ピアノ、机、癖、筈、線、愛、世界、防衛本能、信念、塵、列車、何処、隣町、原、歌、一輪草、他、涙、日暮、夕、先、道、髪、雨催い、向こう、温もり、誰か、気、二日酔い、洗面台、歯ブラシ、コップ、棚、化粧水、物、枕、美人局、暮らし、明日、ドア、夕焼け、馬鹿、茜、日、斜陽、お日様、帰り、指先、葡萄、理由、一回、ギター、二拍、三節、四度目、誤解、話、六畳間、終わり、数十年、人生観、文字、消耗品、底、国、隙間、口癖、紙、最後、引力、質量、摩擦、軌道、飽和、結晶、収束、崩壊、波動、臨界、次元、粒子、波長、残響、反響、錯覚、葛藤、衝動、虚無、渇望、執着、絶望、孤独、郷愁、妄想、錯乱、盲信、本能、理性、錯綜、輪廻、寿命、終焉、永遠、刹那、遺物、痕跡、脈拍、蘇生、胎動、死生、輪郭、細胞、神経、骨格、遮断、共鳴、依存、束縛、排除、模倣、偽装、侵食、剥離、拒絶、拘束、投影、解剖、証明、観測、憂鬱、悲哀、苦悩、嫉妬、嫌悪、焦燥、怨嗟、諦念、悔恨、悲観、憤怒、哀愁、憐憫、寂寥、虚脱、覚醒、忘却、記憶、追憶、妄信、猜疑、達観、狂気、虚栄、傲慢、偏見、執念、諦観、自尊、劣等、孤立、疎外、欺瞞、偽善、羨望、軽蔑、陶酔、没入、感傷、愛憎、自虐、内省、沈思、黙考、驚愕、畏怖、心酔、情動、本心、真意、疑念、無念、未練、悲嘆、歓喜、信仰、祈祷、偶像、犠牲、供物、祭壇、儀式、聖域、禁忌、戒律、神託、啓示、奇跡、救済、贖罪、懺悔、恩寵、転生、涅槃、業火、怨霊、憑依、呪術、呪縛、悪魔、天使、魔女、異端、邪教、崇拝、神話、伝説、霊魂、魂魄、冥界、奈落、煉獄、天国、地獄、洗礼、福音、聖歌、賛美、巡礼、殉教、降臨、結界、聖戦、神聖、冒涜、迷信、魔術、呪詛、浄化、霊媒、神罰、神殿、経典、教義、布教、情景、立体、生命、実体、対象、生成、創造、想像、存在、起源、真理、宇宙、銀河、彗星、星雲、流星、天体、隕石、日食、月食、新星、真空、暗黒、閃光、極光、暁闇、深海、氷河、大陸、海洋、絶景、荒野、秘境、蒼穹、砂漠、樹海、深淵、境界、領域、空間、万物、悠久、無限、混沌、秩序、現象、幻影、残像、鼓動、白夜、極地、星霜、光芒、大気、重力、拝啓、願い、未来、後悔、体感、八度五分、再啓、想い、憂い、感情論、半径、八十五分、本音、一切、薪、声、愛情、二人きり、難儀、末、モノクロ、疲弊、季節、熱、木漏れ日、事、花蕾、陰り、滴、セテニル、秘密、化粧、浅はか、睫毛、造花、わたし、もの、右、左、街路、飢餓感、所在、消化器官、味、舌先、無反応、満腹中枢、翼、虚無感、舌触り、過去、姿、側、下方、目蓋裏、暗色、耳、雪、体温、ぬくもり、無彩色、身体、積雪、地平、抱擁、羽、コンパス、針、命、ひかり、空虚、しあわせ、かなしみ、大地、心臓、陽光、香り、寄る辺、背徳行為、場所、ダフネ、フィカス、アイリス、マアキア、リスラム、ミリカ、サビア、フロス、タイムス、リベス、アベリア、セダム、フェリシア、オクナ、リクニス、短夜半夏、陽、もと、腕、夏、期待、何方、喉、首筋、現在、万事快調、予想、感度、先回り、最高値、電池、考え、焦点、ピント、一瞬、光、写真機、五感、私、好調、内、いのち、最期、報酬、入社後並行線、東京、御茶の水、香水、毎晩、絶頂、商売道具、肺、トリップ、最近、銀座、警官ごっこ、国境、盛者必衰、領収書、税理士、後楽園、僧、寝具、遊戯、ピザ屋、彼女、あたし、グレッチ、青、終電、池袋、何\n\n浅い、空っぽな、薄い、ずっと、ただ、遠く、疾うに、わざと、所詮、ほら、どうにも、また、この、あの、そんな、もう、もっと、少し、少しだけ、やっと、あぁ、どうせ、久しい、随分、どうしよう、本当に、今更、なぁ、どうしても、間違ってる、正しい、正しく、幸せな、満たされない、気味が悪い、適当、はらはら、さらさら、汚れた、何気ない、じっと、柔らかに、静かな、悲しくって、仕方がない、眩しくって、とろとろ、高く、手遅れ、長い、白い、いい、ずるいよ、酷いよ、辛くても、絶え間無い、軈て、丁寧に、直ぐに、愚鈍な、揺るぎない、鈍く、荒んだ、利口な、柔らかく、違う、不毛な、不遇な、それじゃあ、甘く、過保護な、いっそ、もしも、綺麗な、似たような、どうか、それなり、どうしようもないほど、こんな、何度も、刻々と、妖しく、つんとした、繊麗な、たちまち、すぐ、浅ましい、一層、きっと、真っ白く、確か、全く、新しく、大きく、またとない、大変、無い、どんな、これ以上\n\n変わらない、寝転ぶ、鳴っている、歌っていた、書く、止まった、描いた、なる、なっていく、見上げても、流れる、仰いだ、泳ぐ、見紛う、見失う、転ばない、向いた、出来てる、信じない、売れない、零した、寝そべった、待っている、見た、わかってた、滲んだ、覆う、涼む、描け、忘れてしまった、座った、放り込んで、行きよう、笑った、教えて、来る、映った、揺れて、拭って、夏めく、顔出した、あった、掴もうとして、切った、書いて、握って、見せて、残る、色褪せない、失くして、笑ってる、響く、咲いてる、閉じて、思っている、開いていた、開いている、咲け、降り止めば、飾る、打つ、凪げ、越えてゆけ、越えてゆく、悲しい、泣きに、泣け、降り頻る、鳴れ、靡かせ、乗せ、裂け、奏で、聞く、覚ました、出かけよう、出ない、明けない、渇く、痛い、邪魔してる、上げて、明けたら、見て、覚えている、出して、出てみよう、決めた、捨てた、したい、泳いで、触れた、寄せて、行く、言う、煽ろう、戯けた、振りして、揺蕩う、嵐す、溺れ、溢れない、差す、待ち、終わって、抱いて、開く、吹き飛んじまえ、見たい、出来ませんでした、やれませんでした、爆破したい、歌にしたい、爆破して、ちらつかせて、生きられない、歩く、翳した、見向きもしない、泣けませんでした、笑えませんでした、吹けば、消えた、くせに、戻りたかった、散れば、わかってる、消せる、いなくなれ、覚えていたい、考えた、知りたい、年老いたくない、死んだら、思う、割り切ったら、言えない、売れる、辞めた、乗って、着いて行く、詠む、いらない、終わって往く、成る、忘れてしまう、置いて、もたせ、明けて、起きた、起きる、居た、回っちゃいない、疑う、醒めた、続けば、戻ってくる、帰ってくる、聞こえる、遅くなった、眠る、愛せた、愛せる、はにかむ、見えた、照らす、口に出して、暮らす、信じながら、なぞっている、生き急いで、許せない、待ち惚け、彷徨いながら、終わる、歌え、もういいかい、散ってしまった、回る、囚われた、挿し、罅割れた、溢れた、焼べて、乗せて、錆びた、彩る、燻んだ、飾った、枯れてく、覚めて、縋った、くれた、光った、色褪せて、帯びて、膿んで、擦れた、零れる、辿った、咲く、悟った、注いだ、咲いた、揺れてる、敗れて、誓った、なかった事にした、揺れていたい、ついた、見分けられない、蒔いた、触れないで、測れた、抗っていたい、老いて、忘れてしまっても、ついてくれた、言った、いる、躊躇ってしまう、厭いた、なぞる、留めたい、聞こえた、噛みしめる、紛らわせた、放り込まれ、残す、痛む、変え、浮遊しながら、落ちていく、奪い続ける、うずまり、失われていき、降りしきる、消し去ろうとする、揺り動かす、視つけられる、満たす、届けて、溶かす、取ろうとした、動き出した、馴染まない、消し去った、避ける、誘い、のみ込む、横たえ、預けた、求めていた、摘み、眠りにつく、見る、眩む、認めた、忘れたら、凍えずに、温まる、責め、仰いだら、誘う、朽ち果てた、厭わない、会えば、奪れよう、使えば、零れ出で、溢れよう、識りたくなどない、眠って、居られたら、透き徹って、居る、憶えて、奪う、しないで、通過して、行こう、歪んだ、合わせて、切り取って、要らない、持って、お出で、知らない、閃きたい、思えなくなった、聴こえる、生きている、焼き付いて、使い切って、光って、愛せど、頂戴、飛んじゃって、達して、している、映って、越えて、就いて、成って、結婚して、欲しい、する、なってみたい、殴って、噛んで、熟って、帰る\n\nように、みたいだ、なんだ、だろう、から、だ、かな、って、じゃなく、じゃないか、と、とか、や、ね、のかい、かい、さ、だろ、よな、やぁ、のに、し、すら、なのさ、ばっかさ、よ、は、に、を、も、で、な、くらい、ほど、まで、だって、みたいな、とぞ、です、わ、の",
            "checked": true
        },
        {
            "id": "nw2",
            "name": "word_palette",
            "text": "風景、正午、高架下、藍二乗、まま、白紙、人生、拍手、音、一つ、自分、今日、君、主役、プロット、ノート、中、ガス、水道、世間、ニュース、他人事、インク、頃、頭、夢、大人、時効、雲、視界、夜、花、春、下、妥協、心、運命、ラブソング、全部、無駄、今、目蓋、裏側、夜隅、僕、目、連続、こと、エルマ、音楽、詩、八十字、価値、終わり方、空、藍、ほど、木陰、氷菓、口、風、世の中、嘘、本当、二人、歴史、顔、想い出、呼吸、汗、匂い、さよなら、時間、貴方、夕暮れ、ビイドロ、晴れ、せい、雨、胸、凪、海、通り雨、草、羊雲、青色、土、春荒れ、春風、時計、昨日、風邪、予報、外、傘、靴、度胸、訳、夕飯、人間、手、ラップランド、納屋、ガムラスタンの古通り、古通り、夏草、灰色、言葉、カプチーノ、色、言い訳、窓辺、数、海岸、窓、反射、八月、ヴィスビー、潮騒、待ちぼうけ、海風、白さ、宵、内側、生き方、半分、街、青春、爆弾、片手、人類、みんな、ナイトショー、ワンシーン、日々、部屋、やつ、優しさ、星、百日紅、将来、ピアノ、机、癖、筈、線、愛、世界、防衛本能、信念、塵、列車、何処、隣町、原、歌、一輪草、他、涙、日暮、夕、先、道、髪、雨催い、向こう、温もり、誰か、気、二日酔い、洗面台、歯ブラシ、コップ、棚、化粧水、物、枕、美人局、暮らし、明日、ドア、夕焼け、馬鹿、茜、日、斜陽、お日様、帰り、指先、葡萄、理由、一回、ギター、二拍、三節、四度目、誤解、話、六畳間、終わり、数十年、人生観、文字、消耗品、底、国、隙間、口癖、紙、最後、引力、質量、摩擦、軌道、飽和、結晶、収束、崩壊、波動、臨界、次元、粒子、波長、残響、反響、錯覚、葛藤、衝動、虚無、渇望、執着、絶望、孤独、郷愁、妄想、錯乱、盲信、本能、理性、錯綜、輪廻、寿命、終焉、永遠、刹那、遺物、痕跡、脈拍、蘇生、胎動、死生、輪郭、細胞、神経、骨格、遮断、共鳴、依存、束縛、排除、模倣、偽装、侵食、剥離、拒絶、拘束、投影、解剖、証明、観測、憂鬱、悲哀、苦悩、嫉妬、嫌悪、焦燥、怨嗟、諦念、悔恨、悲観、憤怒、哀愁、憐憫、寂寥、虚脱、覚醒、忘却、記憶、追憶、妄信、猜疑、達観、狂気、虚栄、傲慢、偏見、執念、諦観、自尊、劣等、孤立、疎外、欺瞞、偽善、羨望、軽蔑、陶酔、没入、感傷、愛憎、自虐、内省、沈思、黙考、驚愕、畏怖、心酔、情動、本心、真意、疑念、無念、未練、悲嘆、歓喜、信仰、祈祷、偶像、犠牲、供物、祭壇、儀式、聖域、禁忌、戒律、神託、啓示、奇跡、救済、贖罪、懺悔、恩寵、転生、涅槃、業火、怨霊、憑依、呪術、呪縛、悪魔、天使、魔女、異端、邪教、崇拝、神話、伝説、霊魂、魂魄、冥界、奈落、煉獄、天国、地獄、洗礼、福音、聖歌、賛美、巡礼、殉教、降臨、結界、聖戦、神聖、冒涜、迷信、魔術、呪詛、浄化、霊媒、神罰、神殿、経典、教義、布教、情景、立体、生命、実体、対象、生成、創造、想像、存在、起源、真理、宇宙、銀河、彗星、星雲、流星、天体、隕石、日食、月食、新星、真空、暗黒、閃光、極光、暁闇、深海、氷河、大陸、海洋、絶景、荒野、秘境、蒼穹、砂漠、樹海、深淵、境界、領域、空間、万物、悠久、無限、混沌、秩序、現象、幻影、残像、鼓動、白夜、極地、星霜、光芒、大気、重力、拝啓、願い、未来、後悔、体感、八度五分、再啓、想い、憂い、感情論、半径、八十五分、本音、一切、薪、声、愛情、二人きり、難儀、末、モノクロ、疲弊、季節、熱、木漏れ日、事、花蕾、陰り、滴、セテニル、秘密、化粧、浅はか、睫毛、造花、わたし、もの、右、左、街路、飢餓感、所在、消化器官、味、舌先、無反応、満腹中枢、翼、虚無感、舌触り、過去、姿、側、下方、目蓋裏、暗色、耳、雪、体温、ぬくもり、無彩色、身体、積雪、地平、抱擁、羽、コンパス、針、命、ひかり、空虚、しあわせ、かなしみ、大地、心臓、陽光、香り、寄る辺、背徳行為、場所、ダフネ、フィカス、アイリス、マアキア、リスラム、ミリカ、サビア、フロス、タイムス、リベス、アベリア、セダム、フェリシア、オクナ、リクニス\n\n浅い、空っぽな、薄い、ずっと、ただ、遠く、疾うに、わざと、所詮、ほら、どうにも、また、この、あの、そんな、もう、もっと、少し、少しだけ、やっと、あぁ、どうせ、久しい、随分、どうしよう、本当に、今更、なぁ、どうしても、間違ってる、正しい、正しく、幸せな、満たされない、気味が悪い、適当、はらはら、さらさら、汚れた、何気ない、じっと、柔らかに、静かな、悲しくって、仕方がない、眩しくって、とろとろ、高く、手遅れ、長い、白い、いい、ずるいよ、酷いよ、辛くても、絶え間無い、軈て、丁寧に、直ぐに、愚鈍な、揺るぎない、鈍く、荒んだ、利口な、柔らかく、違う、不毛な、不遇な、それじゃあ、甘く、過保護な、いっそ、もしも、綺麗な、似たような、どうか、それなり、どうしようもないほど、こんな、何度も、刻々と、妖しく、つんとした、繊麗な、たちまち、すぐ\n\n変わらない、寝転ぶ、鳴っている、歌っていた、書く、止まった、描いた、なる、なっていく、見上げても、流れる、仰いだ、泳ぐ、見紛う、見失う、転ばない、向いた、出来てる、信じない、売れない、零した、寝そべった、待っている、見た、わかってた、滲んだ、覆う、涼む、描け、忘れてしまった、座った、放り込んで、行きよう、笑った、教えて、来る、映った、揺れて、拭って、夏めく、顔出した、あった、掴もうとして、切った、書いて、握って、見せて、残る、色褪せない、失くして、笑ってる、響く、咲いてる、閉じて、思っている、開いていた、開いている、咲け、降り止めば、飾る、打つ、凪げ、越えてゆけ、越えてゆく、悲しい、泣きに、泣け、降り頻る、鳴れ、靡かせ、乗せ、裂け、奏で、聞く、覚ました、出かけよう、出ない、明けない、渇く、痛い、邪魔してる、上げて、明けたら、見て、覚えている、出して、出てみよう、決めた、捨てた、したい、泳いで、触れた、寄せて、行く、言う、煽ろう、戯けた、振りして、揺蕩う、嵐す、溺れ、溢れない、差す、待ち、終わって、抱いて、開く、吹き飛んじまえ、見たい、出来ませんでした、やれませんでした、爆破したい、歌にしたい、爆破して、ちらつかせて、生きられない、歩く、翳した、見向きもしない、泣けませんでした、笑えませんでした、吹けば、消えた、くせに、戻りたかった、散れば、わかってる、消せる、いなくなれ、覚えていたい、考えた、知りたい、年老いたくない、死んだら、思う、割り切ったら、言えない、売れる、辞めた、乗って、着いて行く、詠む、いらない、終わって往く、成る、忘れてしまう、置いて、もたせ、明けて、起きた、起きる、居た、回っちゃいない、疑う、醒めた、続けば、戻ってくる、帰ってくる、聞こえる、遅くなった、眠る、愛せた、愛せる、はにかむ、見えた、照らす、口に出して、暮らす、信じながら、なぞっている、生き急いで、許せない、待ち惚け、彷徨いながら、終わる、歌え、もういいかい、散ってしまった、回る、囚われた、挿し、罅割れた、溢れた、焼べて、乗せて、錆びた、彩る、燻んだ、飾った、枯れてく、覚めて、縋った、くれた、光った、色褪せて、帯びて、膿んで、擦れた、零れる、辿った、咲く、悟った、注いだ、咲いた、揺れてる、敗れて、誓った、なかった事にした、揺れていたい、ついた、見分けられない、蒔いた、触れないで、測れた、抗っていたい、老いて、忘れてしまっても、ついてくれた、言った、いる、躊躇ってしまう、厭いた、なぞる、留めたい、聞こえた、噛みしめる、紛らわせた、放り込まれ、残す、痛む、変え、浮遊しながら、落ちていく、奪い続ける、うずまり、失われていき、降りしきる、消し去ろうとする、揺り動かす、視つけられる、満たす、届けて、溶かす、取ろうとした、動き出した、馴染まない、消し去った、避ける、誘い、のみ込む、横たえ、預けた、求めていた、摘み、眠りにつく、見る\n\nように、みたいだ、なんだ、だろう、から、だ、かな、って、じゃなく、じゃないか、と、とか、や、ね、のかい、かい、さ、だろ、よな、やぁ、のに、し、すら、なのさ、ばっかさ、よ、は、に、を、も、で、な、くらい、ほど、まで、だって、みたいな",
            "checked": true
        },
        {
            "id": "nw3",
            "name": "YRSK",
            "text": "風景、正午、高架下、藍二乗、まま、白紙、人生、拍手、音、一つ、自分、今日、君、主役、プロット、ノート、中、ガス、水道、世間、ニュース、他人事、インク、頃、頭、夢、大人、時効、雲、視界、夜、花、春、下、妥協、心、運命、ラブソング、全部、無駄、今、目蓋、裏側、夜隅、僕、目、連続、こと、音楽、詩、価値、終わり方、空、藍、ほど、木陰、氷菓、口、風、世の中、嘘、本当、二人、歴史、顔、想い出、呼吸、汗、匂い、さよなら、時間、貴方、夕暮れ、晴れ、せい、雨、胸、凪、海、通り雨、草、羊雲、青色、土、春荒れ、春風、時計、昨日、風邪、予報、外、傘、靴、度胸、訳、夕飯、人間、手、納屋、古通り、夏草、灰色、言葉、カプチーノ、色、言い訳、窓辺、数、海岸、窓、反射、八月、潮騒、待ちぼうけ、海風、白さ、宵、内側、生き方、半分、街、青春、爆弾、片手、人類、みんな、ナイトショー、ワンシーン、日々、部屋、やつ、優しさ、星、百日紅、将来、ピアノ、机、癖、筈、線、愛、世界、防衛本能、信念、塵、列車、何処、隣町、原、歌、一輪草、他、涙、日暮、夕、先、道、髪、雨催い、向こう、温もり、誰か、気、二日酔い、洗面台、歯ブラシ、コップ、棚、化粧水、物、枕、美人局、暮らし、明日、ドア、夕焼け、馬鹿、茜、日、斜陽、お日様、帰り、指先、葡萄、理由、一回、ギター、二拍、三節、四度目、誤解、話、六畳間、終わり、数十年、人生観、文字、消耗品、底、国、隙間、口癖、紙、最後\r\n\r\n浅い、空っぽな、薄い、ずっと、ただ、遠く、疾うに、わざと、所詮、ほら、どうにも、また、この、あの、そんな、もう、もっと、少し、少しだけ、やっと、あぁ、どうせ、久しい、随分、どうしよう、本当に、今更、なぁ、どうしても、間違ってる、正しい、正しく、幸せな、満たされない、気味が悪い、適当、さらさら、汚れた、何気ない、じっと、柔らかに、静かな、悲しくって、仕方がない、眩しくって、とろとろ、高く、手遅れ、長い、白い、いい、ずるいよ、酷いよ、辛くても\r\n\r\n変わらない、寝転ぶ、鳴っている、歌っていた、書く、止まった、描いた、なる、なっていく、見上げても、流れる、仰いだ、泳ぐ、見紛う、見失う、転ばない、向いた、出来てる、信じない、売れない、零した、寝そべった、待っている、見た、わかってた、滲んだ、覆う、涼む、描け、忘れてしまった、座った、放り込んで、行きよう、笑った、教えて、来る、映った、揺れて、拭って、夏めく、顔出した、あった、掴もうとして、切った、書いて、握って、見せて、残る、色褪せない、失くして、笑ってる、響く、咲いてる、閉じて、思っている、開いていた、開いている、咲け、降り止めば、飾る、打つ、凪げ、越えてゆけ、越えてゆく、悲しい、泣きに、泣け、降り頻る、鳴れ、靡かせ、乗せ、裂け、奏で、聞く、覚ました、出かけよう、出ない、明けない、渇く、痛い、邪魔してる、上げて、明けたら、見て、覚えている、出して、出てみよう、決めた、捨てた、したい、泳いで、触れた、寄せて、行く、言う、煽ろう、戯けた、振りして、揺蕩う、嵐す、溺れ、溢れない、差す、待ち、終わって、抱いて、開く、吹き飛んじまえ、見たい、出来ませんでした、やれませんでした、爆破したい、歌にしたい、爆破して、ちらつかせて、生きられない、歩く、翳した、見向きもしない、泣けませんでした、笑えませんでした、吹けば、消えた、くせに、戻りたかった、散れば、わかってる、消せる、いなくなれ、覚えていたい、考えた、知りたい、年老いたくない、死んだら、思う、割り切ったら、言えない、売れる、辞めた、乗って、着いて行く、詠む、いらない、終わって往く、成る、忘れてしまう、置いて、もたせ、明けて、起きた、起きる、居た、回っちゃいない、疑う、醒めた、続けば、戻ってくる、帰ってくる、聞こえる、遅くなった、眠る、愛せた、愛せる、はにかむ、見えた、照らす、口に出して、暮らす、信じながら、なぞっている、生き急いで、許せない、待ち惚け、彷徨いながら、終わる、歌え、もういいかい\r\n\r\nように、みたいだ、なんだ、だろう、から、だ、かな、って、じゃなく、じゃないか、と、とか、や、ね、のかい、かい、さ、だろ、よな、やぁ、のに、し、すら、なのさ、ばっかさ",
            "checked": true
        },
        {
            "id": "nw4",
            "name": "二字熟語",
            "text": "信仰、祈祷、偶像、犠牲、供物、祭壇、儀式、聖域、禁忌、戒律、神託、啓示、奇跡、救済、贖罪\r\n\r\n懺悔、恩寵、転生、涅槃、業火、怨霊、憑依、呪術、呪縛、悪魔、天使、魔女、異端、邪教、崇拝\r\n\r\n神話、伝説、霊魂、魂魄、冥界、奈落、煉獄、天国、地獄、洗礼、福音、聖歌、賛美、巡礼、殉教\r\n\r\n降臨、結界、聖戦、神聖、冒涜、迷信、魔術、呪詛、浄化、霊媒、神罰、神殿、経典、教義、布教\r\n憂鬱、悲哀、苦悩、嫉妬、嫌悪、焦燥、怨嗟、諦念、悔恨、悲観、憤怒、哀愁、憐憫、寂寥、虚脱\r\n\r\n覚醒、忘却、記憶、追憶、郷愁、妄信、猜疑、達観、錯乱、狂気、虚栄、傲慢、偏見、執念、諦観\r\n\r\n自尊、劣等、孤立、疎外、依存、欺瞞、偽善、羨望、軽蔑、陶酔、没入、感傷、愛憎、自虐、内省\r\n\r\n沈思、黙考、驚愕、畏怖、心酔、情動、本心、真意、錯覚、疑念、無念、未練、達観、悲嘆、歓喜\r\n\r\n引力、質量、摩擦、軌道、飽和、結晶、収束、崩壊、波動、臨界、次元、粒子、波長、残響、反響\r\n\r\n錯覚、葛藤、衝動、虚無、渇望、執着、絶望、孤独、郷愁、妄想、錯乱、盲信、本能、理性、錯綜\r\n\r\n輪廻、寿命、終焉、永遠、刹那、遺物、痕跡、脈拍、蘇生、胎動、死生、輪郭、細胞、神経、骨格\r\n\r\n遮断、共鳴、依存、束縛、排除、模倣、偽装、侵食、剥離、拒絶、拘束、投影、解剖、証明、観測\r\n\r\n情景、風景、転生、立体、永遠、生命、実体、対象、生成、創造、想像、崩壊、存在、起源、真理\r\n\r\n宇宙、銀河、彗星、星雲、流星、天体、隕石、日食、月食、新星、真空、暗黒、閃光、極光、暁闇\r\n\r\n深海、氷河、大陸、海洋、絶景、荒野、秘境、蒼穹、砂漠、樹海、深淵、境界、領域、空間、万物\r\n\r\n悠久、無限、混沌、秩序、現象、幻影、残像、鼓動、白夜、極地、星霜、光芒、大気、引力、重力",
            "checked": true
        }
    ],
    "folders": []
}],
    notes:[{id:'n1',name:'ノート1',text:'',checked:true}]
};
let ghActive='n1';

function updateNoteNameDisplay(){
    const nameEl=document.getElementById('ghNoteName');
    if(!nameEl)return;
    function findNote(notes){return notes&&notes.find(x=>x.id===ghActive)||null;}
    let found=findNote(ghData.notes);
    if(!found){
        function sf(folders){
            for(const f of folders){
                const n=findNote(f.notes);if(n)return n;
                if(f.folders){const r=sf(f.folders);if(r)return r;}
            }
            return null;
        }
        found=sf(ghData.folders);
    }
    if(found)nameEl.textContent=found.name;
}

function renderTree(){
    const root=document.getElementById('treeSide');
    root.innerHTML='';
    updateNoteNameDisplay();
    if(ghData.notes&&ghData.notes.length){
        const ul=document.createElement('ul');
        ul.className='tree-note-list open';
        ul.style.paddingLeft='4px';
        ghData.notes.forEach(n=>ul.appendChild(makeNoteItem(n,null)));
        root.appendChild(ul);
    }
    renderFolders(ghData.folders,root,0);
    const addFolderBtn=document.createElement('button');
    addFolderBtn.className='btn-tree';
    addFolderBtn.style.cssText='display:flex;align-items:center;gap:3px;padding:2px 6px;margin-top:4px;';
    addFolderBtn.innerHTML='<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M1 3 Q1 2 2 2 L4 2 L5 3 L9 3 Q9 3 9 4 L9 8 Q9 9 8 9 L2 9 Q1 9 1 8Z"/><line x1="5" y1="5" x2="5" y2="8"/><line x1="3.5" y1="6.5" x2="6.5" y2="6.5"/></svg>';
    addFolderBtn.setAttribute('data-tip-down','フォルダを追加');
    addFolderBtn.onclick=()=>{
        ghData.folders.push({id:'f'+Date.now(),name:'新規フォルダ',open:false,folders:[],notes:[]});
        renderTree();
    };
    const addNoteBtn=document.createElement('button');
    addNoteBtn.className='btn-tree';
    addNoteBtn.style.cssText='display:flex;align-items:center;gap:3px;padding:2px 6px;margin-top:4px;';
    addNoteBtn.innerHTML='<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="5" y1="1" x2="5" y2="9"/><line x1="1" y1="5" x2="9" y2="5"/></svg>';
    addNoteBtn.setAttribute('data-tip-down','ノートを追加');
    addNoteBtn.onclick=()=>{
        if(!ghData.notes)ghData.notes=[];
        const newNote={id:'n'+Date.now(),name:'ノート',text:'',checked:true};
        ghData.notes.push(newNote);
        ghActive=newNote.id;
        document.getElementById('ghInput').value='';
        renderTree();
    };
    const btnRow=document.createElement('div');
    btnRow.style.cssText='display:flex;gap:6px;margin-top:4px;';
    btnRow.appendChild(addNoteBtn);
    btnRow.appendChild(addFolderBtn);
    root.appendChild(btnRow);
}

function makeNoteItem(n,parentFolder){
    const li=document.createElement('li');
    li.className='tree-note'+(n.id===ghActive?' active':'')+(n.checked?' checked':'');
    li.style.cssText='display:flex;align-items:center;gap:3px;padding:2px;border-radius:3px;';
    const chk=document.createElement('div');
    chk.className='chk-box';chk.textContent='✓';
    chk.onclick=e=>{e.stopPropagation();n.checked=!n.checked;renderTree();blendGh();};
    const nSpan=document.createElement('span');
    nSpan.style.cssText='flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;cursor:pointer;';
    nSpan.textContent=n.name;
    nSpan.onclick=e=>{
        if(e.detail>=2)return;
        setTimeout(()=>{
            if(!nSpan._dbl){
                ghActive=n.id;
                document.getElementById('ghInput').value=n.text;
                updateNoteNameDisplay();
                renderTree();
            }
            nSpan._dbl=false;
        },220);
    };
    nSpan.ondblclick=e=>{
        e.stopPropagation();e.preventDefault();
        nSpan._dbl=true;
        const inp=document.createElement('input');
        inp.value=n.name;
        inp.style.cssText='font-size:10px;border:none;border-bottom:1px solid var(--accent);background:transparent;color:var(--text-main);outline:none;width:70px;';
        nSpan.replaceWith(inp);inp.focus();inp.select();
        const done=()=>{if(inp.value.trim())n.name=inp.value.trim();renderTree();};
        inp.onblur=done;
        inp.onkeydown=ev=>{if(ev.key==='Enter')inp.blur();if(ev.key==='Escape')renderTree();};
    };
    const nMove=document.createElement('button');
    nMove.innerHTML='<svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,2 7,5 4,8"/><line x1="2" y1="5" x2="7" y2="5"/><line x1="8" y1="2" x2="8" y2="8"/></svg>';
    nMove.style.cssText='background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:1px;opacity:0;transition:opacity .15s;display:flex;align-items:center;flex-shrink:0;';
    nMove.title='フォルダへ移動';
    nMove.onclick=e=>{
        e.stopPropagation();
        const existing=document.getElementById('ctx-menu');
        if(existing)existing.remove();
        const menu=document.createElement('div');
        menu.id='ctx-menu';
        menu.style.cssText='position:fixed;left:-9999px;top:-9999px;background:var(--bg-surface);border:1px solid var(--border);border-radius:5px;box-shadow:0 4px 12px rgba(0,0,0,.1);z-index:9999;overflow:hidden;min-width:140px;';
        const label=document.createElement('div');
        label.style.cssText='padding:4px 12px;font-size:9px;color:var(--text-muted);letter-spacing:1px;border-bottom:1px solid var(--border);';
        label.textContent='フォルダへ移動';
        menu.appendChild(label);
        if(parentFolder){
            const rootItem=document.createElement('div');
            rootItem.style.cssText='padding:7px 12px;font-size:11px;color:var(--text-main);cursor:pointer;transition:background .1s;';
            rootItem.textContent='（ルートへ移動）';
            rootItem.addEventListener('mouseenter',()=>rootItem.style.background='var(--bg-input)');
            rootItem.addEventListener('mouseleave',()=>rootItem.style.background='');
            rootItem.onclick=()=>{
                const idx=parentFolder.notes.indexOf(n);
                if(idx>=0)parentFolder.notes.splice(idx,1);
                if(!ghData.notes)ghData.notes=[];
                ghData.notes.push(n);
                menu.remove();
                renderTree();blendGh();
            };
            menu.appendChild(rootItem);
        }
        function collectFolders(flist,d,excludeFolder){
            flist.forEach(tf=>{
                if(tf===excludeFolder)return;
                const item=document.createElement('div');
                item.style.cssText='padding:7px 12px;font-size:11px;color:var(--text-main);cursor:pointer;transition:background .1s;display:flex;align-items:center;gap:4px;';
                if(d>0){const indent=document.createElement('span');indent.style.cssText=`display:inline-block;width:${d*10}px;flex-shrink:0;`;item.appendChild(indent);}
                const nameEl=document.createElement('span');nameEl.textContent=tf.name;item.appendChild(nameEl);
                item.addEventListener('mouseenter',()=>item.style.background='var(--bg-input)');
                item.addEventListener('mouseleave',()=>item.style.background='');
                item.onclick=()=>{
                    if(parentFolder){const idx=parentFolder.notes.indexOf(n);if(idx>=0)parentFolder.notes.splice(idx,1);}
                    else{const idx=ghData.notes.indexOf(n);if(idx>=0)ghData.notes.splice(idx,1);}
                    tf.notes.push(n);
                    if(ghActive===n.id)document.getElementById('ghInput').value=n.text;
                    menu.remove();
                    renderTree();blendGh();
                };
                menu.appendChild(item);
                if(tf.folders&&tf.folders.length)collectFolders(tf.folders,d+1,excludeFolder);
            });
        }
        collectFolders(ghData.folders,0,parentFolder);
        if(menu.children.length===1){
            const empty=document.createElement('div');
            empty.style.cssText='padding:8px 12px;font-size:11px;color:var(--text-muted);';
            empty.textContent='移動先がありません';
            menu.appendChild(empty);
        }
        document.body.appendChild(menu);
        const mRect=menu.getBoundingClientRect();
        const rect=nMove.getBoundingClientRect();
        const spaceBelow=window.innerHeight-rect.bottom;
        const top=spaceBelow>mRect.height+8?rect.bottom+4:rect.top-mRect.height-4;
        const left=Math.min(rect.left,window.innerWidth-mRect.width-8);
        menu.style.left=left+'px';
        menu.style.top=top+'px';
        setTimeout(()=>document.addEventListener('click',()=>menu.remove(),{once:true}),0);
    };
    const nDel=document.createElement('button');
    nDel.innerHTML='<svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,5 4,14 12,14 13,5"/><line x1="1" y1="5" x2="15" y2="5"/><path d="M6,5 L6,3 L10,3 L10,5"/><line x1="6" y1="8" x2="6" y2="12"/><line x1="10" y1="8" x2="10" y2="12"/></svg>';
    nDel.style.cssText='background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:1px;opacity:0;transition:opacity .15s;display:flex;align-items:center;flex-shrink:0;';
    nDel.title='ノートを削除';
    nDel.onclick=e=>{
        e.stopPropagation();
        const noteList=parentFolder?parentFolder.notes:ghData.notes;
        if(noteList.length<=1&&!parentFolder){alert('最後のノートは削除できません');return;}
        if(!confirm(`「${n.name}」を削除しますか？`))return;
        const idx=noteList.indexOf(n);
        if(idx>=0)noteList.splice(idx,1);
        if(ghActive===n.id){
            const firstNote=findFirstNote();
            if(firstNote){ghActive=firstNote.id;document.getElementById('ghInput').value=firstNote.text;}
        }
        renderTree();blendGh();
    };
    li.addEventListener('mouseenter',()=>{nMove.style.opacity='1';nDel.style.opacity='1';});
    li.addEventListener('mouseleave',()=>{nMove.style.opacity='0';nDel.style.opacity='0';});
    li.appendChild(chk);li.appendChild(nSpan);li.appendChild(nMove);li.appendChild(nDel);
    return li;
}

function findFirstNote(){
    if(ghData.notes&&ghData.notes.length)return ghData.notes[0];
    for(const f of ghData.folders){if(f.notes&&f.notes.length)return f.notes[0];}
    return null;
}

function renderFolders(folders,container,depth){
    folders.forEach(f=>{
        const fDiv=document.createElement('div');
        fDiv.style.paddingLeft=(depth*8)+'px';
        const hd=document.createElement('div');hd.className='tree-folder-header';
        hd.style.cssText='display:flex;align-items:center;gap:3px;padding:2px 0;';
        const arrow=document.createElement('span');arrow.className='tree-folder-arrow'+(f.open?' open':'');arrow.textContent='▶';
        const nameSpan=document.createElement('span');nameSpan.className='tree-folder-name';
        nameSpan.style.cssText='flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;';
        nameSpan.textContent=f.name;
        nameSpan.onclick=e=>{
            if(e.detail>=2)return;
            setTimeout(()=>{if(!nameSpan._dbl){f.open=!f.open;renderTree();}nameSpan._dbl=false;},220);
        };
        nameSpan.ondblclick=e=>{
            e.stopPropagation();e.preventDefault();
            nameSpan._dbl=true;
            const inp=document.createElement('input');
            inp.value=f.name;
            inp.style.cssText='font-size:10px;font-weight:700;border:none;border-bottom:1px solid var(--accent);background:transparent;color:var(--text-main);outline:none;width:80px;';
            nameSpan.replaceWith(inp);inp.focus();inp.select();
            const done=()=>{if(inp.value.trim())f.name=inp.value.trim();renderTree();};
            inp.onblur=done;
            inp.onkeydown=ev=>{if(ev.key==='Enter')inp.blur();if(ev.key==='Escape')renderTree();};
        };
        const fDel=document.createElement('button');
        fDel.innerHTML='<svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><line x1="1" y1="1" x2="9" y2="9"/><line x1="9" y1="1" x2="1" y2="9"/></svg>';
        fDel.style.cssText='background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:1px;opacity:0;transition:opacity .15s;display:flex;align-items:center;flex-shrink:0;';
        fDel.title='フォルダを削除';
        fDel.onclick=e=>{
            e.stopPropagation();
            if(!confirm(`「${f.name}」を削除しますか？`))return;
            const idx=folders.indexOf(f);if(idx>=0)folders.splice(idx,1);
            renderTree();blendGh();
        };
        hd.addEventListener('mouseenter',()=>fDel.style.opacity='1');
        hd.addEventListener('mouseleave',()=>fDel.style.opacity='0');
        hd.appendChild(arrow);hd.appendChild(nameSpan);hd.appendChild(fDel);
        fDiv.appendChild(hd);
        if(f.open){
            if(f.folders&&f.folders.length){
                const subContainer=document.createElement('div');
                renderFolders(f.folders,subContainer,depth+1);
                fDiv.appendChild(subContainer);
            }
            const ul=document.createElement('ul');ul.className='tree-note-list open';
            ul.style.paddingLeft='8px';
            f.notes.forEach(n=>ul.appendChild(makeNoteItem(n,f)));
            fDiv.appendChild(ul);
            const btns=document.createElement('div');
            btns.style.cssText=`padding-left:${(depth+1)*8+4}px;display:flex;gap:6px;margin-top:2px;`;
            const addNote=document.createElement('button');
            addNote.className='btn-tree';
            addNote.style.cssText='display:flex;align-items:center;gap:3px;padding:2px 6px;';
            addNote.innerHTML='<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="5" y1="1" x2="5" y2="9"/><line x1="1" y1="5" x2="9" y2="5"/></svg>';
            addNote.setAttribute('data-tip-down','ノートを追加');
            addNote.onclick=()=>{
                const newNote={id:'n'+Date.now(),name:'ノート',text:'',checked:true};
                f.notes.push(newNote);
                ghActive=newNote.id;
                document.getElementById('ghInput').value='';
                renderTree();
            };
            const addFolder=document.createElement('button');
            addFolder.className='btn-tree';
            addFolder.style.cssText='display:flex;align-items:center;gap:3px;padding:2px 6px;';
            addFolder.innerHTML='<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M1 3 Q1 2 2 2 L4 2 L5 3 L9 3 Q9 3 9 4 L9 8 Q9 9 8 9 L2 9 Q1 9 1 8Z"/><line x1="5" y1="5" x2="5" y2="8"/><line x1="3.5" y1="6.5" x2="6.5" y2="6.5"/></svg>';
            addFolder.setAttribute('data-tip-down','フォルダを追加');
            addFolder.onclick=()=>{
                if(!f.folders)f.folders=[];
                f.folders.push({id:'f'+Date.now(),name:'新規フォルダ',open:false,folders:[],notes:[]});
                renderTree();
            };
            btns.appendChild(addNote);btns.appendChild(addFolder);
            fDiv.appendChild(btns);
        }
        container.appendChild(fDiv);
    });
}

function showUnsaved(){
    const status=document.getElementById('ghSaveStatus');
    if(status){status.textContent='未保存';status.className='gh-save-status unsaved';}
}

function onGhInput(){
    const t=document.getElementById('ghInput').value;
    if(ghData.notes){
        const n=ghData.notes.find(x=>x.id===ghActive);
        if(n){n.text=t;blendGh();showUnsaved();return;}
    }
    function findAndUpdate(folders){
        for(const f of folders){
            const n=f.notes.find(x=>x.id===ghActive);
            if(n){n.text=t;return true;}
            if(f.folders&&f.folders.length&&findAndUpdate(f.folders))return true;
        }
        return false;
    }
    findAndUpdate(ghData.folders);
    blendGh();
    showUnsaved();
}

function collectNotes(folders,result){
    folders.forEach(f=>{
        if(f.notes)f.notes.forEach(n=>{if(n.checked&&n.text)result.push(n.text);});
        if(f.folders&&f.folders.length)collectNotes(f.folders,result);
    });
}

let ghDict=[];
function blendGh(){
    const texts=[];
    if(ghData.notes)ghData.notes.forEach(n=>{if(n.checked&&n.text)texts.push(n.text);});
    collectNotes(ghData.folders,texts);
    const lines=texts.join('\n').split(/[\n\s　]+/).filter(w=>w.trim());
    const entries=[];
    const seen=new Set();
    function addEntry(w){
        w=w.trim();
        if(!w||seen.has(w))return;
        let v;
        if(tokenizer){
            try{
                const reading=getReading(w).replace(/[ァ-ン]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
                v=pv(reading);
            }catch(e){v=pv(w);}
        }else{
            v=pv(w);
        }
        if(v.length===0)return;
        seen.add(w);
        entries.push({word:w,s:v.length,v});
    }
    lines.forEach(line=>{
        addEntry(line); // 行全体もそのまま1つの候補として残す
        if(tokenizer){
            // kuromojiで単語単位に分解し、より細かい候補の種を増やす（「言葉」「もっと」「教えて」等）
            try{
                const tokens=tokenizer.tokenize(line);
                tokens.forEach(t=>{if(t.surface_form&&t.surface_form!==line)addEntry(t.surface_form);});
            }catch(e){}
        }
    });
    ghDict=entries;
    lsSaveGhData();
    scheduleGhCloudPush();
}
let lastConvertUndo=null; // {node, previousText} - あいまい変換・ハミング変換を「Enter」で1回だけ戻すための記録
function recordConvertUndo(node,previousText){
    lastConvertUndo={node,previousText};
}
document.addEventListener('keydown',e=>{
    if(e.key!=='Enter')return;
    // ①選択系変換の取り消し（変換結果が選択されたままの時）
    if(lastConvertUndo){
        const node=lastConvertUndo.node;
        if(node&&node.parentNode){
            const sel=window.getSelection();
            if(sel.rangeCount>0&&sel.getRangeAt(0).toString()===node.textContent){
                e.preventDefault();
                const newNode=document.createTextNode(lastConvertUndo.previousText);
                node.parentNode.replaceChild(newNode,node);
                const newRange=document.createRange();
                newRange.selectNode(newNode);
                sel.removeAllRanges();
                sel.addRange(newRange);
                savedRange=newRange;
                lastConvertUndo=null;
                return;
            }
        }
    }
    // ②全体一括あいまい変換の取り消し（エディタや入力欄にフォーカスが無い時のみ）
    if(lastMorphAllUndo){
        const a=document.activeElement;
        const inField=a&&(a.closest('.lyric-editor')||a.tagName==='INPUT'||a.tagName==='TEXTAREA'||a.isContentEditable);
        if(!inField){
            e.preventDefault();
            lastMorphAllUndo.forEach(({ed,prev})=>{if(ed&&ed.isConnected)ed.innerText=prev;});
            lastMorphAllUndo=null;
            saveProject();
        }
    }
});

let ghCloudPushTimer=null;
let _firebaseUser=null;
function scheduleGhCloudPush(){
    if(!_firebaseUser)return;
    clearTimeout(ghCloudPushTimer);
    ghCloudPushTimer=setTimeout(()=>{
        saveGhDataToCloud(_firebaseUser.uid,ghData);
    },1200);
}

// --- Selection & Drum ---
let savedRange=null;
const DFONT=20,DLH=2.4,DIH=Math.round(DFONT*DLH),DPAD=2;
let drumActive=false,drumItems=[],drumIndex=0,drumRange=null,drumOrigText='';
let dIsDrag=false,dDragY0=0,dDragIdx0=0;
const dOverlay=document.getElementById('drumOverlay');
const dBg=document.getElementById('drumBg');
const dRoll=document.getElementById('drumRoll');
const dHl=document.getElementById('drumHl');
const dTrack=document.getElementById('drumTrack');

function mountDrum(rect,matches,origText){
    drumItems=matches;drumIndex=0;drumOrigText=origText;drumActive=true;
    const totalH=DIH*(DPAD*2+1);
    // 8. 候補の最長文字列に合わせて幅を動的調整
    const maxLen=Math.max(...matches.map(m=>(m.word||m).length),origText.length);
    const dynW=Math.min(Math.max(maxLen*DFONT*1.5, 80), 300);
    dBg.style.cssText=`left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`;
    const rollLeft=Math.min(rect.left, window.innerWidth-dynW-10);
    const rollTop=rect.top+rect.height/2-totalH/2;
    dRoll.style.cssText=`left:${rollLeft}px;top:${rollTop}px;width:${dynW}px;height:${totalH}px;font-size:${DFONT}px;`;
    dHl.style.cssText=`top:${DPAD*DIH}px;height:${DIH}px;`;
    dTrack.innerHTML='';
    for(let i=0;i<DPAD;i++){const d=document.createElement('div');d.className='drum-item';d.style.height=DIH+'px';d.innerHTML='&nbsp;';dTrack.appendChild(d);}
    matches.forEach((m,i)=>{const d=document.createElement('div');d.className='drum-item'+(i===0?' active':'');d.style.height=DIH+'px';d.textContent=m.word||m;dTrack.appendChild(d);});
    for(let i=0;i<DPAD;i++){const d=document.createElement('div');d.className='drum-item';d.style.height=DIH+'px';d.innerHTML='&nbsp;';dTrack.appendChild(d);}
    // 1. 青帯を消す
    window.getSelection().removeAllRanges();
    dOverlay.classList.add('active');
    document.getElementById('inlinePopup').classList.remove('open');
    requestAnimationFrame(()=>setDP(0,false));
}

function setDP(idx,animate){
    const len=drumItems.length;
    idx=((idx%len)+len)%len;
    dTrack.style.transition=animate?'transform .1s ease':'none';
    dTrack.style.transform=`translateY(${-idx*DIH}px)`;
    dTrack.querySelectorAll('.drum-item').forEach((el,i)=>{
        el.classList.toggle('active',i===DPAD+idx);
    });
    drumIndex=idx;
}

function unmountDrum(){
    dOverlay.classList.remove('active');
    drumActive=false;
    drumRange=null;
    dIsDrag=false;
    window.getSelection().removeAllRanges();
    // savedRangeはあいまい変換のために保持する
}

function applyDrum(){
    if(!drumActive||!drumRange)return;
    const word=(drumItems[drumIndex]&&(drumItems[drumIndex].word||drumItems[drumIndex]))||drumOrigText;
    try{
        drumRange.deleteContents();
        const node=document.createTextNode(word);
        drumRange.insertNode(node);
        const ed=node.parentElement&&node.parentElement.closest('.lyric-editor');
        if(ed)ed.normalize();
        // 9. ルビが振られているブロックなら振り直し
        reRubyNode(node);
    }catch(e){}
    unmountDrum();
}

dRoll.addEventListener('wheel',e=>{e.preventDefault();e.stopPropagation();setDP((drumIndex+(e.deltaY>0?1:-1)+drumItems.length)%drumItems.length,true);},{passive:false});
dRoll.addEventListener('mousedown',e=>{dIsDrag=true;dDragY0=e.clientY;dDragIdx0=drumIndex;e.preventDefault();e.stopPropagation();});
window.addEventListener('mousemove',e=>{if(!dIsDrag)return;const d=Math.round((dDragY0-e.clientY)/DIH);const ni=((dDragIdx0+d)%drumItems.length+drumItems.length)%drumItems.length;if(ni!==drumIndex)setDP(ni,false);});
window.addEventListener('mouseup',e=>{if(!dIsDrag)return;dIsDrag=false;setDP(drumIndex,true);});
dRoll.addEventListener('click',e=>{if(Math.abs(e.clientY-dDragY0)<4)applyDrum();});
dBg.addEventListener('click',e=>{unmountDrum();});
// 2. ドラムロール外クリックで解除
document.addEventListener('mousedown',e=>{
    if(drumActive&&!dRoll.contains(e.target)&&!dBg.contains(e.target)){
        unmountDrum();
    }
});

let justIME=false;
document.addEventListener('compositionend',()=>{justIME=true;setTimeout(()=>{justIME=false;},500);});
window.addEventListener('keydown',e=>{
    if(!drumActive)return;
    if(e.key==='Escape'){e.preventDefault();unmountDrum();return;}
    if(e.key==='Enter'&&!e.isComposing&&!justIME){e.preventDefault();applyDrum();return;}
    if(e.key==='ArrowUp'){e.preventDefault();setDP((drumIndex-1+drumItems.length)%drumItems.length,true);return;}
    if(e.key==='ArrowDown'){e.preventDefault();setDP((drumIndex+1)%drumItems.length,true);return;}
});

// --- kuromoji ---
let tokenizer=null;
function initKuromoji(){
    try{
        kuromoji.builder({dicPath:'dict'}).build((err,t)=>{
            if(!err){tokenizer=t;buildLyricDict();blendGh();}
        });
    }catch(e){}
}

function getReading(text){
    if(!tokenizer)return text;
    try{
        const tokens=tokenizer.tokenize(text);
        return tokens.map(t=>t.reading||t.surface_form).join('');
    }catch(e){return text;}
}

function handleSelection(){
    const sel=window.getSelection();const txt=sel.toString().trim();
    const pop=document.getElementById('inlinePopup');
    if(!txt){pop.classList.remove('open');return;}
    const anchor=sel.anchorNode;
    const inEditor=anchor&&(anchor.nodeType===3?anchor.parentElement:anchor).closest('.lyric-editor');
    if(!inEditor){pop.classList.remove('open');return;}
    savedRange=sel.getRangeAt(0);
    const rect=savedRange.getBoundingClientRect();

    // 選択範囲がrubyタグ内部の場合、親rubyのrt読みを取得
    function getReadingFromRange(range){
        const frag=range.cloneContents();
        let surfaceText='';
        let rubyReading='';
        frag.childNodes.forEach(node=>{
            if(node.nodeType===3){
                surfaceText+=node.textContent;
                rubyReading+=node.textContent;
            }else if(node.nodeName==='RUBY'){
                const rt=node.querySelector('rt');
                const surface=node.childNodes[0]?node.childNodes[0].textContent:'';
                surfaceText+=surface;
                rubyReading+=rt?rt.textContent:surface;
            }else{
                surfaceText+=node.textContent;
                rubyReading+=node.textContent;
            }
        });
        // rubyタグが取れなかった場合、選択開始ノードの親がrubyかチェック
        if(surfaceText===rubyReading){
            const startNode=range.startContainer;
            const parentRuby=startNode.nodeType===3?startNode.parentElement.closest('ruby'):startNode.closest('ruby');
            if(parentRuby){
                const rt=parentRuby.querySelector('rt');
                if(rt){
                    surfaceText=parentRuby.childNodes[0]?parentRuby.childNodes[0].textContent:surfaceText;
                    rubyReading=rt.textContent;
                }
            }
        }
        return{surfaceText,rubyReading};
    }

    const{surfaceText,rubyReading}=getReadingFromRange(savedRange);
    const clean=surfaceText.replace(/[\s　]/g,'');
    const rawReading=rubyReading.replace(/[\s　]/g,'');

    // 5. 英数字の母音マッピング
    const romajiVowelMap={
        'a':'a','i':'i','u':'u','e':'e','o':'o',
        'k':'a','g':'a','s':'a','z':'a','t':'a','d':'a',
        'n':'a','h':'a','b':'a','p':'a','m':'a','r':'a','y':'a','w':'a',
        'A':'a','I':'i','U':'u','E':'e','O':'o',
        'K':'a','G':'a','S':'a','Z':'a','T':'a','D':'a',
        'N':'a','H':'a','B':'a','P':'a','M':'a','R':'a','Y':'a','W':'a'
    };
    const kuroReading=(rawReading!==clean?rawReading:getReading(clean))
        .replace(/[ァ-ン]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60))
        .replace(/[\s　]/g,'');
    const hasRomaji=/[a-zA-Z]/.test(clean);
    const hasWildcard=clean.includes('○');
    let finalVowels=[];
    if(hummingMode){
        finalVowels=buildHumVowels(clean,kuroReading,romajiVowelMap);
    }else if(hasRomaji||hasWildcard){
        let kuroIdx=0;
        const kuroVowels=kuroReading.split('').map(c=>vM[c]).filter(Boolean);
        for(let i=0;i<clean.length;i++){
            const c=clean[i];
            if(c==='○'){finalVowels.push('*');}
            else if(romajiVowelMap[c]!==undefined){finalVowels.push(romajiVowelMap[c]);}
            else{if(kuroIdx<kuroVowels.length)finalVowels.push(kuroVowels[kuroIdx++]);}
        }
    }else{
        finalVowels=kuroReading.split('').map(c=>vM[c]||null).filter(Boolean);
    }
    const syl=finalVowels.length;
    const iv=[];
    for(let i=0;i<finalVowels.length;i++){
        const v=finalVowels[i];
        if(v&&v!=='*'&&v!=='-')iv.push({pos:i,vowel:v});
    }
    const full=[...ghDict,...lyricDict,...dict];
    const seen=new Set();
    const hiragana=kuroReading!==clean&&!hasRomaji&&!hasWildcard?kuroReading:null;
    seen.add(clean);if(hiragana)seen.add(hiragana);

    // 6. 候補を段階分けして表示
    // ①完全一致
    let matches1=full.filter(d=>{
        if(d.s!==syl)return false;
        for(let x of iv){if(!posMatches(d.v[x.pos],x.vowel))return false;}
        return true;
    }).filter(m=>{if(seen.has(m.word))return false;seen.add(m.word);return true;});
    // ②語尾3拍一致
    let matches2=[];
    if(syl>=3){
        const tail=iv.filter(x=>x.pos>=syl-3).map(x=>({pos:x.pos-(syl-3),vowel:x.vowel}));
        matches2=full.filter(d=>{
            if(d.s<3)return false;
            const offset=d.s-3;
            for(let x of tail){if(!posMatches(d.v[offset+x.pos],x.vowel))return false;}
            return true;
        }).filter(m=>{if(seen.has(m.word))return false;seen.add(m.word);return true;});
    }
    // ③語尾2拍一致
    let matches3=[];
    if(syl>=2){
        const tail2=iv.filter(x=>x.pos>=syl-2).map(x=>({pos:x.pos-(syl-2),vowel:x.vowel}));
        matches3=full.filter(d=>{
            if(d.s<2)return false;
            const offset=d.s-2;
            for(let x of tail2){if(!posMatches(d.v[offset+x.pos],x.vowel))return false;}
            return true;
        }).filter(m=>{if(seen.has(m.word))return false;seen.add(m.word);return true;});
    }
    const drumMatches=[{word:clean},...matches1.slice(0,10)];
    const cw=document.getElementById('candWrap');cw.innerHTML='';
    const totalCount=matches1.length+matches2.length+matches3.length;
    document.getElementById('dLabel').textContent=`候補ワード（${syl}拍 / ${totalCount}件）`;
    document.getElementById('vowelDisp').textContent=iv.map(x=>x.vowel.toUpperCase()).join(' · ');
    // ひらがな候補は左カラムのdHiraganaに表示（右カラムには出さない）
    const dHiragana=document.getElementById('dHiragana');
    if(dHiragana){
        dHiragana.innerHTML='';
        if(hiragana){
            const t=document.createElement('div');
            t.className='cand-tag cand-hiragana';
            t.textContent=hiragana;
            t.onclick=()=>replaceText(hiragana);
            dHiragana.appendChild(t);
        }
    }
    function addGroup(label,arr){
        if(arr.length===0)return;
        const lbl=document.createElement('div');
        lbl.className='cand-group-label';
        lbl.textContent=label;cw.appendChild(lbl);
        const MAX_SHOW=50; // 描画上限（短い拍数で数千件ヒットした時のカクつき防止）
        arr.slice(0,MAX_SHOW).forEach(m=>{
            const t=document.createElement('div');t.className='cand-tag';t.textContent=m.word;
            t.onclick=()=>replaceText(m.word);cw.appendChild(t);
        });
        if(arr.length>MAX_SHOW){
            const more=document.createElement('div');
            more.className='cand-group-label';
            more.textContent=`…ほか${arr.length-MAX_SHOW}件`;
            cw.appendChild(more);
        }
    }
    addGroup('完全一致',matches1);
    addGroup('語尾3拍',matches2);
    addGroup('語尾2拍',matches3);
    if(totalCount===0&&!hiragana){
        cw.innerHTML='<span class="cand-empty">一致する言葉がありません。</span>';
    }
}

function replaceText(w){
    if(!savedRange)return;
    savedRange.deleteContents();
    savedRange.insertNode(document.createTextNode(w));
    window.getSelection().removeAllRanges();
}

function applyRuby(){
    // 内部的に保持（UIからは削除するが機能は残す）
}

// --- ルビ確認・自動付与機能 ---
function getAutoRuby(text){
    if(!tokenizer)return null;
    try{
        const tokens=tokenizer.tokenize(text);
        return tokens.map(t=>{
            const surface=t.surface_form;
            const reading=(t.reading||surface).replace(/[ァ-ン]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));
            // ルビが不要なケース：
            // 1. 表記と読みが同じ
            // 2. ひらがなのみ
            // 3. 「っ」「ー」などの特殊文字
            // 4. 小文字ひらがな（ぁぃぅぇぉゃゅょ）
            if(surface===reading)return surface;
            if(/^[ぁ-んー]+$/.test(surface))return surface;
            if(/^[っッーｰ、。！？\s]+$/.test(surface))return surface;
            if(/^[ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ]+$/.test(surface))return surface;
            return `<ruby>${surface}<rt class="auto-ruby">${reading}</rt></ruby>`;
        }).join('');
    }catch(e){return null;}
}

function toggleBlockRuby(blockEl){
    const editor=blockEl.querySelector('.lyric-editor');
    const btn=blockEl.querySelector('.ruby-toggle-btn');
    if(!editor||!btn)return;
    const isOn=blockEl.dataset.rubyOn==='true';
    if(isOn){
        // ルビOFF：ルビタグを除去してテキストだけ残す
        const plain=editor.innerHTML.replace(/<ruby>(.*?)<rt[^>]*>.*?<\/rt><\/ruby>/g,'$1');
        editor.innerHTML=plain;
        blockEl.dataset.rubyOn='false';
        btn.classList.remove('active');
        btn.setAttribute('data-tip-up','ルビを確認');
    }else{
        // ルビON：まず既存のrubyタグを除去してからkuromojiで自動付与
        if(!tokenizer){alert('辞書読み込み中です。少し待ってからお試しください。');return;}
        // 3. 二重ルビ防止：先に既存ルビを除去
        const plainHtml=editor.innerHTML
            .replace(/<ruby>(.*?)<rt[^>]*>.*?<\/rt><\/ruby>/g,'$1')
            .replace(/<br\s*\/?>/gi,'___BR___')
            .replace(/<[^>]*>/gm,'');
        const lines=plainHtml.split('___BR___');
        editor.innerHTML=lines.map(line=>{
            if(!line.trim())return '<br>';
            return getAutoRuby(line)||line;
        }).join('<br>');
        blockEl.dataset.rubyOn='true';
        btn.classList.add('active');
        btn.setAttribute('data-tip-up','ルビを非表示');
        // ルビクリックで編集
        editor.querySelectorAll('rt.auto-ruby').forEach(rt=>{
            rt.style.cssText='font-size:9px;color:var(--accent);cursor:pointer;';
            rt.onclick=(e)=>{
                e.stopPropagation();
                const current=rt.textContent;
                const existing=document.getElementById('ruby-edit-popup');
                if(existing)existing.remove();
                const popup=document.createElement('div');
                popup.id='ruby-edit-popup';
                popup.style.cssText='position:fixed;z-index:5000;background:var(--bg-surface);border:1px solid var(--accent);border-radius:4px;padding:3px 6px;box-shadow:0 2px 8px rgba(0,0,0,.15);';
                const inp=document.createElement('input');
                inp.value=current;
                inp.style.cssText='font-size:11px;width:80px;border:none;background:transparent;color:var(--accent);outline:none;font-family:var(--font-ui);';
                popup.appendChild(inp);
                document.body.appendChild(popup);
                const rtRect=rt.getBoundingClientRect();
                popup.style.left=Math.min(rtRect.left,window.innerWidth-120)+'px';
                popup.style.top=(rtRect.top-32)+'px';
                inp.focus();inp.select();
                const done=()=>{rt.textContent=inp.value.trim()||current;popup.remove();};
                inp.onblur=done;
                inp.onkeydown=ev=>{if(ev.key==='Enter'){ev.preventDefault();inp.blur();}if(ev.key==='Escape')popup.remove();};
            };
        });
    }
}

document.addEventListener('mousedown',e=>{
    if(!e.target.closest('#inlinePopup'))document.getElementById('inlinePopup').classList.remove('open');
});

// --- UI ---
function toggleTheme(){
    const c=document.documentElement.getAttribute('data-theme');const n=c==='light'?'dark':'light';
    document.documentElement.setAttribute('data-theme',n);
    document.getElementById('tiL').style.display=n==='light'?'block':'none';
    document.getElementById('tiD').style.display=n==='dark'?'block':'none';
    document.getElementById('wiL').style.display=n==='light'?'block':'none';
    document.getElementById('wiD').style.display=n==='dark'?'block':'none';
}
function setFontSize(v){document.documentElement.style.setProperty('--lyric-size',v+'px');}

function toggleHummingMode(){
    const btn=document.getElementById('humBtn');
    const sel=document.getElementById('humSel');
    const badge=document.getElementById('humBadge');
    const hintBox=document.getElementById('humHintBox');
    const editorArea=document.getElementById('editorArea');
    const isOpen=sel&&sel.classList.contains('open');
    if(hummingMode&&isOpen){
        // 開いている状態でもう一度押す＝完全にOFF
        hummingMode=false;
        if(sel)sel.classList.remove('open');
    }else if(hummingMode&&!isOpen){
        // ON中・閉じている＝選択肢を再表示するだけ（OFFにはしない）
        if(sel)sel.classList.add('open');
    }else{
        // OFF→ON＋選択肢を表示
        hummingMode=true;
        if(sel)sel.classList.add('open');
    }
    if(btn)btn.classList.toggle('on',hummingMode);
    if(badge)badge.classList.toggle('on',hummingMode);
    if(hintBox)hintBox.style.display=hummingMode?'block':'none';
    if(editorArea)editorArea.classList.toggle('hum-active',hummingMode);
}

let typTimer=null;
let snsTheme='dark';
let snsRubyOn=false;
let snsFontSize=24;

function enterSnsMode(){
    document.body.classList.add('sns-active');
    document.getElementById('snsOverlay').dataset.snsTheme=snsTheme;
    document.getElementById('snsScreen').style.fontSize=snsFontSize+'px';
    startTyping();
}
function exitSns(){document.body.classList.remove('sns-active');clearTimeout(typTimer);}

// ルビなしテキスト取得
function getSnsText(){
    let txts=[];
    document.querySelectorAll('.lyric-editor').forEach(e=>{
        let t=e.innerHTML
            .replace(/<ruby>(.*?)<rt[^>]*>.*?<\/rt><\/ruby>/g,'$1')
            .replace(/<br\s*\/?>/gi,'\n')
            .replace(/<[^>]*>/gm,'');
        if(t.trim())txts.push(t.trim());
    });
    return txts.join('\n\n');
}

// ルビ付きHTML取得
function getSnsTextWithRuby(){
    let txts=[];
    document.querySelectorAll('.lyric-editor').forEach(e=>{
        let html=e.innerHTML
            .replace(/<br\s*\/?>/gi,'\n')
            .replace(/<(?!\/?(?:ruby|rt)[\s>])[^>]*>/gm,'');
        if(html.replace(/<[^>]*>/g,'').trim())txts.push(html.trim());
    });
    return txts.join('\n\n');
}

function skipTyping(){
    clearTimeout(typTimer);
    const sc=document.getElementById('snsScreen');
    const all=snsRubyOn?getSnsTextWithRuby():getSnsText();
    if(!all){sc.textContent='歌詞を入力してください...';return;}
    sc.innerHTML=all.replace(/\n/g,'<br>');
}

function startTyping(){
    clearTimeout(typTimer);
    const sc=document.getElementById('snsScreen');sc.innerHTML='';
    document.getElementById('snsOverlay').dataset.snsTheme=snsTheme;
    sc.style.fontSize=snsFontSize+'px';
    if(snsRubyOn){
        // ルビON：DOMノード単位でタイピングアニメーション
        const tmp=document.createElement('div');
        tmp.innerHTML=getSnsTextWithRuby().replace(/\n/g,'<br>');
        const nodes=Array.from(tmp.childNodes);
        if(nodes.length===0){sc.textContent='歌詞を入力してください...';return;}
        let i=0;
        function typeNode(){
            if(i<nodes.length){
                sc.appendChild(nodes[i].cloneNode(true));
                const isBr=nodes[i].nodeName==='BR';
                i++;
                typTimer=setTimeout(typeNode,isBr?400:120);
            }
        }
        typeNode();
    }else{
        const all=getSnsText();
        if(!all){sc.textContent='歌詞を入力してください...';return;}
        let i=0;const chars=all.split('');
        function type(){
            if(i<chars.length){
                let c=chars[i];
                sc.innerHTML+=(c==='\n')?'<br>':c;
                i++;
                typTimer=setTimeout(type,(c==='\n')?400:80);
            }
        }
        type();
    }
}

let rw=null;
function enterRainMode(){
    if(rw&&!rw.closed){sendWordsToWordrip();rw.focus();return;}
    const th=document.documentElement.getAttribute('data-theme');
    saveWordsForWordrip();
    rw=window.open('wordrip.html?theme='+th,'WORDRIP','width=900,height=650');
    if(!rw){alert('ポップアップを許可してください');return;}
}
function saveWordsForWordrip(){
    try{localStorage.setItem('wordrip_words',JSON.stringify(getGreenhouseWords()));}catch(e){}
}
function sendWordsToWordrip(){
    try{if(rw&&!rw.closed)rw.postMessage({type:'UPDATE_WORDS',words:getGreenhouseWords()},'*');}catch(e){}
}

let pdw=null;
function enterPictureDripMode(){
    if(pdw&&!pdw.closed){pdw.focus();return;}
    const th=document.documentElement.getAttribute('data-theme');
    pdw=window.open('picturedrip.html?theme='+th,'PictureDrip','width=900,height=650');
    if(!pdw){alert('ポップアップを許可してください');return;}
}

function generateOneWord(){
    const PATTERNS=['を辿る','に溶ける','が揺れる','を越えて','の中で','だけが','さえも','を抱いて','に染まる','が消える','を探して','に揺れる','が輝く','を忘れて','の果てで','に沈む','が舞う','を見つけて','に佇む','が流れる','を超えて','に溶け込む','が瞬く','を手放して','に漂う'];
    const texts=[];
    if(ghData.notes)ghData.notes.forEach(n=>{if(n.checked&&n.text)texts.push(n.text);});
    collectNotes(ghData.folders,texts);
    const noteWords=texts.join('\n').split(/[\n\s　、,]+/).filter(w=>w.trim().length>0);
    if(noteWords.length>0&&Math.random()<0.6){
        return noteWords[Math.floor(Math.random()*noteWords.length)];
    }
    const entry=LYRIC_WORDS[Math.floor(Math.random()*LYRIC_WORDS.length)];
    const word=entry.word||entry;
    if(Math.random()<0.5){
        const pattern=PATTERNS[Math.floor(Math.random()*PATTERNS.length)];
        return word+pattern;
    }
    return word;
}

function getGreenhouseWords(){
    const PATTERNS=['を辿る','に溶ける','が揺れる','を越えて','の中で','だけが','さえも','を抱いて','に染まる','が消える','を探して','に揺れる','が輝く','を忘れて','の果てで','に沈む','が舞う','を見つけて','に佇む','が流れる','を超えて','に溶け込む','が瞬く','を手放して','に漂う'];
    const texts=[];
    if(ghData.notes)ghData.notes.forEach(n=>{if(n.checked&&n.text)texts.push(n.text);});
    collectNotes(ghData.folders,texts);
    const words=texts.join('\n').split(/[\n\s　、,]+/).filter(w=>w.trim().length>0);
    if(words.length<50){
        const shuffled=[...LYRIC_WORDS].sort(()=>Math.random()-.5);
        const needed=50-words.length;
        const phrases=shuffled.slice(0,needed).map(entry=>{
            const w=entry.word||entry;
            if(Math.random()<0.5){
                const pattern=PATTERNS[Math.floor(Math.random()*PATTERNS.length)];
                return w+pattern;
            }
            return w;
        });
        return [...words,...phrases];
    }
    return words;
}

// --- Init ---
window.addEventListener('load',()=>{
    if(!lsLoad()){
        db=JSON.parse(JSON.stringify(DEFAULT_DB));
        nextId=3;curId=2;
    }
    lsLoadGhData(); // life memoをlocalStorageから復元（無ければ初期値のままでOK）
    if(!db[curId])curId=parseInt(Object.keys(db)[0]);
    projectFolders=[{id:'root',open:true,folders:[],projects:Object.keys(db).map(id=>parseInt(id))}];

    // 右カラムリサイザー
    const rightColResizer=document.getElementById('rightColResizer');
    let rcDrag=false;
    rightColResizer.addEventListener('mousedown',e=>{
        rcDrag=true;
        rightColResizer.classList.add('dragging');
        e.preventDefault();
    });
    window.addEventListener('mousemove',e=>{
        if(!rcDrag)return;
        const appCard=document.getElementById('appCard');
        const r=appCard.getBoundingClientRect();
        const newWidth=Math.max(150,Math.min(500,r.right-e.clientX));
        document.documentElement.style.setProperty('--right-col-width',newWidth+'px');
        document.getElementById('rightColResizer').style.right=(newWidth+14)+'px';
    });
    window.addEventListener('mouseup',()=>{
        if(rcDrag){rcDrag=false;rightColResizer.classList.remove('dragging');}
    });

    // ノート名クリック編集
    document.getElementById('ghNoteName').addEventListener('click',function handleNoteNameClick(){
        const nameEl=document.getElementById('ghNoteName');
        const currentName=nameEl.textContent;
        const inp=document.createElement('input');
        inp.value=currentName;
        inp.style.cssText='font-size:10px;font-weight:700;border:none;border-bottom:1px solid var(--accent);background:transparent;color:var(--text-main);outline:none;width:100px;';
        nameEl.replaceWith(inp);
        inp.focus();inp.select();
        const done=()=>{
            const newName=inp.value.trim()||currentName;
            function updateName(notes){
                if(!notes)return false;
                const n=notes.find(x=>x.id===ghActive);
                if(n){n.name=newName;return true;}
                return false;
            }
            if(!updateName(ghData.notes)){
                function searchFolders(folders){
                    for(const f of folders){
                        if(updateName(f.notes))return true;
                        if(f.folders&&searchFolders(f.folders))return true;
                    }
                    return false;
                }
                searchFolders(ghData.folders);
            }
            const newEl=document.createElement('span');
            newEl.className='gh-note-name';
            newEl.id='ghNoteName';
            newEl.textContent=newName;
            inp.replaceWith(newEl);
            newEl.addEventListener('click',handleNoteNameClick);
            renderTree();
        };
        inp.onblur=done;
        inp.onkeydown=ev=>{if(ev.key==='Enter')inp.blur();if(ev.key==='Escape'){inp.value=currentName;inp.blur();}};
    });

    // 保存ボタン
    document.getElementById('ghSaveBtn').addEventListener('click',()=>{
        const status=document.getElementById('ghSaveStatus');
        status.textContent='保存済み';
        status.className='gh-save-status saved';
        setTimeout(()=>{status.textContent='';status.className='gh-save-status';},2000);
    });

    document.getElementById('sidebarToggleBtn').addEventListener('click',toggleSidebar);
    const innerToggle=document.getElementById('sidebarToggleBtnInner');
    if(innerToggle)innerToggle.addEventListener('click',toggleSidebar);
    document.getElementById('sidebarOverlay').addEventListener('click',closeSidebar);
    document.getElementById('morphAllBtn').addEventListener('click',doMorphAll);
    document.getElementById('snsModeBtn').addEventListener('click',enterSnsMode);
    document.getElementById('rainModeBtn').addEventListener('click',enterRainMode);
    const pictureDripBtnEl=document.getElementById('pictureDripBtn');
    if(pictureDripBtnEl)pictureDripBtnEl.addEventListener('click',enterPictureDripMode);
    const humBtnEl=document.getElementById('humBtn');
    if(humBtnEl)humBtnEl.addEventListener('click',toggleHummingMode);
    const humBatchBtnEl=document.getElementById('humBatchBtn');
    if(humBatchBtnEl)humBatchBtnEl.addEventListener('click',runHummingBatchConvert);
    const humSingleBtnEl=document.getElementById('humSingleBtn');
    if(humSingleBtnEl)humSingleBtnEl.addEventListener('click',runHummingSingleConvert);
    const ghRefreshBtnEl=document.getElementById('ghRefreshBtn');
    if(ghRefreshBtnEl)ghRefreshBtnEl.addEventListener('click',async()=>{
        if(!_firebaseUser){alert('ログインしていないと、スマホ側のメモを取得できません。');return;}
        ghRefreshBtnEl.classList.add('spinning');
        const cloudGhData=await loadGhDataFromCloud(_firebaseUser.uid);
        ghRefreshBtnEl.classList.remove('spinning');
        if(cloudGhData){
            ghData=cloudGhData;
            blendGh();renderTree();updateNoteNameDisplay();
            if(savedRange&&!savedRange.collapsed)handleSelection();
        }
    });
    const ghQuickMemoBtnEl=document.getElementById('ghQuickMemoBtn');
    if(ghQuickMemoBtnEl)ghQuickMemoBtnEl.addEventListener('click',()=>{
        window.open('quickmemo.html','_blank');
    });
    document.querySelectorAll('.hum-pill').forEach(btn=>{
        btn.addEventListener('click',e=>{
            e.stopPropagation();
            hummingChar=btn.dataset.c;
            document.querySelectorAll('.hum-pill').forEach(b=>b.classList.remove('active'));
            btn.classList.add('active');
            const badgeEl=document.getElementById('humBadge');
            if(badgeEl)badgeEl.textContent=hummingChar;
            const selEl=document.getElementById('humSel');
            if(selEl)selEl.classList.remove('open');
        });
    });
    document.addEventListener('click',e=>{
        const selEl=document.getElementById('humSel');
        const btnEl=document.getElementById('humBtn');
        if(selEl&&selEl.classList.contains('open')&&!selEl.contains(e.target)&&e.target!==btnEl&&!btnEl.contains(e.target)){
            selEl.classList.remove('open');
        }
    });
    document.getElementById('splitBtn').addEventListener('click',toggleSplit);
    document.getElementById('themeBtn').addEventListener('click',toggleTheme);
    document.getElementById('fontSlider').addEventListener('input',function(){setFontSize(this.value);});
    document.getElementById('projectTitle').addEventListener('input',saveProject);
    document.getElementById('bpmInput').addEventListener('click',()=>openDrumPicker('bpm'));
    document.getElementById('keyInput').addEventListener('click',()=>openDrumPicker('key'));
    document.getElementById('addBlockLeftBtn').addEventListener('click',()=>addBlock('left'));
    document.getElementById('addBlockRightBtn').addEventListener('click',()=>addBlock('right'));
    document.getElementById('ghInput').addEventListener('input',onGhInput);
    document.getElementById('treeSideBtn').addEventListener('click',toggleTreeSide);
    const morphSelTopBtnEl=document.getElementById('morphSelTopBtn');
    if(morphSelTopBtnEl)morphSelTopBtnEl.addEventListener('click',e=>{
        e.stopPropagation();
        doMorphSel();
    });
    document.getElementById('snsReplayBtn').addEventListener('click',startTyping);
    document.getElementById('snsSkipBtn').addEventListener('click',skipTyping);
    document.getElementById('snsReturnBtn').addEventListener('click',exitSns);

    // 仕上げモード切替・ルビON/OFF・文字サイズ（1箇所のみ）
    window._snsToggleTheme=function(){
        snsTheme=snsTheme==='dark'?'light':'dark';
        document.getElementById('snsOverlay').dataset.snsTheme=snsTheme;
        document.getElementById('snsIconSun').style.display=snsTheme==='dark'?'block':'none';
        document.getElementById('snsIconMoon').style.display=snsTheme==='light'?'block':'none';
    };
    window._snsToggleRuby=function(){
        snsRubyOn=!snsRubyOn;
        document.getElementById('snsRubyToggle').textContent=snsRubyOn?'ルビ ON':'ルビ OFF';
        startTyping();
    };
    const snsFontSliderEl=document.getElementById('snsFontSlider');
    if(snsFontSliderEl){
        snsFontSliderEl.addEventListener('input',function(){
            snsFontSize=parseInt(this.value);
            document.getElementById('snsScreen').style.fontSize=snsFontSize+'px';
        });
    }
    document.getElementById('snsOverlay').dataset.snsTheme=snsTheme;
    document.getElementById('notebookLeft').addEventListener('mouseup',handleSelection);
    document.getElementById('notebookRight').addEventListener('mouseup',handleSelection);
    // 歌詞本文の自動保存：入力が止まって800ms後に保存
    let lyricSaveTimer=null;
    function scheduleLyricSave(e){
        if(!e.target.closest('.lyric-editor'))return;
        lastMorphAllUndo=null; // 手入力が入ったら全体一括のEnter取り消しは無効化
        clearTimeout(lyricSaveTimer);
        lyricSaveTimer=setTimeout(saveProject,800);
    }
    document.getElementById('notebookLeft').addEventListener('input',scheduleLyricSave);
    document.getElementById('notebookRight').addEventListener('input',scheduleLyricSave);
    // タブを閉じる・再読み込みする直前にも確実に保存
    window.addEventListener('beforeunload',()=>{saveProject();});

    // Tabキーで○入力（歌詞エリアのみ）
    document.addEventListener('keydown',e=>{
        if(e.key!=='Tab')return;
        const active=document.activeElement;
        if(!active||!active.closest('.lyric-editor'))return;
        e.preventDefault();
        const sel=window.getSelection();
        if(!sel||sel.rangeCount===0)return;
        const range=sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode('○'));
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
    });
    // 自動保存はlocalStorageに任せる（saveBtnは廃止）

    // floppyBtnでモーダルを開く
    document.getElementById('floppyBtn').addEventListener('click',()=>{
        const s=document.getElementById('floppyScreenMain');
        if(s)s.innerHTML='&gt; データを選んでください<span class="floppy-cursor"></span>';
        const l=document.getElementById('floppyLight');
        if(l)l.classList.remove('on');
        document.getElementById('floppyOverlay').classList.add('open');
    });

    // Firebase Auth UI
    _firebaseUser=null;

    function updateLoginUI(user){
        ['floppyLoginBtn','ghLoginBtn'].forEach(id=>{
            const el=document.getElementById(id);
            if(el)el.style.display=user?'none':'flex';
        });
        ['floppyUserInfo','ghUserStatus'].forEach(id=>{
            const el=document.getElementById(id);
            if(el)el.style.display=user?'flex':'none';
        });
        if(user){
            ['floppyUserAvatar','ghUserAvatar'].forEach(id=>{
                const el=document.getElementById(id);
                if(el)el.src=user.photoURL||'';
            });
            ['floppyUserName','ghUserName'].forEach(id=>{
                const el=document.getElementById(id);
                if(el)el.textContent=user.displayName||user.email||'';
            });
            ['floppyCloudSaveBtn','floppyCloudLoadBtn'].forEach(id=>{
                const el=document.getElementById(id);
                if(el)el.classList.add('active');
            });
        }else{
            ['floppyCloudSaveBtn','floppyCloudLoadBtn'].forEach(id=>{
                const el=document.getElementById(id);
                if(el)el.classList.remove('active');
            });
        }
    }

    // 起動時ログインモーダル
    const _loginPromptOverlay=document.getElementById('loginPromptOverlay');
    document.getElementById('loginPromptGoogleBtn')?.addEventListener('click',()=>{
        _loginPromptOverlay?.classList.remove('open');
        signInWithGoogle();
    });
    document.getElementById('loginPromptSkipBtn')?.addEventListener('click',()=>{
        sessionStorage.setItem('meloly_login_skip','1');
        _loginPromptOverlay?.classList.remove('open');
    });

    // right-colログインボタン
    document.getElementById('ghLoginBtn')?.addEventListener('click',()=>signInWithGoogle());

    // right-colクラウド保存ボタン
    document.getElementById('ghCloudSaveBtn')?.addEventListener('click',async()=>{
        if(!_firebaseUser)return;
        const payload={version:'v5_12',savedAt:new Date().toISOString(),db,curId,nextId,projectFolders,ghData,ghActive};
        await saveToCloud(_firebaseUser.uid,payload);
    });

    // フロッピーモーダル内
    document.getElementById('floppyLoginBtn')?.addEventListener('click',()=>signInWithGoogle());
    document.getElementById('floppyLogoutBtn')?.addEventListener('click',()=>signOutUser());

    document.getElementById('floppyCloudSaveBtn')?.addEventListener('click',async()=>{
        if(!_firebaseUser)return;
        const s=document.getElementById('floppyScreenMain');
        const l=document.getElementById('floppyLight');
        if(s)s.innerHTML='&gt; クラウドに保存中...<span class="floppy-cursor"></span>';
        if(l)l.classList.add('on');
        const payload={version:'v5_12',savedAt:new Date().toISOString(),db,curId,nextId,projectFolders,ghData,ghActive};
        const ok=await saveToCloud(_firebaseUser.uid,payload);
        if(l)l.classList.remove('on');
        if(s){s.innerHTML=ok?'&gt; クラウド保存完了しました':'&gt; 保存に失敗しました';s.className='floppy-screen-line dim';}
    });

    document.getElementById('floppyCloudLoadBtn')?.addEventListener('click',async()=>{
        if(!_firebaseUser)return;
        const s=document.getElementById('floppyScreenMain');
        const l=document.getElementById('floppyLight');
        if(s)s.innerHTML='&gt; クラウドから読み込み中...<span class="floppy-cursor"></span>';
        if(l)l.classList.add('on');
        const payload=await loadFromCloud(_firebaseUser.uid);
        if(l)l.classList.remove('on');
        if(!payload){
            if(s){s.innerHTML='&gt; データが見つかりませんでした';s.className='floppy-screen-line dim';}
            return;
        }
        db=payload.db;curId=payload.curId||1;nextId=payload.nextId||Object.keys(payload.db).length+1;
        if(payload.projectFolders)projectFolders=payload.projectFolders;
        if(payload.ghData)ghData=payload.ghData;
        if(payload.ghActive)ghActive=payload.ghActive;
        lsSave();lsSaveGhData();
        if(s){s.innerHTML='&gt; 読み込み完了しました';s.className='floppy-screen-line dim';}
        setTimeout(()=>{
            document.getElementById('floppyOverlay').classList.remove('open');
            loadProject(curId);renderProjectTree();renderTree();updateNoteNameDisplay();
        },800);
    });

    // Firebase認証状態の監視（Firebaseの読み込みが完了してから実行。失敗時は静かにスキップ）
    firebaseModulePromise.then(mod=>{
        if(!mod)return; // 読み込み失敗時はログイン機能を使わず通常通り進む
        initAuth(
            user=>{
                _firebaseUser=user;
                updateLoginUI(user);
                // life memoはローカル保存が優先。クラウドの最新を取り込むのは
                // LIFE MEMOヘッダーの更新ボタン（ghRefreshBtn）を押した時だけ（自動上書きはしない）
                // 歌詞・プロジェクトは、誤って上書きしないようローカルに何もない時だけ反映する（既存の安全な挙動を維持）
                loadFromCloud(user.uid).then(payload=>{
                    if(!payload)return;
                    if(!localStorage.getItem('clicklyric_db')){
                        db=payload.db;curId=payload.curId||1;nextId=payload.nextId||Object.keys(payload.db).length+1;
                        if(payload.projectFolders)projectFolders=payload.projectFolders;
                        if(payload.ghActive)ghActive=payload.ghActive;
                        lsSave();loadProject(curId);renderProjectTree();renderTree();updateNoteNameDisplay();
                    }
                });
            },
            ()=>{
                _firebaseUser=null;
                updateLoginUI(null);
                if(!sessionStorage.getItem('meloly_login_skip')){
                    setTimeout(()=>_loginPromptOverlay?.classList.add('open'),800);
                }
            }
        );
    });

    // 10. Dエリアリサイザー
    const bottomDResizer=document.getElementById('bottomDResizer');
    const bottomD=document.getElementById('bottomD');
    const appCard=document.getElementById('appCard');
    let bdDrag=false,bdStartY=0,bdStartH=0;
    bottomDResizer.addEventListener('mousedown',e=>{
        bdDrag=true;
        bdStartY=e.clientY;
        bdStartH=bottomD.offsetHeight;
        e.preventDefault();
    });
    window.addEventListener('mousemove',e=>{
        if(!bdDrag)return;
        const diff=bdStartY-e.clientY;
        const newH=Math.max(60,Math.min(400,bdStartH+diff));
        bottomD.style.height=newH+'px';
    });
    window.addEventListener('mouseup',()=>{if(bdDrag)bdDrag=false;});
    document.getElementById('morphSlider').addEventListener('input',function(){
        const steps=[0,0.2,0.5,0.7,1.0];
        const idx=parseInt(this.value);
        morphJoshiRate=steps[idx];
        const pct=[0,20,50,70,100][idx];
        document.getElementById('morphSliderLabel').textContent=`あいまい変換度（${pct}%）`;
        if(savedRange&&!savedRange.collapsed)handleSelection();
    });
    document.getElementById('aboutBtn').addEventListener('click',showAboutModal);

    // --- FLOPPY MODAL ---
    initFloppyModal({
        getDb:()=>db,
        getCurId:()=>curId,
        getNextId:()=>nextId,
        getProjectFolders:()=>projectFolders,
        getGhData:()=>ghData,
        getGhActive:()=>ghActive,
        audBlob:audBlob,
        onImportComplete:(payload,restoredAudio)=>{
            db=payload.db;
            curId=payload.curId||1;
            nextId=payload.nextId||Object.keys(payload.db).length+1;
            if(payload.projectFolders)projectFolders=payload.projectFolders;
            if(payload.ghData)ghData=payload.ghData;
            if(payload.ghActive)ghActive=payload.ghActive;
            lsSave();
            // 音声を復元
            for(const [id,blob] of Object.entries(restoredAudio)){
                restoreAudio(id,blob,'録音済み');
            }
            // UI更新
            loadProject(curId);
            renderProjectTree();
            renderTree();
            updateNoteNameDisplay();
            let activeNote=ghData.notes&&ghData.notes.find(x=>x.id===ghActive);
            if(!activeNote){
                function _sf(folders){for(const f of folders){const n=f.notes&&f.notes.find(x=>x.id===ghActive);if(n)return n;if(f.folders){const r=_sf(f.folders);if(r)return r;}}return null;}
                activeNote=_sf(ghData.folders||[]);
            }
            if(activeNote)document.getElementById('ghInput').value=activeNote.text||'';
        }
    });

    window.addEventListener('message',e=>{
        if(e.data&&e.data.type==='REQUEST_WORD'&&rw&&!rw.closed){
            rw.postMessage({type:'NEW_WORD',word:generateOneWord()},'*');
        }
    });

    renderProjects();
    loadProject(curId);
    blendGh();
    loadDict();
    initKuromoji();
});