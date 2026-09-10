// --- Floppy Module (ZIP export/import) ---

function floppySetScreen(msg, dim=false){
    const el=document.getElementById('floppyScreenMain');
    if(!el)return;
    el.innerHTML=`&gt; ${msg}${dim?'':'<span class="floppy-cursor"></span>'}`;
    el.className='floppy-screen-line'+(dim?' dim':' main');
}

function floppyLightOn(){
    const el=document.getElementById('floppyLight');
    if(el)el.classList.add('on');
}

function floppyLightOff(){
    const el=document.getElementById('floppyLight');
    if(el)el.classList.remove('on');
}

export function initFloppyModal({db, getDb, getCurId, getNextId, getProjectFolders, getGhData, getGhActive, audBlob, onImportComplete}){

    const overlay=document.getElementById('floppyOverlay');
    const fileInput=document.getElementById('floppyFileInput');

    // モーダルを開く処理はmain.jsのfloppyBtnイベントで管理

    // 閉じる
    document.getElementById('floppyClose').addEventListener('click',()=>{
        overlay.classList.remove('open');
    });
    overlay.addEventListener('click',e=>{
        if(e.target===overlay)overlay.classList.remove('open');
    });

    // 書き出し（ZIP）
    document.getElementById('floppyExportBtn').addEventListener('click',async()=>{
        floppySetScreen('書き出し中...');
        floppyLightOn();
        try{
            const JSZip=window.JSZip;
            if(!JSZip){floppySetScreen('JSZipが読み込まれていません',true);floppyLightOff();return;}
            const zip=new JSZip();

            // JSON
            const payload={
                version:'v5_12',
                exportedAt:new Date().toISOString(),
                db:getDb(),
                curId:getCurId(),
                nextId:getNextId(),
                projectFolders:getProjectFolders(),
                ghData:getGhData(),
                ghActive:getGhActive(),
                audioFiles:{}
            };

            // 音声ファイル
            const audioFolder=zip.folder('audio');
            const audioMap={};
            for(const [id,blob] of Object.entries(audBlob)){
                if(!blob)continue;
                const fname=`block_${id}.webm`;
                audioFolder.file(fname,blob);
                audioMap[id]=fname;
            }
            payload.audioFiles=audioMap;
            zip.file('meloly.json',JSON.stringify(payload,null,2));

            // ZIPを生成してダウンロード
            const content=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
            const url=URL.createObjectURL(content);
            const a=document.createElement('a');
            const date=new Date();
            const dateStr=`${date.getFullYear()}${String(date.getMonth()+1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}`;
            a.href=url;a.download=`meloly_${dateStr}.zip`;a.click();
            URL.revokeObjectURL(url);
            floppySetScreen('書き出し完了しました',true);
            floppyLightOff();
        }catch(e){
            console.error(e);
            floppySetScreen('エラーが発生しました',true);
            floppyLightOff();
        }
    });

    // 読み込み（ZIP）
    document.getElementById('floppyImportBtn').addEventListener('click',()=>{
        fileInput.click();
    });

    fileInput.addEventListener('change',async e=>{
        const file=e.target.files[0];
        if(!file)return;
        floppySetScreen('読み込み中...');
        floppyLightOn();
        try{
            const JSZip=window.JSZip;
            if(!JSZip){floppySetScreen('JSZipが読み込まれていません',true);floppyLightOff();return;}
            const zip=await JSZip.loadAsync(file);

            // JSON読み込み
            const jsonFile=zip.file('meloly.json');
            if(!jsonFile)throw new Error('meloly.json not found');
            const jsonStr=await jsonFile.async('string');
            const payload=JSON.parse(jsonStr);
            if(!payload.db)throw new Error('invalid');

            // 音声ファイル読み込み
            const restoredAudio={};
            if(payload.audioFiles){
                for(const [id,fname] of Object.entries(payload.audioFiles)){
                    const audioFile=zip.file(`audio/${fname}`);
                    if(audioFile){
                        const blob=await audioFile.async('blob');
                        restoredAudio[id]=blob;
                    }
                }
            }

            setTimeout(()=>{
                floppySetScreen('読み込み完了しました',true);
                floppyLightOff();
                setTimeout(()=>{
                    overlay.classList.remove('open');
                    onImportComplete(payload,restoredAudio);
                },800);
            },600);

        }catch(err){
            console.error(err);
            floppySetScreen('データが読めませんでした',true);
            floppyLightOff();
        }
        fileInput.value='';
    });
}
